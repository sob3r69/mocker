import type { AppConfig } from '../config/index.js';
import Fastify from 'fastify';

export function createMockServer(config: AppConfig) {
  const app = Fastify({ logger: true, bodyLimit: config.maxBodySize });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({
    error: { code: 'PROJECT_NOT_FOUND', message: 'No running mock project matches this URL' },
  }));
  return app;
}
