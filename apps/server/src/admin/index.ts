import type { ServerStatus } from '@mocker/shared';
import type { AppConfig } from '../config/index.js';
import { existsSync } from 'node:fs';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';

export async function createAdminServer(config: AppConfig) {
  const app = Fastify({ logger: true, bodyLimit: config.maxBodySize });
  await app.register(fastifyCors, {
    origin: ['http://127.0.0.1:5173', 'http://localhost:5173'],
  });
  app.get('/api/health', async () => ({ status: 'ok' as const }));
  app.get('/api/server/status', async (): Promise<ServerStatus> => ({ admin: config.admin, mock: config.mock }));
  if (existsSync(config.clientDir)) {
    await app.register(fastifyStatic, { root: config.clientDir });
    app.setNotFoundHandler((request, reply) => {
      if ((request.url.split('?')[0] === '/api' || request.url.startsWith('/api/')) || !request.headers.accept?.includes('text/html')) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'Administrative route not found' },
        });
      }
      return reply.sendFile('index.html');
    });
  }
  app.setErrorHandler((error, _request, reply) => {
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
  return app;
}
