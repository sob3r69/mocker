import type { HttpMethod, MockEndpoint, MockProject } from '@mocker/shared';
import { fullPath, HTTP_METHODS, normalizePath } from '@mocker/shared';
import Router from 'find-my-way';
import { AppError } from '../utils/errors.js';

export function compileRoutes(project: MockProject) {
  const router = Router({ ignoreTrailingSlash: true, ignoreDuplicateSlashes: true, maxParamLength: 2048 });
  const endpoints = new Map<string, MockEndpoint>();
  try {
    for (const endpoint of project.endpoints) {
      if (!endpoint.enabled)
        continue;
      endpoints.set(endpoint.id, endpoint);
      router.on(endpoint.method, fullPath(project.prefix, project.basePath, endpoint.path), () => {}, endpoint.id);
    }
  }
  catch {
    throw new AppError(400, 'ROUTE_CONFLICT', 'Routes cannot be compiled; check conflicting or invalid paths');
  }
  return {
    match(method: string, path: string) {
      if (!HTTP_METHODS.includes(method as HttpMethod))
        return undefined;
      const match = router.find(method as HttpMethod, path);
      const endpoint = match
        ? endpoints.get(String(match.store))
        : undefined;
      return endpoint && match
        ? { endpoint, params: match.params }
        : undefined;
    },
  };
}
export type CompiledRoutes = ReturnType<typeof compileRoutes>;

export function requestPath(url: string) {
  const raw = url.split('?')[0] ?? '/';
  try {
    // Validate encoding without decoding segment separators before matching.
    decodeURI(raw);
  }
  catch {
    throw new AppError(400, 'BAD_URL', 'Invalid URL encoding');
  }
  return normalizePath(raw);
}
export function withinPrefix(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`);
}
export function findProject<T extends { config: MockProject }>(projects: T[], path: string): T | undefined {
  return projects.filter(project => withinPrefix(path, project.config.prefix)).sort((a, b) => b.config.prefix.length - a.config.prefix.length)[0];
}
