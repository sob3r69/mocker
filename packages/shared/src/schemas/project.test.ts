import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fullPath, normalizePath, projectCollectionSchema, projectJsonSchema, projectSchema } from './project.js';

function example(name = 'shop') {
  return JSON.parse(readFileSync(new URL(`../../../../examples/${name}.json`, import.meta.url), 'utf8'));
}

describe('project contract', () => {
  it('accepts both independent examples', () => {
    expect(projectCollectionSchema.parse([
      example(),
      example('crm'),
    ])).toHaveLength(2);
  });
  it('exports an input JSON Schema for Monaco', () => {
    expect(projectJsonSchema).toHaveProperty('properties.schemaVersion');
    expect(projectJsonSchema).toHaveProperty('additionalProperties', false);
  });
  it('normalizes URL boundaries consistently', () => {
    expect(normalizePath('//shop///')).toBe('/shop');
    expect(fullPath('/shop/', '/api/', '/products/')).toBe('/shop/api/products');
    expect(fullPath('/shop', '', '/')).toBe('/shop');
  });
  it('rejects unknown fields instead of stripping them', () => {
    expect(projectSchema.safeParse({
      ...example(),
      typo: true,
    }).success).toBe(false);
  });
  it('rejects unsafe file identifiers', () => {
    expect(projectSchema.safeParse({
      ...example(),
      id: '../shop',
    }).success).toBe(false);
  });
  it('rejects duplicate prefixes after normalization', () => {
    expect(projectCollectionSchema.safeParse([
      example(),
      {
        ...example('crm'),
        prefix: '//shop/',
      },
    ]).success).toBe(false);
  });
  it('rejects duplicate IDs, default responses and equivalent parameter routes', () => {
    const project = projectSchema.parse(example());
    const endpoint = project.endpoints[0]!;
    const duplicate = { ...endpoint, path: '/products/:other' };
    endpoint.path = '/products/:id';
    project.endpoints.push(duplicate);
    endpoint.responses[1]!.default = true;
    const result = projectSchema.safeParse(project);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map(issue => issue.message).join(' ')).toMatch(/Duplicate ID/);
      expect(result.error.issues.map(issue => issue.message).join(' ')).toMatch(/Conflicting route/);
      expect(result.error.issues.map(issue => issue.message).join(' ')).toMatch(/default/);
    }
  });
  it('permits static routes beside parameterized routes', () => {
    const project = projectSchema.parse(example());
    project.endpoints.push({
      id:        'item',
      name:      'Item',
      enabled:   true,
      method:    'GET',
      path:      '/products/:id',
      responses: [
        { ...project.endpoints[0]!.responses[0]!, id: 'item-success' },
      ],
    });
    expect(projectSchema.safeParse(project).success).toBe(true);
  });
  it('rejects invalid delays, text bodies and CORS combinations', () => {
    const project = projectSchema.parse(example());
    project.notFound.delay = { type: 'random', min: 100, max: 50 };
    project.notFound.contentType = 'text/plain';
    project.cors.credentials = true;
    expect(projectSchema.safeParse(project).success).toBe(false);
  });
  it('requires a generation schema and bounds nested output', () => {
    const project = projectSchema.parse(example());
    project.notFound.bodyMode = 'generated';
    expect(projectSchema.safeParse(project).success).toBe(false);
    project.notFound.generation = {
      schema: {
        type:  'array',
        count: 1000,
        items: {
          type:  'array',
          count: 1000,
          items: { type: 'value', generator: 'email' },
        },
      },
    };
    expect(projectSchema.safeParse(project).success).toBe(false);
  });
});
