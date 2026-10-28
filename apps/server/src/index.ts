import { createAdminServer } from './admin/index.js';
import { readConfig } from './config/index.js';
import { createMockServer } from './mock/index.js';

async function main() {
  const config = readConfig();
  const admin = await createAdminServer(config);
  const mock = createMockServer(config);
  let closing = false;
  async function shutdown() {
    if (closing)
      return;
    closing = true;
    const results = await Promise.allSettled([
      admin.close(),
      mock.close(),
    ]);
    if (results.some(result => result.status === 'rejected'))
      process.exitCode = 1;
  }
  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });
  try {
    await admin.listen(config.admin);
    await mock.listen(config.mock);
  }
  catch (error) {
    admin.log.error(error);
    await shutdown();
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
