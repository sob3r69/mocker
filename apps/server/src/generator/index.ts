import type { GenerationConfig, GeneratorName, GeneratorNode, JsonValue } from '@mocker/shared';
import { Buffer } from 'node:buffer';
import { en, Faker } from '@faker-js/faker';
import { generationSchema, inferGenerationSchema, MAX_GENERATED_BYTES, MAX_GENERATED_ITEMS, MAX_GENERATION_DEPTH } from '@mocker/shared';
import { AppError } from '../utils/errors.js';
import { assertJsonBudget } from '../utils/json-budget.js';

const stringNames = new Map<string, GeneratorName>([
  ['id', 'uuid'],
  ['uuid', 'uuid'],
  ['name', 'name'],
  ['firstname', 'firstName'],
  ['lastname', 'lastName'],
  ['email', 'email'],
  ['phone', 'phone'],
  ['city', 'city'],
  ['country', 'country'],
  ['address', 'address'],
  ['date', 'date'],
  ['createdat', 'createdAt'],
  ['updatedat', 'updatedAt'],
  ['title', 'title'],
  ['description', 'description'],
  ['url', 'url'],
  ['avatar', 'avatar'],
]);
function signature(node: GeneratorNode): string {
  if (node.type === 'object') {
    return JSON.stringify(Object.entries(node.properties).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [
      key,
      signature(value),
    ]));
  }
  if (node.type === 'array')
    return `array:${node.count}:${signature(node.items)}`;
  if (node.type === 'tuple')
    return `tuple:${node.items.map(signature).join('|')}`;
  return JSON.stringify(node);
}
export function inferGeneration(input: unknown): GenerationConfig {
  assertJsonBudget(input);
  const parsed = inferGenerationSchema.parse(input);
  const blocked = new Set(['__proto__', 'constructor', 'prototype']);
  function infer(value: JsonValue, key: string, path: string, depth: number): GeneratorNode {
    if (depth > MAX_GENERATION_DEPTH)
      throw new AppError(400, 'GENERATION_LIMIT', `${path}: sample exceeds maximum generation depth ${MAX_GENERATION_DEPTH}`);
    if (value === null)
      return { type: 'value', generator: 'null' };
    if (Array.isArray(value)) {
      if (value.length > MAX_GENERATED_ITEMS)
        throw new AppError(400, 'GENERATION_LIMIT', `${path}: sample array exceeds ${MAX_GENERATED_ITEMS} items`);
      if (!value.length) {
        return {
          type:  'array',
          items: { type: 'value', generator: 'null' },
          count: 0,
        };
      }
      const items = value.map((item, index) => infer(item, key, `${path}[${index}]`, depth + 1));
      const first = items[0]!;
      if (items.every(item => signature(item) === signature(first)))
        return { type: 'array', items: first, count: parsed.arrayCount ?? value.length };
      return { type: 'tuple', items };
    }
    if (typeof value === 'object') {
      const entries = Object.entries(value).map(([name, child]) => {
        if (blocked.has(name))
          throw new AppError(400, 'UNSAFE_PROPERTY', `${path}.${name}: unsafe generator property`);
        return [
          name,
          infer(child, name, `${path}.${name}`, depth + 1),
        ] as const;
      });
      return {
        type:       'object',
        properties: Object.fromEntries(entries),
      };
    }
    const name = key.replace(/[_\s-]/g, '').toLowerCase();
    if (typeof value === 'boolean')
      return { type: 'value', generator: 'boolean' };
    if (typeof value === 'number') {
      const generator = name === 'id'
        ? 'id'
        : name === 'price'
          ? 'price'
          : name === 'amount'
            ? 'amount'
            : 'number';
      return {
        type:    'value',
        generator,
        integer: Number.isInteger(value),
      };
    }
    return { type: 'value', generator: stringNames.get(name) ?? 'string' };
  }
  const schema = infer(parsed.example, '', '$.example', 0);
  return generationSchema.parse({
    schema,
    ...(parsed.seed !== undefined
      ? { seed: parsed.seed }
      : {}),
  });
}
export function generateBody(input: GenerationConfig): JsonValue {
  assertJsonBudget(input);
  const generation = generationSchema.parse(input);
  // Each call owns its randomizer; seeded previews cannot affect other requests.
  const faker = new Faker({ locale: en });
  if (generation.seed !== undefined)
    faker.seed(generation.seed);
  function primitive(generator: GeneratorName, integer: boolean | undefined): JsonValue {
    switch (generator) {
      case 'null': return null;
      case 'boolean': return faker.datatype.boolean();
      case 'number': return integer === false
        ? faker.number.float({ min: 0, max: 10_000, fractionDigits: 2 })
        : faker.number.int({ min: 0, max: 10_000 });
      case 'id': return integer === false
        ? faker.number.float({ min: 1, max: 2_000_000_000, fractionDigits: 2 })
        : faker.number.int({ min: 1, max: 2_000_000_000 });
      case 'price':
      case 'amount': return integer === true
        ? faker.number.int({ min: 1, max: 10_000 })
        : faker.number.float({ min: 0.01, max: 10_000, fractionDigits: 2 });
      case 'uuid': return faker.string.uuid();
      case 'name': return faker.person.fullName();
      case 'firstName': return faker.person.firstName();
      case 'lastName': return faker.person.lastName();
      case 'email': return faker.internet.email();
      case 'phone': return faker.phone.number();
      case 'city': return faker.location.city();
      case 'country': return faker.location.country();
      case 'address': return faker.location.streetAddress();
      case 'date':
      case 'createdAt':
      case 'updatedAt': return faker.date.between({ from: '2020-01-01T00:00:00.000Z', to: '2030-01-01T00:00:00.000Z' }).toISOString();
      case 'title': return faker.lorem.sentence({ min: 3, max: 7 });
      case 'description': return faker.lorem.sentences(2);
      case 'url': return faker.internet.url();
      case 'avatar': return faker.image.avatar();
      case 'string': return faker.lorem.words(3);
    }
  }
  let bytes = 0;
  function charge(size: number) {
    bytes += size;
    if (bytes > MAX_GENERATED_BYTES)
      throw new AppError(422, 'GENERATION_LIMIT', `Generated body exceeds ${MAX_GENERATED_BYTES} bytes; reduce array counts`);
  }
  function generate(node: GeneratorNode): JsonValue {
    switch (node.type) {
      case 'object': {
        charge(2);
        return Object.fromEntries(Object.entries(node.properties).map(([key, child], index) => {
          charge(Buffer.byteLength(JSON.stringify(key)) + 1 + (index > 0
            ? 1
            : 0));
          return [
            key,
            generate(child),
          ];
        }));
      }
      case 'array': {
        charge(2);
        return Array.from({ length: node.count }, (_value, index) => {
          if (index > 0)
            charge(1);
          return generate(node.items);
        });
      }
      case 'tuple': {
        charge(2);
        return node.items.map((child, index) => {
          if (index > 0)
            charge(1);
          return generate(child);
        });
      }
      case 'value': {
        const value = primitive(node.generator, node.integer);
        charge(Buffer.byteLength(JSON.stringify(value)));
        return value;
      }
    }
  }
  return generate(generation.schema);
}
