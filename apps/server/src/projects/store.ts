import type { CreateProjectInput, MockEndpoint, MockProject, PatchProjectInput, ProjectDiagnostic, ProjectDiskDocument, ProjectSnapshot } from '@mocker/shared';
import type { CompiledRoutes } from '../mock/routing.js';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir } from 'node:fs/promises';
import { createProjectSchema, endpointSchema, idSchema, patchProjectSchema, projectCollectionSchema, projectSchema, validationIssues } from '@mocker/shared';
import { z } from 'zod';
import { compileRoutes } from '../mock/routing.js';
import { ProjectFiles } from '../storage/files.js';
import { AppError, isFsError } from '../utils/errors.js';
import { assertJsonBudget } from '../utils/json-budget.js';

export interface RuntimeProject extends ProjectSnapshot {
  routes:       CompiledRoutes;
  resumeState?: 'running' | 'stopped';
}
export class ProjectStore {
  private readonly entries = new Map<string, RuntimeProject>();
  private tail: Promise<unknown> = Promise.resolve();
  private readonly problems = new Map<string, ProjectDiagnostic>();
  private version = 0;
  private readonly instanceId = randomUUID();
  get diagnostics(): ProjectDiagnostic[] {
    return structuredClone([
      ...this.problems.values(),
    ].sort((a, b) => a.file.localeCompare(b.file)));
  }

  changes() {
    return { instanceId: this.instanceId, version: this.version };
  }

  reportWatchError() {
    this.problem({ file: '<watcher>', message: 'File watcher cannot read project storage' });
  }

  private problem(diagnostic: ProjectDiagnostic) {
    if (JSON.stringify(this.problems.get(diagnostic.file)) !== JSON.stringify(diagnostic)) {
      this.problems.set(diagnostic.file, diagnostic);
      this.version++;
    }
  }

  private clearProblem(file: string) {
    if (this.problems.delete(file))
      this.version++;
  }

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
    await this.refresh(true);
  }

  refresh(boot = false) {
    return this.exclusive(async () => {
      let names: string[];
      try {
        names = (await readdir(this.files.directory)).filter(name => name.endsWith('.json')).sort();
      }
      catch (error) {
        if (!isFsError(error, 'ENOENT'))
          throw error;
        names = [];
      }
      const present = new Set(names);
      for (const id of this.entries.keys()) {
        if (!present.has(`${id}.json`)) {
          this.entries.delete(id);
          this.version++;
        }
      }
      for (const file of this.problems.keys()) {
        if (file !== '<watcher>' && !present.has(file))
          this.clearProblem(file);
      }
      // Two passes let a previously conflicting file recover when another
      // project's prefix is changed in the same filesystem batch.
      for (let pass = 0; pass < 2; pass++) {
        for (const name of names)
          await this.loadFile(name, boot);
      }
    });
  }

  private async loadFile(name: string, boot: boolean) {
    let diskRevision: string | undefined;
    const parsedId = idSchema.safeParse(name.slice(0, -5));
    const previous = parsedId.success
      ? this.entries.get(parsedId.data)
      : undefined;
    try {
      const id = idSchema.parse(name.slice(0, -5));
      const file = await this.files.read(id);
      diskRevision = file.revision;
      if (previous && !previous.error && previous.revision === file.revision) {
        this.clearProblem(name);
        return;
      }
      const input: unknown = JSON.parse(file.text);
      assertJsonBudget(input);
      const config = projectSchema.parse(input);
      if (config.id !== id)
        throw new AppError(400, 'ID_MISMATCH', 'File name must match project ID');
      this.validateCollection(config);
      const state = previous
        ? previous.resumeState ?? (previous.state === 'running'
          ? 'running'
          : 'stopped')
        : boot && config.autoStart
          ? 'running'
          : 'stopped';
      this.entries.set(id, {
        config,
        revision: file.revision,
        state:    config.enabled ? state : 'stopped',
        routes:   compileRoutes(config),
      });
      this.clearProblem(name);
      this.version++;
    }
    catch (error) {
      // A file can disappear between readdir and open during an atomic save.
      if (isFsError(error, 'ENOENT')) {
        if (parsedId.success && this.entries.delete(parsedId.data))
          this.version++;
        this.clearProblem(name);
        return;
      }
      const diagnostic: ProjectDiagnostic = {
        file:    name,
        message: error instanceof z.ZodError
          ? 'Project validation failed'
          : error instanceof SyntaxError
            ? 'Invalid JSON'
            : error instanceof AppError
              ? error.message
              : 'Cannot read project file',
        ...(error instanceof z.ZodError
          ? {
              issues: validationIssues(error),
            }
          : {}),
      };
      this.problem(diagnostic);
      if (previous && (previous.error !== diagnostic.message || previous.diskRevision !== diskRevision || previous.state !== 'error')) {
        const { diskRevision: _oldDiskRevision, ...retained } = previous;
        this.entries.set(previous.config.id, {
          ...retained,
          state:       'error',
          error:       diagnostic.message,
          resumeState: previous.resumeState ?? (previous.state === 'running'
            ? 'running'
            : 'stopped'),
          ...(diskRevision
            ? { diskRevision }
            : {}),
        });
        this.version++;
      }
    }
  }

  async disk(id: string): Promise<ProjectDiskDocument> {
    this.entry(id);
    const file = await this.files.read(id);
    const issues: ProjectDiskDocument['issues'] = [];
    let config: MockProject | undefined;
    try {
      const input: unknown = JSON.parse(file.text);
      assertJsonBudget(input);
      config = projectSchema.parse(input);
      if (config.id !== id)
        throw new AppError(400, 'ID_MISMATCH', 'File name must match project ID');
      this.validateCollection(config);
      compileRoutes(config);
    }
    catch (error) {
      config = undefined;
      issues.push(...(error instanceof z.ZodError
        ? validationIssues(error)
        : [
            {
              path:    '$',
              message: error instanceof AppError
                ? error.message
                : 'Invalid JSON',
            },
          ]));
    }
    return {
      ...file,
      issues,
      ...(config
        ? { config }
        : {}),
    };
  }

  import(input: unknown) {
    return this.create(projectSchema.parse(input));
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
      ...(entry.diskRevision
        ? { diskRevision: entry.diskRevision }
        : {}),
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

  private async checkRevision(entry: RuntimeProject, revision: string | undefined, overwrite = false) {
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
    if ((!overwrite && revision !== entry.revision) || revision !== diskRevision)
      throw new AppError(409, 'REVISION_CONFLICT', 'Project changed; reload its configuration before saving');
  }

  private async persist(config: MockProject, state: 'running' | 'stopped', expectedRevision: string | null) {
    const parsed = projectSchema.parse(config);
    this.validateCollection(parsed);
    const routes = compileRoutes(parsed);
    const revision = await this.files.write(parsed.id, `${JSON.stringify(parsed, null, 2)}\n`, expectedRevision);
    const entry: RuntimeProject = {
      config: parsed,
      revision,
      state:  parsed.enabled ? state : 'stopped',
      routes,
    };
    this.entries.set(parsed.id, entry);
    this.clearProblem(`${parsed.id}.json`);
    this.version++;
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
      }), 'stopped', null);
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
      }), entry.resumeState ?? (entry.state === 'running'
        ? 'running'
        : 'stopped'), revision!);
    });
  }

  replace(id: string, input: unknown, revision: string | undefined, overwrite = false) {
    return this.exclusive(async () => {
      const entry = this.entry(id);
      await this.checkRevision(entry, revision, overwrite);
      const config = projectSchema.parse(input);
      if (config.id !== id)
        throw new AppError(400, 'ID_MISMATCH', 'Project ID cannot be changed');
      return this.persist(config, entry.resumeState ?? (entry.state === 'running'
        ? 'running'
        : 'stopped'), revision!);
    });
  }

  remove(id: string, revision: string | undefined) {
    return this.exclusive(async () => {
      const entry = this.entry(id);
      await this.checkRevision(entry, revision, true);
      await this.files.remove(id, revision!);
      this.entries.delete(id);
      this.clearProblem(`${id}.json`);
      this.version++;
    });
  }

  setState(id: string, state: 'running' | 'stopped') {
    return this.exclusive(async () => {
      const entry = this.entry(id);
      if (state === 'running' && entry.error)
        throw new AppError(409, 'CONFIG_INVALID', 'Fix or replace the project file before starting');
      if (state === 'running' && !entry.config.enabled)
        throw new AppError(409, 'PROJECT_DISABLED', 'Enable the project before starting it');
      this.entries.set(id, entry.error
        ? { ...entry, resumeState: state }
        : { ...entry, state });
      this.version++;
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
      return this.persist(config, entry.resumeState ?? (entry.state === 'running'
        ? 'running'
        : 'stopped'), revision!);
    });
  }
}
