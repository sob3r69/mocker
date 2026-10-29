import type { ProjectStore } from '../projects/store.js';
import { once } from 'node:events';
import { watch } from 'chokidar';

export async function startProjectWatcher(directory: string, store: ProjectStore) {
  const watcher = watch(directory, {
    ignoreInitial:    true,
    depth:            0,
    followSymlinks:   false,
    atomic:           150,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 25 },
  });
  let closing = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<unknown> = Promise.resolve();
  watcher.on('all', () => {
    if (closing)
      return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      pending = store.refresh().catch(() => store.reportWatchError());
    }, 30);
  });
  watcher.on('error', () => store.reportWatchError());
  try {
    await once(watcher, 'ready');
    // Covers edits between startup loading and watcher subscription.
    await store.refresh();
  }
  catch (error) {
    closing = true;
    clearTimeout(timer);
    await watcher.close();
    throw error;
  }
  return {
    async close() {
      closing = true;
      clearTimeout(timer);
      await watcher.close();
      await pending;
    },
  };
}
