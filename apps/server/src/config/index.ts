import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const envSchema = z.object({
  ADMIN_HOST:      z.string().default('127.0.0.1'),
  ADMIN_PORT:      z.coerce.number().int().min(1).max(65535).default(3001),
  MOCK_HOST:       z.string().default('127.0.0.1'),
  MOCK_PORT:       z.coerce.number().int().min(1).max(65535).default(4000),
  PROJECTS_DIR:    z.string().default('./data/projects'),
  LOG_BUFFER_SIZE: z.coerce.number().int().min(1).max(100_000).default(1000),
  MAX_BODY_SIZE:   z.coerce.number().int().min(1).max(10_485_760).default(1_048_576),
}).refine(env => env.ADMIN_PORT !== env.MOCK_PORT || env.ADMIN_HOST !== env.MOCK_HOST, 'Admin and mock listeners must use different addresses');

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const settings = envSchema.parse(env);
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  return {
    admin:         { host: settings.ADMIN_HOST, port: settings.ADMIN_PORT },
    mock:          { host: settings.MOCK_HOST, port: settings.MOCK_PORT },
    projectsDir:   resolve(root, settings.PROJECTS_DIR),
    clientDir:     resolve(root, 'apps/client/dist'),
    logBufferSize: settings.LOG_BUFFER_SIZE,
    maxBodySize:   settings.MAX_BODY_SIZE,
  };
}
export type AppConfig = ReturnType<typeof readConfig>;
