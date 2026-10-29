import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config/index.js';
import type { ProjectStore } from '../projects/store.js';
import { fullPath, HTTP_METHODS } from '@mocker/shared';
import Fastify from 'fastify';
import { AppError } from '../utils/errors.js';
import { selectVariant } from './conditions.js';
import { applyCors, preflightAllowed } from './cors.js';
import { sendResponse } from './response.js';
import { findProject, requestPath, withinPrefix } from './routing.js';

export function createMockServer(config: AppConfig, store?: ProjectStore) {
  const app = Fastify({
    logger:           true,
    bodyLimit:        config.maxBodySize,
    exposeHeadRoutes: false,
    routerOptions:    { ignoreDuplicateSlashes: true, ignoreTrailingSlash: true, maxParamLength: 4096 },
  });
  app.addContentTypeParser('*', { parseAs: 'string' }, (_request, body, done) => done(null, body));
  const notFound = (reply: FastifyReply, code: string, message: string) => reply.code(404).send({
    error: { code, message },
  });
  async function handle(request: FastifyRequest, reply: FastifyReply) {
    const path = requestPath(request.raw.url ?? request.url);
    const project = findProject(store?.runtimeProjects() ?? [], path);
    if (!project)
      return notFound(reply, 'PROJECT_NOT_FOUND', 'No mock project matches this URL');
    if (project.state !== 'running' && !(project.state === 'error' && project.resumeState === 'running'))
      return notFound(reply, 'PROJECT_STOPPED', 'Mock project is stopped');
    const allowedOrigin = applyCors(project.config.cors, request, reply);
    const match = project.routes.match(request.method.toUpperCase(), path);
    if (!match) {
      const isPreflight = request.method === 'OPTIONS' && request.headers.origin && request.headers['access-control-request-method'];
      if (isPreflight && project.config.cors.enabled && withinPrefix(path, fullPath(project.config.prefix, project.config.basePath, '/'))) {
        reply.header('vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
        if (!allowedOrigin || !preflightAllowed(project.config.cors, request))
          throw new AppError(403, 'CORS_DENIED', 'Preflight origin, method or headers are not allowed');
        reply.header('access-control-allow-methods', project.config.cors.methods.join(', '));
        reply.header('access-control-allow-headers', project.config.cors.allowedHeaders.join(', '));
        reply.header('access-control-max-age', project.config.cors.maxAge);
        return reply.code(204).send();
      }
      return sendResponse(project.config.notFound, request.method, reply);
    }
    const variant = selectVariant(match.endpoint, {
      path:   match.params,
      query:  request.query as Record<string, unknown>,
      header: request.headers,
      body:   request.body,
    });
    if (!variant)
      throw new AppError(500, 'NO_RESPONSE_VARIANT', 'No response variant matches and no enabled default is configured');
    return sendResponse(variant.response, request.method, reply);
  }
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message },
      });
    }
    const status = error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500
      ? error.statusCode
      : 500;
    if (status === 500)
      app.log.error(error);
    return reply.code(status).send({
      error: {
        code: status === 500
          ? 'INTERNAL_ERROR'
          : 'BAD_REQUEST',
        message: status === 500
          ? 'Unexpected mock server error'
          : 'Invalid request body, URL or content type',
      },
    });
  });
  app.route({
    method:  [...HTTP_METHODS],
    url:     '/',
    handler: handle,
  });
  app.route({
    method:  [...HTTP_METHODS],
    url:     '/*',
    handler: handle,
  });
  app.setNotFoundHandler((_request, reply) => notFound(reply, 'PROJECT_NOT_FOUND', 'No mock project matches this URL'));
  return app;
}
