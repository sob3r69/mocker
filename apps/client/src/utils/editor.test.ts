import { projectSchema } from '@mocker/shared';
import { describe, expect, it } from 'vitest';
import shop from '../../../../examples/shop.json';
import { duplicateEndpoint, endpointUrl, newEndpoint } from './editor';

describe('endpoint editing', () => {
  it('duplicates nested IDs without route conflicts or reference sharing', () => {
    const project = projectSchema.parse(shop);
    const endpoint = project.endpoints[0]!;
    const copy = duplicateEndpoint(endpoint);
    expect(copy.enabled).toBe(false);
    expect(copy.id).not.toBe(endpoint.id);
    expect(copy.responses[1]!.conditions[0]!.id).not.toBe(endpoint.responses[1]!.conditions[0]!.id);
    project.endpoints.push(copy);
    expect(projectSchema.safeParse(project).success).toBe(true);
    copy.responses[0]!.name = 'Edited copy';
    expect(endpoint.responses[0]!.name).toBe('Success');
  });
  it('creates non-conflicting GET paths', () => {
    const project = projectSchema.parse(shop);
    const first = newEndpoint(project);
    project.endpoints.push(first);
    const next = newEndpoint(project);
    expect(next.path).not.toBe(first.path);
    project.endpoints.push(next);
    expect(projectSchema.safeParse(project).success).toBe(true);
  });
  it('builds full URLs using the mock listener and normalizes its public host', () => {
    const project = projectSchema.parse(shop);
    expect(endpointUrl(project, { path: '/products/' }, {
      admin: { host: '127.0.0.1', port: 3001 },
      mock:  { host: '0.0.0.0', port: 4567 },
    })).toBe('http://127.0.0.1:4567/shop/api/products');
  });
});
