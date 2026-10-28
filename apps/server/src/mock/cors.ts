import type { CorsConfig } from '@mocker/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

export function applyCors(config: CorsConfig, request: FastifyRequest, reply: FastifyReply) {
  if (!config.enabled)
    return false;
  reply.header('vary', 'Origin');
  const origin = request.headers.origin;
  if (!origin || !(config.origins.includes('*') || config.origins.includes(origin)))
    return false;
  reply.header('access-control-allow-origin', config.origins.includes('*')
    ? '*'
    : origin);
  if (config.credentials)
    reply.header('access-control-allow-credentials', 'true');
  if (config.exposedHeaders.length)
    reply.header('access-control-expose-headers', config.exposedHeaders.join(', '));
  return true;
}
export function preflightAllowed(config: CorsConfig, request: FastifyRequest) {
  const method = request.headers['access-control-request-method'];
  const requestedHeaders = String(request.headers['access-control-request-headers'] ?? '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  const allowedHeaders = config.allowedHeaders.map(value => value.toLowerCase());
  return typeof method === 'string' && config.methods.map(allowed => String(allowed)).includes(method.toUpperCase())
    && requestedHeaders.every(header => allowedHeaders.includes(header) || allowedHeaders.includes('*'));
}
