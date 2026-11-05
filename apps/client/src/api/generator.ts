import type { GenerationConfig, GenerationPreview, InferGenerationInput } from '@mocker/shared';
import { api } from './client';

export const generatorApi = {
  infer:   async (input: InferGenerationInput) => (await api.post<{ generation: GenerationConfig }>('/generator/infer', input)).data.generation,
  preview: async (generation: GenerationConfig) => (await api.post<GenerationPreview>('/generator/preview', generation)).data,
};
