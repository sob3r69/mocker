import type { MockResponse, ResponseDelay } from '@mocker/shared';
import type { FastifyReply } from 'fastify';
import { randomInt } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { AppError } from '../utils/errors.js';

export function resolveDelay(delay: ResponseDelay) {
  return delay.type === 'fixed'
    ? delay.value
    : randomInt(delay.min, delay.max + 1);
}
export async function sendResponse(response: MockResponse, method: string, reply: FastifyReply) {
  if (response.bodyMode === 'generated')
    throw new AppError(501, 'GENERATION_UNAVAILABLE', 'Generated response bodies are not available yet; use static body mode');
  const delay = resolveDelay(response.delay);
  if (delay > 0)
    await setTimeout(delay);
  for (const [name, value] of Object.entries(response.headers)) {
    if (name.toLowerCase() !== 'content-type')
      reply.header(name, value);
  }
  reply.code(response.status).type(response.contentType);
  if (method === 'HEAD' || [204, 304].includes(response.status))
    return reply.send();
  return reply.send(response.contentType === 'application/json'
    ? JSON.stringify(response.body)
    : response.body ?? undefined);
}
