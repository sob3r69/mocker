import type { GeneratorNode, JsonValue } from '@mocker/shared';
import { generationSchema, MAX_GENERATED_BYTES, MAX_GENERATION_DEPTH } from '@mocker/shared';
import { describe, expect, it } from 'vitest';
import { generateBody, inferGeneration } from './index.js';

const example = {
  id:          1,
  uuid:        'abc',
  name:        'John Doe',
  firstName:   'John',
  lastName:    'Doe',
  email:       'john@example.com',
  phone:       '+123',
  city:        'London',
  country:     'UK',
  address:     { city: 'London', country: 'UK' },
  createdAt:   '2024-01-01',
  updatedAt:   '2024-01-01',
  date:        '2024-01-01',
  age:         25,
  active:      true,
  nil:         null,
  price:       12.5,
  amount:      25,
  title:       'Title',
  description: 'Example',
  url:         'https://example.com',
  avatar:      'https://example.com/avatar',
};

describe('generation by example', () => {
  it('recognizes semantic names and preserves JSON types and nested shape', () => {
    const generation = inferGeneration({ example, seed: 42 });
    const body = generateBody(generation) as typeof example;
    expect(Object.keys(body)).toEqual(Object.keys(example));
    expect(body.email).toMatch(/@/);
    expect(body.uuid).toMatch(/^[\da-f-]{36}$/);
    expect(typeof body.id).toBe('number');
    expect(typeof body.active).toBe('boolean');
    expect(body.nil).toBeNull();
    expect(Number.isInteger(body.age)).toBe(true);
    expect(typeof body.price).toBe('number');
    expect(Number.isInteger(body.amount)).toBe(true);
    expect(Object.keys(body.address)).toEqual(['city', 'country']);
    expect(new Date(body.createdAt).toISOString()).toBe(body.createdAt);
    expect(body.name).not.toBe(example.name);
  });
  it('does not change types just because a field name suggests a different type', () => {
    const generation = inferGeneration({
      example: {
        id:         'string-id',
        name:       1,
        price:      'ten',
        email:      false,
        phone:      null,
        first_name: 'A',
      },
      seed: 0,
    });
    const body = generateBody(generation) as Record<string, unknown>;
    expect(typeof body.id).toBe('string');
    expect(typeof body.name).toBe('number');
    expect(typeof body.price).toBe('string');
    expect(typeof body.email).toBe('boolean');
    expect(body.phone).toBeNull();
    if (generation.schema.type === 'object')
      expect(generation.schema.properties.first_name).toMatchObject({ generator: 'firstName' });
  });
  it('supports all scalar roots and generates fresh unseeded data', () => {
    for (const value of [null, true, 12, 1.25, 'text']) {
      const result = generateBody(inferGeneration({ example: value }));
      expect(typeof result).toBe(typeof value);
    }
    const generation = inferGeneration({
      example: { uuid: 'sample' },
    });
    expect(generateBody(generation)).not.toEqual(generateBody(generation));
  });
  it('keeps seeded generation repeatable, including dates, without global interference', () => {
    const generation = inferGeneration({ example, seed: 123 });
    const initial = generateBody(generation);
    generateBody(inferGeneration({ example, seed: 999 }));
    generateBody(inferGeneration({ example }));
    expect(generateBody(generation)).toEqual(initial);
    expect(generateBody({ ...generation, seed: 0 })).not.toEqual(initial);
  });
  it('supports object arrays, nested arrays, zero counts and empty arrays', () => {
    const generation = inferGeneration({
      example: [
        {
          id:    1,
          tags:  ['a', 'b'],
          empty: [],
        },
      ],
      arrayCount: 3,
      seed:       8,
    });
    const body = generateBody(generation) as { id: number; tags: string[]; empty: unknown[] }[];
    expect(body).toHaveLength(3);
    expect(body[0]!.tags).toHaveLength(3);
    expect(body[0]!.empty).toEqual([]);
    expect(generateBody(inferGeneration({
      example:    ['a'],
      arrayCount: 0,
    }))).toEqual([]);
    expect(generateBody(inferGeneration({ example: [], arrayCount: 10 }))).toEqual([]);
  });
  it('preserves heterogeneous arrays as fixed tuples instead of guessing the first item', () => {
    const generation = inferGeneration({
      example: [
        null,
        1,
        'text',
        true,
        { name: 'A' },
      ],
      arrayCount: 8,
    });
    expect(generation.schema.type).toBe('tuple');
    const body = generateBody(generation) as unknown[];
    expect(body).toHaveLength(5);
    expect(body[0]).toBeNull();
    expect(typeof body[1]).toBe('number');
    expect(typeof body[2]).toBe('string');
    expect(typeof body[3]).toBe('boolean');
    expect(body[4]).toHaveProperty('name');
  });
  it('treats object field order consistently when inferring homogeneous arrays', () => {
    const generation = inferGeneration({
      example: [
        { id: 1, name: 'A' },
        { name: 'B', id: 2 },
      ],
      arrayCount: 5,
    });
    expect(generation.schema.type).toBe('array');
    expect(generateBody(generation)).toHaveLength(5);
  });
  it('rejects deep samples, excessive counts and multiplicative output budgets', () => {
    let deep: JsonValue = 'leaf';
    for (let i = 0; i < MAX_GENERATION_DEPTH + 1; i++) {
      deep = { nested: deep };
    }
    expect(() => inferGeneration({ example: deep })).toThrow(/depth/);
    expect(() => inferGeneration({
      example:    [1],
      arrayCount: 1001,
    })).toThrow();
    expect(() => inferGeneration({
      example: [
        [
          { name: 'A' },
        ],
      ],
      arrayCount: 1000,
    })).toThrow(/budget/);
    expect(generationSchema.safeParse({
      schema: { type: 'value', generator: 'eval' },
    }).success).toBe(false);
  });
  it('rejects prototype paths without polluting object prototypes', () => {
    const sample: JsonValue = JSON.parse('{"safe":{"__proto__":{"polluted":true}}}');
    expect(() => inferGeneration({ example: sample })).toThrow(/unsafe/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(generationSchema.safeParse({
      schema: {
        type:       'object',
        properties: JSON.parse('{"constructor":{"type":"value","generator":"name"}}'),
      },
    }).success).toBe(false);
  });
  it('bounds serialized bytes incrementally, including repeated keys', () => {
    const schema: GeneratorNode = {
      type:  'array',
      count: 1000,
      items: {
        type:       'object',
        properties: {
          ['x'.repeat(2000)]: { type: 'value', generator: 'null' },
        },
      },
    };
    expect(() => generateBody({ schema })).toThrow(new RegExp(String(MAX_GENERATED_BYTES)));
  });
  it('validates legacy generation schemas and rejects extreme nesting before recursion', () => {
    expect(generateBody({
      schema: { type: 'value', generator: 'id' },
      seed:   1,
    })).toEqual(expect.any(Number));
    let schema: unknown = { type: 'value', generator: 'string' };
    for (let i = 0; i < 1000; i++) {
      schema = { type: 'array', items: schema, count: 1 };
    }
    expect(() => generateBody({ schema: schema as GeneratorNode })).toThrow(/nesting depth/);
  });
});
