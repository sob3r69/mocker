import type { GenerationPreview } from '@mocker/shared';
import type { FastifyInstance } from 'fastify';
import { generationSchema } from '@mocker/shared';
import { generateBody, inferGeneration } from '../generator/index.js';

export function registerGeneratorRoutes(app: FastifyInstance) {
  app.post('/api/generator/infer', async (request) => {
    const generation = inferGeneration(request.body);
    return { generation };
  });
  app.post('/api/generator/preview', async (request): Promise<GenerationPreview> => {
    const generation = generationSchema.parse(request.body);
    return {
      generation,
      body: generateBody(generation),
    };
  });
}
