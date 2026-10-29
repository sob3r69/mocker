import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ProjectStore } from '../projects/store.js';
import { createProjectSchema, idSchema, patchProjectSchema } from '@mocker/shared';
import { z } from 'zod';
import { AppError } from '../utils/errors.js';

const projectParams = z.strictObject({ id: idSchema });
const endpointParams = z.strictObject({ id: idSchema, endpointId: idSchema });
function revision(request: FastifyRequest) {
  const header = request.headers['if-match'];
  return typeof header === 'string'
    ? header.replace(/^"|"$/g, '')
    : undefined;
}
export function registerProjectRoutes(app: FastifyInstance, store: ProjectStore) {
  app.get('/api/project-changes', async () => store.changes());
  app.post('/api/projects/import', async (request, reply) => {
    const snapshot = await store.import(request.body);
    return reply.code(201).header('etag', `\"${snapshot.revision}\"`).send(snapshot);
  });
  app.get('/api/projects/:id/export', async (request, reply) => {
    const id = projectParams.parse(request.params).id;
    const document = await store.disk(id);
    if (!document.config)
      throw new AppError(409, 'CONFIG_INVALID', 'Fix the project file before exporting');
    return reply.type('application/json').header('content-disposition', `attachment; filename="${id}.json"`).header('etag', `"${document.revision}"`).send(document.text);
  });
  app.get('/api/projects/:id/disk', async request => store.disk(projectParams.parse(request.params).id));
  app.get('/api/projects', async () => store.list());
  app.get('/api/project-diagnostics', async () => store.diagnostics);
  app.post('/api/projects', async (request, reply) => {
    const snapshot = await store.create(createProjectSchema.parse(request.body));
    return reply.code(201).header('etag', `"${snapshot.revision}"`).send(snapshot);
  });
  app.get('/api/projects/:id', async (request, reply) => {
    const snapshot = store.get(projectParams.parse(request.params).id);
    return reply.header('etag', `"${snapshot.revision}"`).send(snapshot);
  });
  app.patch('/api/projects/:id', async (request, reply) => {
    const snapshot = await store.update(projectParams.parse(request.params).id, patchProjectSchema.parse(request.body), revision(request));
    return reply.header('etag', `"${snapshot.revision}"`).send(snapshot);
  });
  app.delete('/api/projects/:id', async (request, reply) => {
    await store.remove(projectParams.parse(request.params).id, revision(request));
    return reply.code(204).send();
  });
  app.post('/api/projects/:id/duplicate', async (request, reply) => reply.code(201).send(await store.duplicate(projectParams.parse(request.params).id)));
  app.get('/api/projects/:id/config', async (request, reply) => {
    const snapshot = store.get(projectParams.parse(request.params).id);
    return reply.header('etag', `"${snapshot.revision}"`).send(snapshot.config);
  });
  app.put('/api/projects/:id/config', async (request, reply) => {
    const snapshot = await store.replace(projectParams.parse(request.params).id, request.body, revision(request), z.strictObject({
      overwrite: z.enum(['true', 'false']).optional(),
    }).parse(request.query).overwrite === 'true');
    return reply.header('etag', `"${snapshot.revision}"`).send(snapshot);
  });
  for (const [action, state] of [
    ['start', 'running'],
    ['stop', 'stopped'],
  ] as const)
    app.post(`/api/projects/:id/${action}`, async request => store.setState(projectParams.parse(request.params).id, state));
  app.get('/api/projects/:id/endpoints', async request => store.get(projectParams.parse(request.params).id).config.endpoints);
  app.post('/api/projects/:id/endpoints', async (request, reply) => reply.code(201).send(await store.changeEndpoint(projectParams.parse(request.params).id, undefined, 'create', request.body, revision(request))));
  app.patch('/api/projects/:id/endpoints/:endpointId', async (request) => {
    const { id, endpointId } = endpointParams.parse(request.params);
    return store.changeEndpoint(id, endpointId, 'patch', request.body, revision(request));
  });
  app.delete('/api/projects/:id/endpoints/:endpointId', async (request) => {
    const { id, endpointId } = endpointParams.parse(request.params);
    return store.changeEndpoint(id, endpointId, 'delete', undefined, revision(request));
  });
  app.post('/api/projects/:id/endpoints/:endpointId/duplicate', async (request, reply) => {
    const { id, endpointId } = endpointParams.parse(request.params);
    return reply.code(201).send(await store.changeEndpoint(id, endpointId, 'duplicate', undefined, revision(request)));
  });
}
