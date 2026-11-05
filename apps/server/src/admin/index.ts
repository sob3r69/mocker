import type { ServerStatus } from '@mocker/shared';
import type { AppConfig } from '../config/index.js';
import type { ProjectStore } from '../projects/store.js';
import { existsSync } from 'node:fs';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { validationIssues } from '@mocker/shared';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';
import { assertJsonBudget } from '../utils/json-budget.js';
import { registerGeneratorRoutes } from './generator.js';
import { registerProjectRoutes } from './projects.js';

export async function createAdminServer(config: AppConfig, store?: ProjectStore) {
  const app = Fastify({ logger: true, bodyLimit: config.maxBodySize });
  await app.register(fastifyCors, {
    origin: ['http://127.0.0.1:5173', 'http://localhost:5173'],
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code:    'VALIDATION_ERROR',
          message: 'Configuration validation failed',
          issues:  validationIssues(error),
        },
      });
    }
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message },
      });
    }
    app.log.error(error);
    const statusCode = error instanceof Error && 'statusCode' in error
      ? error.statusCode
      : 500;
    const status = typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500
      ? statusCode
      : 500;
    void reply.code(status).send({
      error: {
        code: status === 500
          ? 'INTERNAL_ERROR'
          : 'BAD_REQUEST',
        message: status === 500
          ? 'An unexpected server error occurred'
          : error instanceof Error
            ? error.message
            : 'Invalid request',
      },
    });
  });
  app.addHook('preValidation', async request => assertJsonBudget(request.body));
  registerGeneratorRoutes(app);
  app.get('/api/health', async () => ({ status: 'ok' as const }));
  app.get('/api/server/status', async (): Promise<ServerStatus> => ({ admin: config.admin, mock: config.mock }));
  if (store)
    registerProjectRoutes(app, store);
  const servesClient = existsSync(config.clientDir);
  if (servesClient)
    await app.register(fastifyStatic, { root: config.clientDir });
  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0];
    if (!servesClient || path === '/api' || request.url.startsWith('/api/') || !request.headers.accept?.includes('text/html')) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Administrative route not found' },
      });
    }
    return reply.sendFile('index.html');
  });
  return app;
}
