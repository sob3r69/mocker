import { z } from 'zod';
import { projectSchema } from './project.js';

export const createProjectSchema = z.strictObject({
  id:            projectSchema.shape.id,
  name:          projectSchema.shape.name,
  prefix:        projectSchema.shape.prefix,
  description:   projectSchema.shape.description,
  basePath:      projectSchema.shape.basePath,
  enabled:       z.boolean().default(true),
  autoStart:     z.boolean().default(false),
  cors:          projectSchema.shape.cors.optional(),
  notFound:      projectSchema.shape.notFound.optional(),
  endpoints:     projectSchema.shape.endpoints.default([]),
  schemaVersion: z.literal(1).default(1),
});
export const patchProjectSchema = z.strictObject({
  ...projectSchema.shape,
  basePath: projectSchema.shape.basePath.removeDefault(),
}).omit({ id: true, schemaVersion: true }).partial();
export type CreateProjectInput = z.input<typeof createProjectSchema>;
export type PatchProjectInput = z.input<typeof patchProjectSchema>;
