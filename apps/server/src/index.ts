import { createAdminServer } from './admin/index.js';
import { readConfig } from './config/index.js';
import { createMockServer } from './mock/index.js';
import { ProjectStore } from './projects/store.js';
import { startProjectWatcher } from './watcher/index.js';

async function main() {
  const config = readConfig();
  const store = new ProjectStore(config.projectsDir, config.maxBodySize);
  await store.initialize();
  const admin = await createAdminServer(config, store);
  for (const diagnostic of store.diagnostics)
    admin.log.warn(diagnostic, 'Project was not loaded');
  const mock = createMockServer(config, store);
  let watcher: Awaited<ReturnType<typeof startProjectWatcher>> | undefined;
  let closing = false;
  async function shutdown() {
    if (closing)
      return;
    closing = true;
    const results = await Promise.allSettled([
      ...(watcher
        ? [
            watcher.close(),
          ]
        : []),
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
    watcher = await startProjectWatcher(config.projectsDir, store);
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
