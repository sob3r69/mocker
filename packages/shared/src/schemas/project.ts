import { z } from 'zod';
import { HTTP_METHODS, MAX_DELAY_MS, MAX_GENERATED_ITEMS, MAX_GENERATION_DEPTH } from '../constants/index.js';

export const idSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'Use 1–64 lowercase letters, digits, underscores or hyphens');
export const jsonValueSchema = z.json();
export type JsonValue = z.infer<typeof jsonValueSchema>;
export const httpMethodSchema = z.enum(HTTP_METHODS);

export function normalizePath(value: string): string {
  return `/${value.split('/').filter(Boolean).join('/')}`;
}

export function fullPath(prefix: string, basePath: string, endpointPath: string): string {
  return normalizePath(`${prefix}/${basePath}/${endpointPath}`);
}

const pathSchema = z.string().max(2048).refine(value => !/[?#\\\s]/u.test(value) && ![...value].some(char => char.charCodeAt(0) < 32) && !value.split('/').some(segment => segment === '..' || segment === '.'), 'Invalid URL path').transform(normalizePath);
const mountPathSchema = pathSchema.refine(value => value !== '/' && /^\/[\w/-]+$/.test(value), 'Use a non-root static URL prefix');
const headerNameSchema = z.string().regex(/^[!#$%&'*+.^`|~\w-]+$/, 'Invalid header name');
const headerValueSchema = z.string().refine(value => !/[\r\n\0]/u.test(value), 'Invalid header value');
const headersSchema = z.record(headerNameSchema, headerValueSchema).refine(headers => !Object.keys(headers).some(name => ['content-length', 'transfer-encoding', 'connection'].includes(name.toLowerCase())), 'Transport headers are managed by the server');
const msSchema = z.number().int().min(0).max(MAX_DELAY_MS);
export const delaySchema = z.discriminatedUnion('type', [
  z.strictObject({
    type:  z.literal('fixed'),
    value: msSchema,
  }),
  z.strictObject({
    type: z.literal('random'),
    min:  msSchema,
    max:  msSchema,
  }).refine(delay => delay.min <= delay.max, {
    path:    ['max'],
    message: 'max must be >= min',
  }),
]);

export const generatorNames = [
  'string',
  'number',
  'boolean',
  'null',
  'id',
  'uuid',
  'name',
  'firstName',
  'lastName',
  'email',
  'phone',
  'city',
  'country',
  'address',
  'date',
  'createdAt',
  'updatedAt',
  'price',
  'amount',
  'title',
  'description',
  'url',
  'avatar',
] as const;
export interface GeneratorNode {
  type:        'value' | 'object' | 'array';
  generator?:  typeof generatorNames[number];
  properties?: Record<string, GeneratorNode>;
  items?:      GeneratorNode;
  count?:      number;
}
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
export const generatorNodeSchema: z.ZodType<GeneratorNode> = z.lazy(() => z.discriminatedUnion('type', [
  z.strictObject({
    type:      z.literal('value'),
    generator: z.enum(generatorNames),
  }),
  z.strictObject({
    type:       z.literal('object'),
    properties: z.record(z.string().refine(key => !unsafeKeys.has(key), 'Unsafe property'), generatorNodeSchema),
  }),
  z.strictObject({
    type:  z.literal('array'),
    items: generatorNodeSchema,
    count: z.number().int().min(0).max(MAX_GENERATED_ITEMS),
  }),
]));
function generationCost(node: GeneratorNode, depth = 0): number {
  if (depth > MAX_GENERATION_DEPTH)
    return Infinity;
  if (node.type === 'array')
    return 1 + (node.count ?? 0) * generationCost(node.items!, depth + 1);
  if (node.type === 'object')
    return 1 + Object.values(node.properties ?? {}).reduce((total, child) => total + generationCost(child, depth + 1), 0);
  return 1;
}
export const generationSchema = z.strictObject({
  schema: generatorNodeSchema.refine(node => generationCost(node) <= 10_000, 'Generation exceeds depth or total node budget'),
  seed:   z.number().int().optional(),
});
export const responseSchema = z.strictObject({
  status:      z.number().int().min(200).max(599),
  contentType: z.enum([
    'application/json',
    'text/plain',
    'text/html',
    'application/xml',
  ]),
  headers:    headersSchema,
  body:       jsonValueSchema,
  delay:      delaySchema,
  bodyMode:   z.enum(['static', 'generated']).default('static'),
  generation: generationSchema.optional(),
}).superRefine((response, ctx) => {
  if (response.contentType !== 'application/json' && response.body !== null && typeof response.body !== 'string') {
    ctx.addIssue({
      code:    'custom',
      path:    ['body'],
      message: 'Text responses require a string or null body',
    });
  }
  if (response.bodyMode === 'generated' && (response.contentType !== 'application/json' || !response.generation)) {
    ctx.addIssue({
      code:    'custom',
      path:    ['generation'],
      message: 'Generated responses require JSON content type and a generation schema',
    });
  }
});
const conditionBase = {
  id:     idSchema,
  source: z.enum(['query', 'path', 'header', 'body']),
  key:    z.string().min(1).max(256).refine(key => !key.split('.').some(segment => unsafeKeys.has(segment)), 'Unsafe property path'),
};
export const conditionSchema = z.discriminatedUnion('operator', [
  z.strictObject({
    ...conditionBase,
    operator: z.literal('equals'),
    value:    jsonValueSchema,
  }),
  z.strictObject({
    ...conditionBase,
    operator: z.literal('notEquals'),
    value:    jsonValueSchema,
  }),
  z.strictObject({
    ...conditionBase,
    operator: z.literal('contains'),
    value:    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
    ]),
  }),
  z.strictObject({
    ...conditionBase,
    operator: z.literal('notContains'),
    value:    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
    ]),
  }),
  z.strictObject({
    ...conditionBase,
    operator: z.literal('exists'),
  }),
  z.strictObject({
    ...conditionBase,
    operator: z.literal('notExists'),
  }),
  z.strictObject({
    ...conditionBase,
    operator: z.literal('in'),
    value:    z.array(jsonValueSchema).min(1),
  }),
]);
export const variantSchema = z.strictObject({
  id:         idSchema,
  name:       z.string().min(1).max(200),
  enabled:    z.boolean(),
  default:    z.boolean(),
  priority:   z.number().int(),
  conditions: z.array(conditionSchema).max(100),
  response:   responseSchema,
});
export const endpointSchema = z.strictObject({
  id:          idSchema,
  name:        z.string().min(1).max(200),
  description: z.string().max(10_000).optional(),
  enabled:     z.boolean(),
  method:      httpMethodSchema,
  path:        pathSchema.refine(value => value.split('/').every((segment, index, segments) => !segment.includes('*') || (segment === '*' && index === segments.length - 1)), 'Wildcard must be the final segment').refine(value => value.split('/').every(segment => !segment.includes(':') || /^:[a-z_]\w*$/i.test(segment)), 'Use full-segment named parameters such as :id'),
  responses:   z.array(variantSchema).min(1).max(100),
}).superRefine((endpoint, ctx) => {
  if (endpoint.responses.filter(response => response.default).length > 1) {
    ctx.addIssue({
      code:    'custom',
      path:    ['responses'],
      message: 'At most one default response is allowed',
    });
  }
  const params = endpoint.path.split('/').filter(segment => segment.startsWith(':'));
  if (new Set(params).size !== params.length) {
    ctx.addIssue({
      code:    'custom',
      path:    ['path'],
      message: 'Duplicate path parameter',
    });
  }
});
export const corsSchema = z.strictObject({
  enabled:        z.boolean(),
  origins:        z.array(z.string().refine(value => value === '*' || z.url().safeParse(value).success, 'Expected origin URL or *')).max(100),
  methods:        z.array(httpMethodSchema),
  allowedHeaders: z.array(headerNameSchema),
  exposedHeaders: z.array(headerNameSchema).default([]),
  credentials:    z.boolean().default(false),
  maxAge:         z.number().int().min(0).max(86400).default(600),
}).refine(cors => !(cors.credentials && cors.origins.includes('*')), 'Wildcard origin cannot be combined with credentials');

export const projectSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id:            idSchema,
  name:          z.string().min(1).max(200),
  description:   z.string().max(10_000).optional(),
  prefix:        mountPathSchema,
  basePath:      pathSchema.default('/'),
  enabled:       z.boolean(),
  autoStart:     z.boolean(),
  cors:          corsSchema,
  notFound:      responseSchema.refine(response => response.status === 404, 'Project notFound status must be 404'),
  endpoints:     z.array(endpointSchema).max(1000),
}).superRefine((project, ctx) => {
  const ids = new Set<string>([project.id]);
  function checkId(id: string, path: (string | number)[]) {
    if (ids.has(id))
      ctx.addIssue({ code: 'custom', path, message: `Duplicate ID: ${id}` });
    ids.add(id);
  }
  const routes = new Set<string>();
  project.endpoints.forEach((endpoint, index) => {
    checkId(endpoint.id, ['endpoints', index, 'id']);
    const key = `${endpoint.method} ${endpoint.path.replace(/:[^/]+/g, ':param')}`;
    if (routes.has(key)) {
      ctx.addIssue({
        code:    'custom',
        path:    ['endpoints', index, 'path'],
        message: `Conflicting route: ${key}`,
      });
    }
    routes.add(key);
    endpoint.responses.forEach((variant, variantIndex) => {
      checkId(variant.id, [
        'endpoints',
        index,
        'responses',
        variantIndex,
        'id',
      ]);
      variant.conditions.forEach((condition, conditionIndex) => checkId(condition.id, [
        'endpoints',
        index,
        'responses',
        variantIndex,
        'conditions',
        conditionIndex,
        'id',
      ]));
    });
  });
});
export const projectCollectionSchema = z.array(projectSchema).superRefine((projects, ctx) => {
  const ids = new Set<string>();
  const prefixes = new Set<string>();
  projects.forEach((project, index) => {
    if (ids.has(project.id)) {
      ctx.addIssue({
        code:    'custom',
        path:    [index, 'id'],
        message: 'Project ID already exists',
      });
    }
    if (prefixes.has(project.prefix)) {
      ctx.addIssue({
        code:    'custom',
        path:    [index, 'prefix'],
        message: 'Project prefix already exists',
      });
    }
    ids.add(project.id);
    prefixes.add(project.prefix);
  });
});

export const projectJsonSchema = z.toJSONSchema(projectSchema, { io: 'input', cycles: 'ref' });
export function validationIssues(error: z.ZodError) {
  return error.issues.map(issue => ({ path: `$.${issue.path.map(String).join('.')}`, message: issue.message }));
}
