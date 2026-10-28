import type { MatchCondition, MockEndpoint } from '@mocker/shared';
import { isDeepStrictEqual } from 'node:util';

export interface MatchContext {
  query:  Record<string, unknown>;
  path:   Record<string, unknown>;
  header: Record<string, unknown>;
  body:   unknown;
}
const blockedKeys = new Set(['__proto__', 'prototype', 'constructor']);
export function ownValue(value: unknown, key: string): unknown {
  if (blockedKeys.has(key) || value === null || typeof value !== 'object' || !Object.hasOwn(value, key))
    return undefined;
  return (value as Record<string, unknown>)[key];
}
export function bodyValue(body: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => ownValue(value, key), body);
}
export function matchesCondition(condition: MatchCondition, context: MatchContext): boolean {
  const actual = condition.source === 'body'
    ? bodyValue(context.body, condition.key)
    : ownValue(context[condition.source], condition.source === 'header'
        ? condition.key.toLowerCase()
        : condition.key);
  if (condition.operator === 'exists')
    return actual !== undefined;
  if (condition.operator === 'notExists')
    return actual === undefined;
  // Missing values only match notExists, not negative comparisons.
  if (actual === undefined)
    return false;
  const stringSource = condition.source !== 'body';
  const comparable = (value: unknown) => stringSource && (value === null || ['number', 'boolean', 'string'].includes(typeof value))
    ? String(value)
    : value;
  const equals = (value: unknown) => isDeepStrictEqual(actual, comparable(value));
  const contains = (value: unknown) => typeof actual === 'string' && typeof comparable(value) === 'string'
    ? actual.includes(String(comparable(value)))
    : Array.isArray(actual) && actual.some(item => isDeepStrictEqual(item, comparable(value)));
  switch (condition.operator) {
    case 'equals': return equals(condition.value);
    case 'notEquals': return !equals(condition.value);
    case 'contains': return contains(condition.value);
    case 'notContains': return !contains(condition.value);
    case 'in': return condition.value.some(equals);
  }
}
export function selectVariant(endpoint: MockEndpoint, context: MatchContext) {
  const available = endpoint.responses.filter(variant => variant.enabled);
  const matches = available.filter(variant => !variant.default && variant.conditions.every(condition => matchesCondition(condition, context)));
  // Stable sort keeps array order for equal priorities.
  return matches.sort((a, b) => b.priority - a.priority)[0] ?? available.find(variant => variant.default);
}
