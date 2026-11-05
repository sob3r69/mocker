import type { generationSchema } from './project.js';
import { z } from 'zod';
import { MAX_GENERATED_ITEMS } from '../constants/index.js';
import { jsonValueSchema } from './project.js';

export const inferGenerationSchema = z.strictObject({
  example:    jsonValueSchema,
  arrayCount: z.number().int().min(0).max(MAX_GENERATED_ITEMS).optional(),
  seed:       z.number().int().optional(),
});
export type InferGenerationInput = z.infer<typeof inferGenerationSchema>;
export type GenerationConfig = z.infer<typeof generationSchema>;
export interface GenerationPreview {
  generation: GenerationConfig;
  body:       z.infer<typeof jsonValueSchema>;
}
