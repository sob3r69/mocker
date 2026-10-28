import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { idSchema } from '@mocker/shared';
import { AppError, isFsError } from '../utils/errors.js';

export function revisionOf(text: string) {
  return createHash('sha256').update(text).digest('hex');
}
export class ProjectFiles {
  constructor(public readonly directory: string, private readonly maxBytes: number) {}
  path(id: string) {
    return join(this.directory, `${idSchema.parse(id)}.json`);
  }

  async read(id: string) {
    const path = this.path(id);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new AppError(400, 'UNSAFE_FILE', 'Project must be a regular JSON file');
    if (stat.size > this.maxBytes)
      throw new AppError(413, 'PROJECT_TOO_LARGE', 'Project configuration exceeds the size limit');
    const text = await readFile(path, 'utf8');
    if (Buffer.byteLength(text) > this.maxBytes)
      throw new AppError(413, 'PROJECT_TOO_LARGE', 'Project configuration exceeds the size limit');
    return {
      text,
      revision: revisionOf(text),
    };
  }

  async write(id: string, text: string) {
    if (Buffer.byteLength(text) > this.maxBytes)
      throw new AppError(413, 'PROJECT_TOO_LARGE', 'Project configuration exceeds the size limit');
    await mkdir(this.directory, { recursive: true });
    const temporary = join(this.directory, `.${id}-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, text, { flag: 'wx', mode: 0o600 });
      await rename(temporary, this.path(id));
    }
    finally {
      await unlink(temporary).catch((error: unknown) => {
        if (!isFsError(error, 'ENOENT'))
          throw error;
      });
    }
    return revisionOf(text);
  }

  async remove(id: string) {
    await unlink(this.path(id));
  }
}
