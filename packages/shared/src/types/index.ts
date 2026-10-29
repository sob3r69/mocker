import type { z } from 'zod';
import type { conditionSchema, corsSchema, delaySchema, endpointSchema, httpMethodSchema, projectSchema, responseSchema, variantSchema } from '../schemas/project.js';

export type MockProject = z.infer<typeof projectSchema>;
export type MockEndpoint = z.infer<typeof endpointSchema>;
export type MockResponseVariant = z.infer<typeof variantSchema>;
export type MockResponse = z.infer<typeof responseSchema>;
export type MatchCondition = z.infer<typeof conditionSchema>;
export type ResponseDelay = z.infer<typeof delaySchema>;
export type CorsConfig = z.infer<typeof corsSchema>;
export type HttpMethod = z.infer<typeof httpMethodSchema>;
export type ProjectState = 'stopped' | 'running' | 'error';
export interface ProjectSnapshot {
  diskRevision?: string;
  config:        MockProject;
  revision:      string;
  state:         ProjectState;
  error?:        string;
}
export interface ApiError {
  error: { code: string; message: string; issues?: { path: string; message: string }[] };
}
export interface ServerStatus {
  admin: { host: string; port: number };
  mock:  { host: string; port: number };
}
export interface RequestLog {
  id:                 string;
  timestamp:          string;
  projectId?:         string;
  endpointId?:        string;
  responseVariantId?: string;
  method:             string;
  url:                string;
  requestHeaders:     Record<string, unknown>;
  requestQuery:       Record<string, unknown>;
  requestBody?:       unknown;
  responseStatus:     number;
  responseHeaders:    Record<string, unknown>;
  responseBody?:      unknown;
  durationMs:         number;
  appliedDelayMs:     number;
}

export interface ProjectDiagnostic {
  file:    string;
  message: string;
  issues?: { path: string; message: string }[];
}
export interface ProjectChanges {
  instanceId: string;
  version:    number;
}
export interface ProjectDiskDocument {
  text:     string;
  revision: string;
  config?:  MockProject;
  issues:   { path: string; message: string }[];
}
