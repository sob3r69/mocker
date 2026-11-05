import type { GenerationConfig, MockProject, ProjectSnapshot } from '@mocker/shared';
import type { FastifyInstance } from 'fastify';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectSchema } from '@mocker/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAdminServer } from '../admin/index.js';
import { readConfig } from '../config/index.js';
import { createMockServer } from '../mock/index.js';
import { ProjectStore } from '../projects/store.js';
import { inferGeneration } from './index.js';

let directory: string;
let store: ProjectStore;
let admin: FastifyInstance;
let mock: FastifyInstance;
let project: MockProject;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mocker-generator-'));
  store = new ProjectStore(directory);
  await store.initialize();
  project = projectSchema.parse(JSON.parse(await readFile(new URL('../../../../examples/shop.json', import.meta.url), 'utf8')));
  const config = {
    ...readConfig({}),
    projectsDir: directory,
  };
  admin = await createAdminServer(config, store);
  mock = createMockServer(config, store);
});
afterEach(async () => {
  await Promise.all([
    admin.close(),
    mock.close(),
  ]);
  await rm(directory, { recursive: true, force: true });
});
async function start(generation: GenerationConfig) {
  const response = project.endpoints[0]!.responses[0]!.response;
  response.bodyMode = 'generated';
  response.generation = generation;
  const created = await store.create(project);
  await store.setState('shop', 'running');
  return created;
}
describe('generator HTTP contract', () => {
  it('infers and previews without changing a project file or revision', async () => {
    await store.create(project);
    const before = await readFile(join(directory, 'shop.json'), 'utf8');
    const version = store.changes().version;
    const inferred = await admin.inject({
      method:  'POST',
      url:     '/api/generator/infer',
      payload: {
        example: [
          { id: 1, email: 'sample@example.com' },
        ],
        arrayCount: 4,
        seed:       0,
      },
    });
    expect(inferred.statusCode, inferred.body).toBe(200);
    const generation = inferred.json<{ generation: GenerationConfig }>().generation;
    const preview = await admin.inject({ method: 'POST', url: '/api/generator/preview', payload: generation });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().body).toHaveLength(4);
    expect(await readFile(join(directory, 'shop.json'), 'utf8')).toBe(before);
    expect(store.changes().version).toBe(version);
  });
  it('persists inferred schemas, serves fresh data and still honors conditional responses', async () => {
    const saved = await start(inferGeneration({
      example: {
        uuid:  'x',
        email: 'x@example.com',
        items: [
          { price: 1.5 },
        ],
        active: true,
        nil:    null,
      },
    }));
    const first = await mock.inject('/shop/api/products');
    const second = await mock.inject('/shop/api/products');
    expect(first.statusCode).toBe(200);
    expect(first.headers['content-type']).toContain('application/json');
    expect(first.json()).not.toEqual(second.json());
    expect(first.json()).toHaveProperty('nil', null);
    expect(first.json().items).toHaveLength(1);
    expect((await mock.inject('/shop/api/products?mode=error')).statusCode).toBe(500);
    const disk = JSON.parse(await readFile(join(directory, 'shop.json'), 'utf8'));
    expect(disk.endpoints[0].responses[0].response.generation).toEqual(saved.config.endpoints[0]!.responses[0]!.response.generation);
    const restarted = new ProjectStore(directory);
    await restarted.initialize();
    expect(restarted.get('shop').config).toEqual(saved.config);
  });
  it('shares deterministic semantics between preview and runtime without global seed state', async () => {
    const generation = inferGeneration({
      example: { id: 1, name: 'A', date: '2024-01-01' },
      seed:    42,
    });
    await start(generation);
    const expected = (await admin.inject({ method: 'POST', url: '/api/generator/preview', payload: generation })).json().body;
    const results = await Promise.all(Array.from({ length: 4 }, () => mock.inject('/shop/api/products')));
    expect(results.map(response => response.json())).toEqual(Array.from({ length: 4 }).fill(expected));
  });
  it('switches back to the static sample with a normal revision-protected save', async () => {
    const created = await start(inferGeneration({
      example: { id: 1 },
    }));
    const config = created.config;
    config.endpoints[0]!.responses[0]!.response.bodyMode = 'static';
    config.endpoints[0]!.responses[0]!.response.body = { original: true };
    const saved = await admin.inject({
      method:  'PUT',
      url:     '/api/projects/shop/config',
      headers: { 'if-match': created.revision },
      payload: config,
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json<ProjectSnapshot>().revision).not.toBe(created.revision);
    expect((await mock.inject('/shop/api/products')).json()).toEqual({ original: true });
  });
  it('rejects bad generator requests with JSON paths and rejects excessive nesting', async () => {
    const invalid = await admin.inject({
      method:  'POST',
      url:     '/api/generator/infer',
      payload: { example: {}, arrayCount: 1001 },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.issues[0].path).toBe('$.arrayCount');
    const badSchema = await admin.inject({
      method:  'POST',
      url:     '/api/generator/preview',
      payload: {
        schema: { type: 'value', generator: 'function' },
      },
    });
    expect(badSchema.statusCode).toBe(400);
    let deep = 'null';
    for (let i = 0; i < 100; i++) deep = `{"x":${deep}}`;
    const tooDeep = await admin.inject({
      method:  'POST',
      url:     '/api/generator/infer',
      headers: { 'content-type': 'application/json' },
      payload: `{"example":${deep}}`,
    });
    expect(tooDeep.statusCode).toBe(400);
    expect(tooDeep.json().error.code).toBe('JSON_LIMIT');
  });
  it('bounds generated bytes and suppresses generation for bodyless statuses', async () => {
    const generation = {
      schema: {
        type:  'array',
        count: 1000,
        items: {
          type:       'object',
          properties: {
            ['x'.repeat(2000)]: { type: 'value', generator: 'null' },
          },
        },
      },
    } as const;
    const saved = await start(generation);
    const over = await mock.inject('/shop/api/products');
    expect(over.statusCode).toBe(422);
    expect(over.json().error.code).toBe('GENERATION_LIMIT');
    saved.config.endpoints[0]!.responses[0]!.response.status = 204;
    await store.replace('shop', saved.config, saved.revision);
    const empty = await mock.inject('/shop/api/products');
    expect(empty.statusCode).toBe(204);
    expect(empty.body).toBe('');
  });
});
