import type { MockEndpoint, MockProject, ProjectSnapshot } from '@mocker/shared';
import type { FastifyInstance } from 'fastify';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectSchema } from '@mocker/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAdminServer } from '../admin/index.js';
import { readConfig } from '../config/index.js';
import { createMockServer } from '../mock/index.js';
import { ProjectStore } from './store.js';

let directory: string;
let store: ProjectStore;
let admin: FastifyInstance;
let mock: FastifyInstance;
let shop: MockProject;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mocker-core-'));
  shop = projectSchema.parse(JSON.parse(await readFile(new URL('../../../../examples/shop.json', import.meta.url), 'utf8')));
  store = new ProjectStore(directory);
  await store.initialize();
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
async function create(config = shop) {
  const response = await admin.inject({ method: 'POST', url: '/api/projects', payload: config });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<ProjectSnapshot>();
}
async function start(id = 'shop') {
  expect((await admin.inject({ method: 'POST', url: `/api/projects/${id}/start` })).statusCode).toBe(200);
}
async function save(config: MockProject, revision = store.get(config.id).revision) {
  return admin.inject({
    method:  'PUT',
    url:     `/api/projects/${config.id}/config`,
    headers: { 'if-match': revision },
    payload: config,
  });
}
function extraEndpoint(path: string, method: MockEndpoint['method'] = 'GET', status = 201): MockEndpoint {
  const source = shop.endpoints[0]!;
  return {
    ...source,
    id:        `extra-${method.toLowerCase()}-${status}`,
    method,
    path,
    responses: [
      {
        ...source.responses[0]!,
        id:       `extra-response-${method.toLowerCase()}-${status}`,
        response: { ...source.responses[0]!.response, status },
      },
    ],
  };
}

describe('backend core HTTP integration', () => {
  it('creates a minimal project with defaults and validates error paths', async () => {
    const created = await admin.inject({
      method:  'POST',
      url:     '/api/projects',
      payload: { id: 'minimal', name: 'Minimal', prefix: '/minimal' },
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json<ProjectSnapshot>().config.endpoints).toEqual([]);
    const bad = await admin.inject({
      method:  'POST',
      url:     '/api/projects',
      payload: { id: '../escape', name: 'Unsafe', prefix: '/unsafe' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.issues[0].path).toBe('$.id');
    expect(bad.body).not.toMatch(/stack|node_modules/);
  });
  it('persists, starts and serves static JSON, headers and a query variant', async () => {
    shop.endpoints[0]!.responses[0]!.response.headers['X-Mock'] = 'yes';
    const snapshot = await create();
    const file = JSON.parse(await readFile(join(directory, 'shop.json'), 'utf8'));
    expect(file).toEqual(snapshot.config);
    expect(file).not.toHaveProperty('state');
    expect((await mock.inject('/shop/api/products')).json().error.code).toBe('PROJECT_STOPPED');
    await start();
    const response = await mock.inject('/shop/api/products');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(snapshot.config.endpoints[0]!.responses[0]!.response.body);
    expect(response.headers['x-mock']).toBe('yes');
    expect((await mock.inject('/shop/api/products?mode=error')).statusCode).toBe(500);
  });
  it('isolates two projects and matches prefix and basePath on segment boundaries', async () => {
    await create();
    const crm = {
      ...structuredClone(shop),
      id:     'crm',
      prefix: '/crm',
    };
    crm.endpoints[0]!.responses[0]!.response.status = 202;
    await create(crm);
    await start();
    await start('crm');
    expect((await mock.inject('/crm/api/products')).statusCode).toBe(202);
    expect((await mock.inject('/shop/api/products')).statusCode).toBe(200);
    expect((await mock.inject('/shopping/api/products')).json().error.code).toBe('PROJECT_NOT_FOUND');
    expect((await mock.inject('/shop/apix/products')).statusCode).toBe(404);
    expect((await mock.inject('/api/projects')).statusCode).toBe(404);
  });
  it('gives the longest matching prefix ownership even when stopped', async () => {
    await create();
    await create({
      ...structuredClone(shop),
      id:       'nested',
      prefix:   '/shop/nested',
      basePath: '/',
    });
    await start();
    expect((await mock.inject('/shop/nested/products')).json().error.code).toBe('PROJECT_STOPPED');
    await start('nested');
    expect((await mock.inject('/shop/nested/products')).statusCode).toBe(200);
  });
  it('normalizes slashes, prioritizes static routes and decodes path parameters', async () => {
    const dynamic = extraEndpoint('/products/:id');
    dynamic.responses.unshift({
      ...dynamic.responses[0]!,
      id:         'path-special',
      default:    false,
      priority:   10,
      conditions: [
        {
          id:       'path-match',
          source:   'path',
          key:      'id',
          operator: 'equals',
          value:    'hello world',
        },
      ],
      response: { ...dynamic.responses[0]!.response, status: 202 },
    });
    shop.endpoints.push(dynamic);
    shop.endpoints.push({
      ...extraEndpoint('/products/special', 'GET', 203),
    });
    await create();
    await start();
    expect((await mock.inject('/shop/api/products/special')).statusCode).toBe(203);
    expect((await mock.inject('/shop/api/products/hello%20world?ignored=yes')).statusCode).toBe(202);
    expect((await mock.inject('/shop//api//products/123/')).statusCode).toBe(201);
    expect((await mock.inject('/shop/api/products/%ZZ')).statusCode).toBe(400);
  });
  it('matches body and header conditions with AND semantics', async () => {
    const endpoint = extraEndpoint('/check', 'POST');
    endpoint.responses.unshift({
      ...endpoint.responses[0]!,
      id:         'and-response',
      default:    false,
      conditions: [
        {
          id:       'body-rule',
          source:   'body',
          key:      'user.age',
          operator: 'equals',
          value:    42,
        },
        {
          id:       'header-rule',
          source:   'header',
          key:      'X-Mode',
          operator: 'equals',
          value:    'error',
        },
      ],
      response: { ...endpoint.responses[0]!.response, status: 403 },
    });
    shop.endpoints.push(endpoint);
    await create();
    await start();
    const response = await mock.inject({
      method:  'POST',
      url:     '/shop/api/check',
      headers: { 'X-Mode': 'error' },
      payload: {
        user: { age: 42 },
      },
    });
    expect(response.statusCode).toBe(403);
    expect((await mock.inject({
      method:  'POST',
      url:     '/shop/api/check',
      payload: {
        user: { age: 42 },
      },
    })).statusCode).toBe(201);
    expect((await mock.inject({
      method:  'POST',
      url:     '/shop/api/check',
      headers: { 'content-type': 'application/json' },
      payload: '{invalid',
    })).statusCode).toBe(400);
    expect((await mock.inject('/shop/api/products')).statusCode).toBe(200);
  });
  it('uses project 404 for unknown methods and routes', async () => {
    shop.notFound.body = { message: 'shop missing' };
    shop.notFound.headers['X-Not-Found'] = 'shop';
    await create();
    await start();
    for (const request of [
      { method: 'GET', url: '/shop/api/missing' },
      { method: 'DELETE', url: '/shop/api/products' },
    ] as const) {
      const response = await mock.inject(request);
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ message: 'shop missing' });
      expect(response.headers['x-not-found']).toBe('shop');
    }
  });
  it('handles scoped preflight and gives explicit OPTIONS priority', async () => {
    shop.cors.origins = ['https://frontend.example'];
    shop.cors.credentials = true;
    await create();
    await start();
    const headers = { 'origin': 'https://frontend.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' };
    const response = await mock.inject({ method: 'OPTIONS', url: '/shop/api/products', headers });
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(headers.origin);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers['access-control-allow-methods']).toContain('POST');
    expect((await mock.inject({
      method:  'OPTIONS',
      url:     '/shop/api/products',
      headers: { ...headers, origin: 'https://evil.example' },
    })).statusCode).toBe(403);
    expect((await mock.inject({
      method:  'OPTIONS',
      url:     '/shop/api/products',
      headers: { ...headers, 'access-control-request-headers': 'x-forbidden' },
    })).statusCode).toBe(403);
    shop.endpoints.push(extraEndpoint('/products', 'OPTIONS', 202));
    expect((await save(shop)).statusCode).toBe(200);
    expect((await mock.inject({ method: 'OPTIONS', url: '/shop/api/products', headers })).statusCode).toBe(202);
    shop.cors.enabled = false;
    await save(shop);
    expect((await mock.inject({
      url:     '/shop/api/products',
      headers: { origin: headers.origin },
    })).headers).not.toHaveProperty('access-control-allow-origin');
  });
  it('reports missing default and ignores disabled variants and endpoints', async () => {
    const endpoint = shop.endpoints[0]!;
    endpoint.responses[0]!.enabled = false;
    await create();
    await start();
    const response = await mock.inject('/shop/api/products');
    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe('NO_RESPONSE_VARIANT');
    endpoint.enabled = false;
    await save(shop);
    expect((await mock.inject('/shop/api/products?mode=error')).statusCode).toBe(404);
  });
  it('updates live, stops, restarts and disables a project without changing autoStart', async () => {
    await create();
    await start();
    shop.endpoints[0]!.responses[0]!.response.body = { updated: true };
    expect((await save(shop)).statusCode).toBe(200);
    expect((await mock.inject('/shop/api/products')).json()).toEqual({ updated: true });
    expect((await admin.inject({ method: 'POST', url: '/api/projects/shop/stop' })).json().config.autoStart).toBe(true);
    expect((await mock.inject('/shop/api/products')).statusCode).toBe(404);
    await start();
    shop.enabled = false;
    await save(shop);
    expect((await mock.inject('/shop/api/products')).statusCode).toBe(404);
    expect((await admin.inject({ method: 'POST', url: '/api/projects/shop/start' })).statusCode).toBe(409);
  });
  it('autostarts persisted enabled projects and isolates invalid files on restart', async () => {
    await create();
    await writeFile(join(directory, 'broken.json'), '{invalid');
    const restarted = new ProjectStore(directory);
    await restarted.initialize();
    expect(restarted.get('shop').state).toBe('running');
    expect(restarted.diagnostics).toHaveLength(1);
    const snapshot = restarted.get('shop');
    snapshot.config.name = 'local mutation';
    expect(restarted.get('shop').config.name).toBe('Shop API');
  });
  it('enforces revisions, serializes racing writes and detects external edits', async () => {
    const created = await create();
    expect((await admin.inject({
      method:  'PATCH',
      url:     '/api/projects/shop',
      payload: { name: 'New' },
    })).statusCode).toBe(428);
    const results = await Promise.all(['First', 'Second'].map(name => admin.inject({
      method:  'PATCH',
      url:     '/api/projects/shop',
      headers: { 'if-match': `"${created.revision}"` },
      payload: { name },
    })));
    expect(results.map(response => response.statusCode).sort()).toEqual([200, 409]);
    expect(store.get('shop').config.basePath).toBe('/api');
    const current = store.get('shop');
    await writeFile(join(directory, 'shop.json'), `${JSON.stringify(current.config)}\n `);
    expect((await save(shop, current.revision)).statusCode).toBe(409);
  });
  it('rejects conflicts and keeps the last working config and file', async () => {
    const created = await create();
    const before = await readFile(join(directory, 'shop.json'), 'utf8');
    shop.endpoints.push({ ...shop.endpoints[0]! });
    expect((await save(shop)).statusCode).toBe(400);
    expect(await readFile(join(directory, 'shop.json'), 'utf8')).toBe(before);
    expect(store.get('shop').revision).toBe(created.revision);
    expect((await admin.inject({
      method:  'POST',
      url:     '/api/projects',
      payload: { id: 'other', name: 'Other', prefix: '/shop' },
    })).statusCode).toBeGreaterThanOrEqual(400);
  });
  it('duplicates projects with new IDs and prefix and deletes only selected files', async () => {
    await create();
    const copy = await admin.inject({ method: 'POST', url: '/api/projects/shop/duplicate' });
    expect(copy.statusCode, copy.body).toBe(201);
    const duplicate = copy.json<ProjectSnapshot>();
    expect(duplicate.config.id).not.toBe('shop');
    expect(duplicate.config.prefix).not.toBe('/shop');
    expect(duplicate.config.endpoints[0]!.responses[0]!.id).not.toBe(shop.endpoints[0]!.responses[0]!.id);
    const removed = await admin.inject({
      method:  'DELETE',
      url:     `/api/projects/${duplicate.config.id}`,
      headers: { 'if-match': duplicate.revision },
    });
    expect(removed.statusCode).toBe(204);
    expect(store.list()).toHaveLength(1);
    expect(await readFile(join(directory, 'shop.json'), 'utf8')).toContain('Shop API');
  });
  it('supports endpoint create, patch, duplicate and delete', async () => {
    await create();
    const change = async (method: 'POST' | 'PATCH' | 'DELETE', suffix: string, payload?: object) => admin.inject({
      method,
      url:     `/api/projects/shop/endpoints${suffix}`,
      headers: { 'if-match': store.get('shop').revision },
      ...(payload
        ? { payload }
        : {}),
    });
    const endpoint = extraEndpoint('/new');
    expect((await change('POST', '', endpoint)).statusCode).toBe(201);
    expect((await change('PATCH', `/${endpoint.id}`, { name: 'Changed' })).statusCode).toBe(200);
    const copy = await change('POST', `/${endpoint.id}/duplicate`);
    expect(copy.statusCode, copy.body).toBe(201);
    expect(copy.json<ProjectSnapshot>().config.endpoints).toHaveLength(3);
    expect((await change('DELETE', `/${endpoint.id}`)).statusCode).toBe(200);
    expect((await change('DELETE', '/missing')).statusCode).toBe(404);
  });
  it('sends valid JSON primitives, text, HEAD and bodyless statuses', async () => {
    const variant = shop.endpoints[0]!.responses[0]!;
    variant.response.body = 'a JSON string';
    shop.endpoints.push(extraEndpoint('/head', 'HEAD', 200));
    await create();
    await start();
    expect((await mock.inject('/shop/api/products')).json()).toBe('a JSON string');
    expect((await mock.inject({ method: 'HEAD', url: '/shop/api/head' })).body).toBe('');
    for (const status of [204, 304]) {
      variant.response.status = status;
      await save(shop);
      expect((await mock.inject('/shop/api/products')).body).toBe('');
    }
    variant.response.status = 200;
    variant.response.contentType = 'text/html';
    variant.response.body = '<h1>Works</h1>';
    await save(shop);
    const text = await mock.inject('/shop/api/products');
    expect(text.body).toBe('<h1>Works</h1>');
    expect(text.headers['content-type']).toContain('text/html');
  });
  it('applies fixed and random delays asynchronously', async () => {
    shop.endpoints[0]!.responses[0]!.response.delay = { type: 'fixed', value: 30 };
    await create();
    await start();
    let began = performance.now();
    const pending = mock.inject('/shop/api/products');
    expect((await admin.inject('/api/health')).statusCode).toBe(200);
    await pending;
    expect(performance.now() - began).toBeGreaterThanOrEqual(25);
    shop.endpoints[0]!.responses[0]!.response.delay = { type: 'random', min: 20, max: 30 };
    await save(shop);
    began = performance.now();
    await mock.inject('/shop/api/products');
    expect(performance.now() - began).toBeGreaterThanOrEqual(15);
  });
  it('preserves in-flight snapshot when config changes during a delay', async () => {
    shop.endpoints[0]!.responses[0]!.response.delay = { type: 'fixed', value: 40 };
    await create();
    await start();
    const pending = mock.inject('/shop/api/products').then(response => response);
    await new Promise(resolve => setTimeout(resolve, 10));
    shop.endpoints[0]!.responses[0]!.response.body = { new: true };
    await save(shop);
    expect((await pending).json()).toEqual([
      { id: 1, name: 'Example item' },
    ]);
    expect((await mock.inject('/shop/api/products')).json()).toEqual({ new: true });
  });
  it('rejects symlink project files and enforces project size limits', async () => {
    const outside = join(directory, 'outside.txt');
    await writeFile(outside, JSON.stringify(shop));
    await symlink(outside, join(directory, 'shop.json'));
    const isolated = new ProjectStore(directory);
    await isolated.initialize();
    expect(isolated.list()).toHaveLength(0);
    expect(isolated.diagnostics).toHaveLength(1);
    await expect(isolated.create(shop)).rejects.toMatchObject({ code: 'PROJECT_EXISTS' });
    const small = new ProjectStore(join(directory, 'small'), 10);
    await small.initialize();
    await expect(small.create(shop)).rejects.toMatchObject({ statusCode: 413 });
  });
  it('enforces HTTP body limits without stopping either listener', async () => {
    shop.endpoints.push(extraEndpoint('/post', 'POST'));
    await create();
    await start();
    await mock.close();
    mock = createMockServer({
      ...readConfig({}),
      maxBodySize: 128,
    }, store);
    const response = await mock.inject({
      method:  'POST',
      url:     '/shop/api/post',
      payload: {
        text: 'x'.repeat(256),
      },
    });
    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe('BAD_REQUEST');
    expect((await mock.inject('/shop/api/products')).statusCode).toBe(200);
    expect((await admin.inject('/api/health')).statusCode).toBe(200);
  });
  it('matches wildcard paths and keeps static routes more specific', async () => {
    shop.endpoints.push(extraEndpoint('/products/*'));
    await create();
    await start();
    expect((await mock.inject('/shop/api/products')).statusCode).toBe(200);
    expect((await mock.inject('/shop/api/products/many/segments')).statusCode).toBe(201);
  });
  it('returns uniform admin 404 errors before the frontend is built', async () => {
    const plain = await createAdminServer({
      ...readConfig({}),
      clientDir: join(directory, 'no-client-build'),
    }, store);
    try {
      const response = await plain.inject('/api/missing');
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        error: { code: 'NOT_FOUND', message: 'Administrative route not found' },
      });
    }
    finally {
      await plain.close();
    }
  });
});
