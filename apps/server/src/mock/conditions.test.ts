import type { MatchCondition, MockEndpoint } from '@mocker/shared';
import { describe, expect, it } from 'vitest';
import { bodyValue, matchesCondition, selectVariant } from './conditions.js';
import { resolveDelay } from './response.js';

const context = {
  query: {
    count:    '42',
    repeated: ['a', 'b'],
  },
  path:   { id: '7' },
  header: { 'x-mode': 'error' },
  body:   {
    user: {
      role:  'admin',
      age:   42,
      flags: ['a', 'b'],
      nil:   null,
    },
  },
};
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
function rule(input: WithoutId<MatchCondition>) {
  return { id: 'condition', ...input } as MatchCondition;
}
describe('condition semantics', () => {
  it('compares query/path scalars as strings and headers without case sensitivity', () => {
    expect(matchesCondition(rule({
      source:   'query',
      key:      'count',
      operator: 'equals',
      value:    42,
    }), context)).toBe(true);
    expect(matchesCondition(rule({
      source:   'path',
      key:      'id',
      operator: 'in',
      value:    [7, 8],
    }), context)).toBe(true);
    expect(matchesCondition(rule({
      source:   'header',
      key:      'X-Mode',
      operator: 'equals',
      value:    'error',
    }), context)).toBe(true);
    expect(matchesCondition(rule({
      source:   'query',
      key:      'repeated',
      operator: 'contains',
      value:    'b',
    }), context)).toBe(true);
  });
  it('preserves JSON types and nested body values', () => {
    expect(matchesCondition(rule({
      source:   'body',
      key:      'user.age',
      operator: 'equals',
      value:    '42',
    }), context)).toBe(false);
    expect(matchesCondition(rule({
      source:   'body',
      key:      'user.age',
      operator: 'equals',
      value:    42,
    }), context)).toBe(true);
    expect(matchesCondition(rule({
      source:   'body',
      key:      'user.flags',
      operator: 'contains',
      value:    'a',
    }), context)).toBe(true);
    expect(matchesCondition(rule({
      source:   'body',
      key:      'user.role',
      operator: 'notContains',
      value:    'test',
    }), context)).toBe(true);
    expect(matchesCondition(rule({
      source:   'body',
      key:      'user.role',
      operator: 'notEquals',
      value:    'user',
    }), context)).toBe(true);
  });
  it('distinguishes null and absent values, and blocks inherited properties', () => {
    expect(matchesCondition(rule({ source: 'body', key: 'user.nil', operator: 'exists' }), context)).toBe(true);
    expect(matchesCondition(rule({ source: 'body', key: 'user.missing', operator: 'notExists' }), context)).toBe(true);
    expect(matchesCondition(rule({
      source:   'body',
      key:      'user.missing',
      operator: 'notEquals',
      value:    'x',
    }), context)).toBe(false);
    expect(bodyValue(context.body, 'user.constructor')).toBeUndefined();
    expect(bodyValue({
      inherited: Object.create({ secret: 1 }),
    }, 'inherited.secret')).toBeUndefined();
    expect(bodyValue(context.body, '__proto__.polluted')).toBeUndefined();
  });
  it('uses priority, array order and enabled default as fallback', () => {
    const response = {
      status:      200,
      contentType: 'application/json',
      body:        {},
      headers:     {},
      delay:       { type: 'fixed', value: 0 },
      bodyMode:    'static',
    } as const;
    const make = (id: string, priority: number, conditions: MatchCondition[] = []) => ({
      id,
      priority,
      conditions,
      default: false,
      enabled: true,
      name:    id,
      response,
    });
    const endpoint: MockEndpoint = {
      id:        'endpoint',
      name:      'Endpoint',
      method:    'GET',
      enabled:   true,
      path:      '/',
      responses: [
        {
          ...make('default', 100),
          default: true,
        },
        make('first', 5),
        make('tie', 5),
        {
          ...make('disabled', 100),
          enabled: false,
        },
      ],
    };
    expect(selectVariant(endpoint, context)?.id).toBe('first');
    endpoint.responses[2]!.priority = 10;
    expect(selectVariant(endpoint, context)?.id).toBe('tie');
    endpoint.responses.splice(1);
    expect(selectVariant(endpoint, context)?.id).toBe('default');
    endpoint.responses[0]!.enabled = false;
    expect(selectVariant(endpoint, context)).toBeUndefined();
  });
  it('bounds random delay inclusively and returns exact fixed delay', () => {
    expect(resolveDelay({ type: 'fixed', value: 12 })).toBe(12);
    expect(resolveDelay({ type: 'random', min: 3, max: 3 })).toBe(3);
    for (let i = 0; i < 100; i++) {
      const delay = resolveDelay({ type: 'random', min: 2, max: 6 });
      expect(delay).toBeGreaterThanOrEqual(2);
      expect(delay).toBeLessThanOrEqual(6);
    }
  });
});
