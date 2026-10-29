import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  const closed = once(server, 'close');
  server.close();
  await closed;
  return address.port;
}
async function main() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const directory = await mkdtemp(join(tmpdir(), 'mocker-http-smoke-'));
  const adminPort = await freePort();
  let mockPort = await freePort();
  while (mockPort === adminPort)
    mockPort = await freePort();
  const adminUrl = `http://127.0.0.1:${adminPort}`;
  const mockUrl = `http://127.0.0.1:${mockPort}`;
  let child;
  let exited;
  let output = '';
  async function stop() {
    if (!child)
      return;
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    try {
      const [code, signal] = await exited;
      assert.equal(code, 0, `Server shutdown failed: ${signal}\n${output}`);
    }
    finally {
      clearTimeout(timer);
      child = undefined;
    }
  }
  async function boot() {
    child = spawn(process.execPath, ['apps/server/dist/index.js'], {
      cwd: root,
      env: {
        ...process.env,
        ADMIN_HOST:   '127.0.0.1',
        ADMIN_PORT:   String(adminPort),
        MOCK_HOST:    '127.0.0.1',
        MOCK_PORT:    String(mockPort),
        PROJECTS_DIR: directory,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    exited = once(child, 'exit');
    output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        if ((await fetch(`${adminUrl}/api/health`, {
          signal: AbortSignal.timeout(500),
        })).ok) {
          return;
        }
      }
      catch {}
      if (child.exitCode !== null)
        throw new Error(`Server exited during startup\n${output}`);
      await pause(100);
    }
    throw new Error(`Server did not become ready\n${output}`);
  }
  async function request(base, path, options) {
    return fetch(`${base}${path}`, {
      ...options,
      signal: AbortSignal.timeout(3000),
    });
  }
  try {
    await boot();
    const example = JSON.parse(await readFile(new URL('../examples/shop.json', import.meta.url), 'utf8'));
    const created = await request(adminUrl, '/api/projects', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify(example),
    });
    assert.equal(created.status, 201);
    const snapshot = await created.json();
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'shop.json'), 'utf8')), snapshot.config);
    assert.equal((await request(adminUrl, '/api/projects/shop/start', { method: 'POST' })).status, 200);
    const success = await request(mockUrl, '/shop/api/products');
    assert.equal(success.status, 200);
    assert.deepEqual(await success.json(), example.endpoints[0].responses[0].response.body);
    assert.equal((await request(mockUrl, '/shop/api/products?mode=error')).status, 500);
    assert.equal((await request(mockUrl, '/api/projects')).status, 404);
    const page = await request(adminUrl, '/', {
      headers: { accept: 'text/html' },
    });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Mock HTTP Server/);
    snapshot.config.endpoints[0].responses[0].response.body = { updated: true };
    const saved = await request(adminUrl, '/api/projects/shop/config', {
      method:  'PUT',
      headers: { 'content-type': 'application/json', 'if-match': snapshot.revision },
      body:    JSON.stringify(snapshot.config),
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(await (await request(mockUrl, '/shop/api/products')).json(), { updated: true });
    const beforeExternal = await (await request(adminUrl, '/api/project-changes')).json();
    snapshot.config.endpoints[0].responses[0].response.body = { external: true };
    await writeFile(join(directory, 'shop.json'), JSON.stringify(snapshot.config));
    async function eventually(check) {
      for (let attempt = 0; attempt < 50; attempt++) {
        if (await check())
          return;
        await pause(50);
      }
      throw new Error('Filesystem update did not reach HTTP API');
    }
    await eventually(async () => (await (await request(mockUrl, '/shop/api/products')).json()).external === true);
    assert((await (await request(adminUrl, '/api/project-changes')).json()).version > beforeExternal.version);
    await writeFile(join(directory, 'shop.json'), '{invalid');
    await eventually(async () => (await (await request(adminUrl, '/api/projects/shop')).json()).state === 'error');
    assert.deepEqual(await (await request(mockUrl, '/shop/api/products')).json(), { external: true });
    const disk = await (await request(adminUrl, '/api/projects/shop/disk')).json();
    snapshot.config.endpoints[0].responses[0].response.body = { updated: true };
    const recovered = await request(adminUrl, '/api/projects/shop/config?overwrite=true', {
      method:  'PUT',
      headers: { 'content-type': 'application/json', 'if-match': disk.revision },
      body:    JSON.stringify(snapshot.config),
    });
    assert.equal(recovered.status, 200);
    const exported = await request(adminUrl, '/api/projects/shop/export');
    assert.equal(exported.status, 200);
    const importedConfig = {
      ...await exported.json(),
      id:     'crm',
      prefix: '/crm',
    };
    const imported = await request(adminUrl, '/api/projects/import', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify(importedConfig),
    });
    assert.equal(imported.status, 201);
    assert.equal((await request(adminUrl, '/api/projects/crm/start', { method: 'POST' })).status, 200);
    assert.deepEqual(await (await request(mockUrl, '/crm/api/products')).json(), { updated: true });
    assert.equal((await request(adminUrl, '/api/projects/shop/stop', { method: 'POST' })).status, 200);
    assert.equal((await request(mockUrl, '/shop/api/products')).status, 404);
    await stop();
    await boot();
    assert.deepEqual(await (await request(mockUrl, '/shop/api/products')).json(), { updated: true });
    console.log('HTTP smoke passed: create, disk persistence, start, JSON, conditional 500, listener isolation, frontend, live update, stop, restart, autoStart, file watcher, invalid-file recovery, import/export and change notifications');
    await stop();
    console.log('Graceful SIGTERM shutdown passed');
  }
  finally {
    await stop();
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
