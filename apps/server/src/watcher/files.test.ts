import type { MockProject, ProjectDiskDocument, ProjectSnapshot } from '@mocker/shared';
import type { FastifyInstance } from 'fastify';
import { mkdtemp, readdir, readFile, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { projectSchema } from '@mocker/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAdminServer } from '../admin/index.js';
import { readConfig } from '../config/index.js';
import { createMockServer } from '../mock/index.js';
import { ProjectStore } from '../projects/store.js';
import { ProjectFiles } from '../storage/files.js';
import { startProjectWatcher } from './index.js';

let directory: string;
let store: ProjectStore;
let admin: FastifyInstance;
let mock: FastifyInstance;
let watcher: Awaited<ReturnType<typeof startProjectWatcher>>;
let shop: MockProject;
const watched = () => join(directory, 'shop.json');
async function eventually(assertion: () => void | Promise<void>) {
  const deadline = Date.now() + 4000;
  for (;;) {
    try {
      await assertion();
      return;
    }
    catch (error) {
      if (Date.now() > deadline)
        throw error;
      await pause(25);
    }
  }
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mocker-watch-'));
  shop = projectSchema.parse(JSON.parse(await readFile(new URL('../../../../examples/shop.json', import.meta.url), 'utf8')));
  store = new ProjectStore(directory);
  await store.initialize();
  await store.create(shop);
  await store.setState('shop', 'running');
  watcher = await startProjectWatcher(directory, store);
  const config = {
    ...readConfig({}),
    projectsDir: directory,
  };
  admin = await createAdminServer(config, store);
  mock = createMockServer(config, store);
});
afterEach(async () => {
  await watcher.close();
  await Promise.all([
    admin.close(),
    mock.close(),
  ]);
  await rm(directory, { recursive: true, force: true });
});
async function saveDisk(config = shop) {
  await writeFile(join(directory, `${config.id}.json`), `${JSON.stringify(config, null, 2)}\n`);
}
async function overwrite(revision: string) {
  return admin.inject({
    method:  'PUT',
    url:     '/api/projects/shop/config?overwrite=true',
    headers: { 'if-match': revision },
    payload: shop,
  });
}

describe('project files and watcher', () => {
  it('applies external JSON without restarting and publishes a version change', async () => {
    const initial = store.changes();
    shop.endpoints[0]!.responses[0]!.response.body = { external: true };
    await saveDisk();
    await eventually(async () => expect((await mock.inject('/shop/api/products')).json()).toEqual({ external: true }));
    const response = await admin.inject('/api/project-changes');
    expect(response.json().instanceId).toBe(initial.instanceId);
    expect(response.json().version).toBeGreaterThan(initial.version);
    expect(store.get('shop').revision).not.toBe('');
  });
  it('does not restart stopped projects or alter autoStart on external edits', async () => {
    await store.setState('shop', 'stopped');
    shop.name = 'External stopped';
    await saveDisk();
    await eventually(() => expect(store.get('shop').config.name).toBe(shop.name));
    expect(store.get('shop').state).toBe('stopped');
    expect(store.get('shop').config.autoStart).toBe(true);
    expect((await mock.inject('/shop/api/products')).statusCode).toBe(404);
  });
  it('retains last good routes during invalid JSON, then recovers automatically', async () => {
    const before = store.get('shop');
    await writeFile(watched(), '{invalid');
    await eventually(() => expect(store.get('shop').state).toBe('error'));
    const snapshot = store.get('shop');
    expect(snapshot.revision).toBe(before.revision);
    expect(snapshot.diskRevision).not.toBe(before.revision);
    expect((await mock.inject('/shop/api/products')).statusCode).toBe(200);
    expect((await admin.inject('/api/project-diagnostics')).json()[0].message).toBe('Invalid JSON');
    expect((await admin.inject({ method: 'POST', url: '/api/projects/shop/start' })).statusCode).toBe(409);
    shop.name = 'Repaired';
    await saveDisk();
    await eventually(() => expect(store.get('shop').state).toBe('running'));
    expect(store.get('shop').config.name).toBe('Repaired');
    expect(store.diagnostics).toEqual([]);
  });
  it('keeps a manual stop through error and recovery', async () => {
    await writeFile(watched(), '{bad');
    await eventually(() => expect(store.get('shop').state).toBe('error'));
    await store.setState('shop', 'stopped');
    expect((await mock.inject('/shop/api/products')).statusCode).toBe(404);
    await saveDisk();
    await eventually(() => expect(store.get('shop').state).toBe('stopped'));
  });
  it('reports schema paths and recovers a previously invalid new file', async () => {
    const bad = {
      ...shop,
      id:            'new',
      prefix:        '/new',
      schemaVersion: 99,
    };
    await writeFile(join(directory, 'new.json'), JSON.stringify(bad));
    await eventually(() => expect(store.diagnostics[0]?.issues?.[0]?.path).toBe('$.schemaVersion'));
    expect(store.list()).toHaveLength(1);
    bad.schemaVersion = 1;
    await writeFile(join(directory, 'new.json'), JSON.stringify(bad));
    await eventually(() => expect(store.list()).toHaveLength(2));
    expect(store.get('new').state).toBe('stopped');
    expect(store.diagnostics).toEqual([]);
  });
  it('removes externally deleted projects and discovers new files', async () => {
    await saveDisk({ ...shop, id: 'crm', prefix: '/crm' });
    await eventually(() => expect(store.list()).toHaveLength(2));
    await store.setState('crm', 'running');
    await unlink(watched());
    await eventually(() => expect(store.list()).toHaveLength(1));
    expect((await mock.inject('/shop/api/products')).json().error.code).toBe('PROJECT_NOT_FOUND');
    expect((await mock.inject('/crm/api/products')).statusCode).toBe(200);
  });
  it('supports editor-style atomic replacement and ignores temporary files', async () => {
    shop.name = 'Atomic replacement';
    const temporary = join(directory, '.editor.tmp');
    await writeFile(temporary, JSON.stringify(shop));
    await rename(temporary, watched());
    await eventually(() => expect(store.get('shop').config.name).toBe(shop.name));
    expect(store.get('shop').state).toBe('running');
    expect(store.diagnostics).toEqual([]);
  });
  it('does not create a notification loop for its own saves or no-op scans', async () => {
    const snapshot = await store.update('shop', { name: 'Internal save' }, store.get('shop').revision);
    const version = store.changes().version;
    await pause(400);
    await store.refresh();
    expect(store.changes().version).toBe(version);
    expect(store.get('shop').revision).toBe(snapshot.revision);
    expect((await readdir(directory)).filter(name => name.endsWith('.tmp'))).toEqual([]);
  });
  it('rejects external prefix conflicts and retries after the prefix is freed', async () => {
    const other = { ...shop, id: 'aaa', prefix: '/shop' };
    await saveDisk(other);
    await eventually(() => expect(store.diagnostics[0]?.message).toMatch(/prefix/));
    expect(store.list()).toHaveLength(1);
    shop.prefix = '/moved';
    await saveDisk();
    await eventually(() => expect(store.list()).toHaveLength(2));
    expect(store.get('shop').state).toBe('running');
    expect(store.get('aaa').state).toBe('stopped');
    expect((await mock.inject('/moved/api/products')).statusCode).toBe(200);
    expect(store.diagnostics).toEqual([]);
  });
  it('stops a project when enabled becomes false externally', async () => {
    shop.enabled = false;
    await saveDisk();
    await eventually(() => expect(store.get('shop').state).toBe('stopped'));
    expect((await mock.inject('/shop/api/products')).statusCode).toBe(404);
  });
  it('loads the disk document and only overwrites the explicitly reviewed revision', async () => {
    const original = store.get('shop');
    await writeFile(watched(), '{invalid');
    await eventually(() => expect(store.get('shop').state).toBe('error'));
    const disk = (await admin.inject('/api/projects/shop/disk')).json<ProjectDiskDocument>();
    expect(disk.text).toBe('{invalid');
    expect(disk.config).toBeUndefined();
    expect(disk.issues).toHaveLength(1);
    expect((await overwrite(original.revision)).statusCode).toBe(409);
    // A second external edit invalidates even an explicit overwrite decision.
    await writeFile(watched(), '{changed again');
    expect((await overwrite(disk.revision)).statusCode).toBe(409);
    const current = (await admin.inject('/api/projects/shop/disk')).json<ProjectDiskDocument>();
    const saved = await overwrite(current.revision);
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json<ProjectSnapshot>().state).toBe('running');
    expect((await mock.inject('/shop/api/products')).statusCode).toBe(200);
  });
  it('imports and exports round-trip, rejects invalid JSON and duplicate IDs/prefixes', async () => {
    const exported = await admin.inject('/api/projects/shop/export');
    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-disposition']).toBe('attachment; filename="shop.json"');
    const config = exported.json<MockProject>();
    expect(config).toEqual(store.get('shop').config);
    expect(config).not.toHaveProperty('revision');
    const duplicate = await admin.inject({ method: 'POST', url: '/api/projects/import', payload: config });
    expect(duplicate.statusCode).toBe(409);
    config.id = 'imported';
    expect((await admin.inject({ method: 'POST', url: '/api/projects/import', payload: config })).statusCode).toBe(409);
    config.prefix = '/imported';
    const imported = await admin.inject({ method: 'POST', url: '/api/projects/import', payload: config });
    expect(imported.statusCode, imported.body).toBe(201);
    expect(JSON.parse(await readFile(join(directory, 'imported.json'), 'utf8'))).toEqual(config);
    expect(imported.headers.etag).toBe(`"${imported.json<ProjectSnapshot>().revision}"`);
    const malformed = await admin.inject({
      method:  'POST',
      url:     '/api/projects/import',
      headers: { 'content-type': 'application/json' },
      payload: '{bad',
    });
    expect(malformed.statusCode).toBe(400);
    expect((await admin.inject({
      method:  'POST',
      url:     '/api/projects/import',
      payload: { ...config, schemaVersion: 2 },
    })).statusCode).toBe(400);
  });
  it('exports fresh disk bytes and refuses to export invalid JSON before watcher delivery', async () => {
    await watcher.close();
    shop.name = 'Fresh on disk';
    await saveDisk();
    const exported = await admin.inject('/api/projects/shop/export');
    expect(exported.json<MockProject>().name).toBe(shop.name);
    await writeFile(watched(), '{bad');
    expect((await admin.inject('/api/projects/shop/export')).statusCode).toBe(409);
  });
  it('rejects symlink replacement without reading its contents and leaves good routes intact', async () => {
    const target = join(directory, 'outside.txt');
    await writeFile(target, JSON.stringify(shop));
    await unlink(watched());
    await symlink(target, watched());
    await store.refresh();
    expect(store.get('shop').state).toBe('error');
    expect(store.diagnostics[0]?.message).toMatch(/regular JSON/);
    expect((await admin.inject('/api/projects/shop/disk')).statusCode).toBe(400);
    expect((await mock.inject('/shop/api/products')).statusCode).toBe(200);
  });
  it('preserves the file and cleans up temporaries when a commit revision is stale', async () => {
    const files = new ProjectFiles(directory, 1_048_576);
    const old = await files.read('shop');
    await writeFile(watched(), '{external');
    await expect(files.write('shop', JSON.stringify(shop), old.revision)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(await readFile(watched(), 'utf8')).toBe('{external');
    await expect(files.write('shop', JSON.stringify(shop), null)).rejects.toMatchObject({ code: 'PROJECT_EXISTS' });
    expect((await readdir(directory)).filter(name => name.endsWith('.tmp'))).toEqual([]);
  });
});
