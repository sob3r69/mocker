import { afterEach, describe, expect, it } from 'vitest';
import { createAdminServer } from './admin/index.js';
import { readConfig } from './config/index.js';
import { createMockServer } from './mock/index.js';

const config = readConfig({});
const servers: { close: () => Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()));
});
describe('independent listeners', () => {
  it('provides health and addresses on admin only', async () => {
    const admin = await createAdminServer(config);
    servers.push(admin);
    const health = await admin.inject('/api/health');
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: 'ok' });
    expect((await admin.inject('/api/server/status')).json()).toEqual({ admin: config.admin, mock: config.mock });
  });
  it('never exposes admin API on the mock listener', async () => {
    const mock = createMockServer(config);
    servers.push(mock);
    for (const url of ['/api/health', '/api/projects', '/shop/api/products']) {
      const response = await mock.inject(url);
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('PROJECT_NOT_FOUND');
    }
  });
  it('rejects invalid or identical listener settings', () => {
    expect(() => readConfig({ MOCK_PORT: '3001' })).toThrow();
    expect(() => readConfig({ ADMIN_PORT: '-1' })).toThrow();
    expect(config.projectsDir).toMatch(/data\/projects$/);
  });
});
