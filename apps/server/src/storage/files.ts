import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
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
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const current = await file.stat();
      if (!current.isFile())
        throw new AppError(400, 'UNSAFE_FILE', 'Project must be a regular JSON file');
      if (current.size > this.maxBytes)
        throw new AppError(413, 'PROJECT_TOO_LARGE', 'Project configuration exceeds the size limit');
      // A bounded read also protects against a file growing after stat.
      const buffer = Buffer.alloc(this.maxBytes + 1);
      let bytes = 0;
      while (bytes < buffer.length) {
        const result = await file.read(buffer, bytes, buffer.length - bytes, bytes);
        if (result.bytesRead === 0)
          break;
        bytes += result.bytesRead;
      }
      if (bytes > this.maxBytes)
        throw new AppError(413, 'PROJECT_TOO_LARGE', 'Project configuration exceeds the size limit');
      const text = buffer.subarray(0, bytes).toString('utf8');
      return {
        text,
        revision: createHash('sha256').update(buffer.subarray(0, bytes)).digest('hex'),
      };
    }
    finally {
      await file.close();
    }
  }

  private async check(id: string, expectedRevision: string) {
    try {
      if ((await this.read(id)).revision !== expectedRevision)
        throw new AppError(409, 'REVISION_CONFLICT', 'Project file changed before saving');
    }
    catch (error) {
      if (isFsError(error, 'ENOENT'))
        throw new AppError(409, 'REVISION_CONFLICT', 'Project file was removed externally');
      throw error;
    }
  }

  async write(id: string, text: string, expectedRevision: string | null) {
    if (Buffer.byteLength(text) > this.maxBytes)
      throw new AppError(413, 'PROJECT_TOO_LARGE', 'Project configuration exceeds the size limit');
    await mkdir(this.directory, { recursive: true });
    const temporary = join(this.directory, `.${id}-${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(text, 'utf8');
        await file.sync();
      }
      finally {
        await file.close();
      }
      if (expectedRevision === null) {
        // link is atomic and cannot replace an externally-created target.
        try {
          await link(temporary, this.path(id));
        }
        catch (error) {
          if (isFsError(error, 'EEXIST'))
            throw new AppError(409, 'PROJECT_EXISTS', 'A project file with this ID already exists');
          throw error;
        }
      }
      else {
        await this.check(id, expectedRevision);
        await rename(temporary, this.path(id));
      }
    }
    finally {
      await unlink(temporary).catch((error: unknown) => {
        if (!isFsError(error, 'ENOENT'))
          throw error;
      });
    }
    return revisionOf(text);
  }

  async remove(id: string, expectedRevision: string) {
    await this.check(id, expectedRevision);
    await unlink(this.path(id));
  }
}
