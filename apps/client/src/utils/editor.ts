import type { MockEndpoint, MockProject, MockResponse, MockResponseVariant, ServerStatus } from '@mocker/shared';
import { fullPath } from '@mocker/shared';

export const pretty = (value: unknown) => JSON.stringify(value, null, 2);
export const newId = () => crypto.randomUUID();
export function newResponse(status = 200): MockResponse {
  return {
    status,
    contentType: 'application/json',
    headers:     {},
    body:        { message: 'Hello, world!' },
    delay:       { type: 'fixed', value: 0 },
    bodyMode:    'static',
  };
}
export function newVariant(isDefault = false): MockResponseVariant {
  return {
    id:         newId(),
    name:       isDefault ? 'Success' : 'New response',
    enabled:    true,
    default:    isDefault,
    priority:   0,
    conditions: [],
    response:   newResponse(),
  };
}
export function newEndpoint(project: MockProject): MockEndpoint {
  let path = '/endpoint';
  let index = 1;
  while (project.endpoints.some(endpoint => endpoint.method === 'GET' && endpoint.path === path))
    path = `/endpoint-${index++}`;
  return {
    id:          newId(),
    name:        'New endpoint',
    method:      'GET',
    path,
    enabled:     true,
    description: '',
    responses:   [
      newVariant(true),
    ],
  };
}
export function duplicateEndpoint(endpoint: MockEndpoint): MockEndpoint {
  return {
    ...structuredClone(endpoint),
    id:   newId(),
    name: `${endpoint.name.slice(0, 180)} (copy)`,
    path: `/copy-${newId().slice(0, 8)}${endpoint.path === '/'
      ? ''
      : endpoint.path}`,
    enabled:   false,
    responses: endpoint.responses.map(variant => ({
      ...structuredClone(variant),
      id:         newId(),
      conditions: variant.conditions.map(condition => ({
        ...condition,
        id: newId(),
      })),
    })),
  };
}
export function mockOrigin(status?: ServerStatus) {
  let host = status?.mock.host ?? '127.0.0.1';
  if (host === '0.0.0.0' || host === '::')
    host = '127.0.0.1';
  if (host.includes(':') && !host.startsWith('['))
    host = `[${host}]`;
  return `http://${host}:${status?.mock.port ?? 4000}`;
}
export function endpointUrl(project: MockProject, endpoint: Pick<MockEndpoint, 'path'>, status?: ServerStatus) {
  return `${mockOrigin(status)}${fullPath(project.prefix, project.basePath, endpoint.path)}`;
}
