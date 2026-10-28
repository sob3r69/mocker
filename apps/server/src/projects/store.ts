import type { CreateProjectInput, MockEndpoint, MockProject, PatchProjectInput, ProjectSnapshot, ProjectState } from '@mocker/shared';
import type { CompiledRoutes } from '../mock/routing.js';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir } from 'node:fs/promises';
import { createProjectSchema, endpointSchema, idSchema, patchProjectSchema, projectCollectionSchema, projectSchema } from '@mocker/shared';
import { z } from 'zod';
import { compileRoutes } from '../mock/routing.js';
import { ProjectFiles } from '../storage/files.js';
import { AppError, isFsError } from '../utils/errors.js';

export interface RuntimeProject extends ProjectSnapshot {
  routes: CompiledRoutes;
}
export class ProjectStore {
  private readonly entries = new Map<string, RuntimeProject>();
  private tail:           Promise<unknown> = Promise.resolve();
  readonly diagnostics:   { file: string; message: string }[] = [];
  private readonly files: ProjectFiles;
  constructor(directory: string, maxBytes = 1_048_576) {
    this.files = new ProjectFiles(directory, maxBytes);
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => {});
    try {
      return await result;
    }
    catch (error) {
      if (error instanceof Error && 'code' in error && typeof error.code === 'string' && /^E[A-Z]+$/.test(error.code))
        throw new AppError(500, 'STORAGE_ERROR', 'Cannot access project storage');
      throw error;
    }
  }

  async initialize() {
    await mkdir(this.files.directory, { recursive: true });
    const names = (await readdir(this.files.directory)).filter(name => name.endsWith('.json')).sort();
    for (const name of names) {
      try {
        const id = idSchema.parse(name.slice(0, -5));
        const file = await this.files.read(id);
        const config = projectSchema.parse(JSON.parse(file.text));
        if (config.id !== id)
          throw new AppError(400, 'ID_MISMATCH', 'File name must match project ID');
        this.validateCollection(config);
        this.entries.set(id, {
          config,
          revision: file.revision,
          state:    config.enabled && config.autoStart
            ? 'running'
            : 'stopped',
          routes: compileRoutes(config),
        });
      }
      catch {
        this.diagnostics.push({ file: name, message: 'Cannot load project: invalid JSON, schema, routes, duplicate prefix or inaccessible file' });
      }
    }
  }

  private validateCollection(config: MockProject) {
    if ([
      ...this.entries.values(),
    ].some(entry => entry.config.id !== config.id && entry.config.prefix === config.prefix)) {
      throw new AppError(409, 'PREFIX_CONFLICT', 'Project prefix already exists');
    }
    projectCollectionSchema.parse([
      ...this.entries.values(),
    ].filter(entry => entry.config.id !== config.id).map(entry => entry.config).concat(config));
  }

  private entry(id: string) {
    idSchema.parse(id);
    const entry = this.entries.get(id);
    if (!entry)
      throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project does not exist');
    return entry;
  }

  runtimeProjects(): RuntimeProject[] {
    return [
      ...this.entries.values(),
    ];
  }

  private snapshot(entry: RuntimeProject): ProjectSnapshot {
    return structuredClone({
      config:   entry.config,
      revision: entry.revision,
      state:    entry.state,
      ...(entry.error
        ? { error: entry.error }
        : {}),
    });
  }

  list() {
    return [
      ...this.entries.values(),
    ].map(entry => this.snapshot(entry));
  }

  get(id: string) {
    return this.snapshot(this.entry(id));
  }

  private async checkRevision(entry: RuntimeProject, revision: string | undefined) {
    if (!revision)
      throw new AppError(428, 'REVISION_REQUIRED', 'Send the current project revision in If-Match');
    let diskRevision: string;
    try {
      diskRevision = (await this.files.read(entry.config.id)).revision;
    }
    catch (error) {
      if (isFsError(error, 'ENOENT'))
        throw new AppError(409, 'REVISION_CONFLICT', 'Project file was removed externally');
      throw error;
    }
    if (revision !== entry.revision || revision !== diskRevision)
      throw new AppError(409, 'REVISION_CONFLICT', 'Project changed; reload its configuration before saving');
  }

  private async persist(config: MockProject, state: ProjectState) {
    const parsed = projectSchema.parse(config);
    this.validateCollection(parsed);
    const routes = compileRoutes(parsed);
    const revision = await this.files.write(parsed.id, `${JSON.stringify(parsed, null, 2)}\n`);
    const entry: RuntimeProject = {
      config: parsed,
      revision,
      state:  parsed.enabled ? state : 'stopped',
      routes,
    };
    this.entries.set(parsed.id, entry);
    return this.snapshot(entry);
  }

  create(input: CreateProjectInput) {
    return this.exclusive(async () => {
      const parsed = createProjectSchema.parse(input);
      const { id } = parsed;
      if (this.entries.has(id))
        throw new AppError(409, 'PROJECT_EXISTS', 'Project ID already exists');
      try {
        await lstat(this.files.path(id));
        throw new AppError(409, 'PROJECT_EXISTS', 'A project file with this ID already exists');
      }
      catch (error) {
        if (!isFsError(error, 'ENOENT'))
          throw error;
      }
      return this.persist(projectSchema.parse({
        ...parsed,
        cors: parsed.cors ?? {
          enabled: true,
          origins: ['*'],
          methods: [
            'GET',
            'POST',
            'PUT',
            'PATCH',
            'DELETE',
            'HEAD',
            'OPTIONS',
          ],
          allowedHeaders: ['Content-Type', 'Authorization'],
        },
        notFound: parsed.notFound ?? {
          status:      404,
          contentType: 'application/json',
          headers:     {},
          body:        { error: 'Endpoint not found' },
          delay:       { type: 'fixed', value: 0 },
        },
      }), 'stopped');
    });
  }

  update(id: string, input: PatchProjectInput, revision: string | undefined) {
    return this.exclusive(async () => {
      const entry = this.entry(id);
      await this.checkRevision(entry, revision);
      const patch = patchProjectSchema.parse(input);
      return this.persist(projectSchema.parse({
        ...entry.config,
        ...patch,
      }), entry.state);
    });
  }

  replace(id: string, input: unknown, revision: string | undefined) {
    return this.exclusive(async () => {
      const entry = this.entry(id);
      await this.checkRevision(entry, revision);
      const config = projectSchema.parse(input);
      if (config.id !== id)
        throw new AppError(400, 'ID_MISMATCH', 'Project ID cannot be changed');
      return this.persist(config, entry.state);
    });
  }

  remove(id: string, revision: string | undefined) {
    return this.exclusive(async () => {
      const entry = this.entry(id);
      await this.checkRevision(entry, revision);
      await this.files.remove(id);
      this.entries.delete(id);
    });
  }

  setState(id: string, state: 'running' | 'stopped') {
    return this.exclusive(async () => {
      const entry = this.entry(id);
      if (state === 'running' && !entry.config.enabled)
        throw new AppError(409, 'PROJECT_DISABLED', 'Enable the project before starting it');
      this.entries.set(id, { ...entry, state });
      return this.get(id);
    });
  }

  async duplicate(id: string) {
    const config = this.get(id).config;
    config.id = `copy-${randomUUID()}`;
    config.name = `${config.name.slice(0, 180)} (copy)`;
    config.prefix = `${config.prefix}-copy-${randomUUID().slice(0, 8)}`;
    for (const endpoint of config.endpoints) {
      endpoint.id = randomUUID();
      for (const variant of endpoint.responses) {
        variant.id = randomUUID();
        for (const condition of variant.conditions)
          condition.id = randomUUID();
      }
    }
    return this.create(config);
  }

  changeEndpoint(id: string, endpointId: string | undefined, operation: 'create' | 'patch' | 'delete' | 'duplicate', input: unknown, revision: string | undefined) {
    return this.exclusive(async () => {
      const entry = this.entry(id);
      await this.checkRevision(entry, revision);
      const config = structuredClone(entry.config);
      const index = config.endpoints.findIndex(endpoint => endpoint.id === endpointId);
      if (operation !== 'create' && index < 0)
        throw new AppError(404, 'ENDPOINT_NOT_FOUND', 'Endpoint does not exist');
      if (operation === 'create') {
        config.endpoints.push(endpointSchema.parse(input));
      }
      else if (operation === 'delete') {
        config.endpoints.splice(index, 1);
      }
      else if (operation === 'patch') {
        const patch = z.strictObject(endpointSchema.shape).omit({ id: true }).partial().parse(input);
        config.endpoints[index] = endpointSchema.parse({
          ...config.endpoints[index],
          ...patch,
        });
      }
      else {
        const copy = structuredClone(config.endpoints[index]) as MockEndpoint;
        copy.id = randomUUID();
        copy.name = `${copy.name.slice(0, 180)} (copy)`;
        // A duplicate must have a unique route before it can be persisted.
        copy.path = `/copy-${randomUUID().slice(0, 8)}${copy.path === '/'
          ? ''
          : copy.path}`;
        copy.enabled = false;
        for (const variant of copy.responses) {
          variant.id = randomUUID();
          for (const condition of variant.conditions)
            condition.id = randomUUID();
        }
        config.endpoints.push(copy);
      }
      return this.persist(config, entry.state);
    });
  }
}
