import { AppError } from './errors.js';

// Check before recursive Zod schemas, including deeply nested imported projects.
export function assertJsonBudget(value: unknown) {
  const pending = [
    { value, depth: 0, path: '$' },
  ];
  const unsafe = new Set(['__proto__', 'constructor', 'prototype']);
  let nodes = 0;
  while (pending.length) {
    const current = pending.pop()!;
    if (++nodes > 100_000 || current.depth > 64)
      throw new AppError(400, 'JSON_LIMIT', 'JSON exceeds the maximum nesting depth (64) or node budget (100000)');
    if (current.value !== null && typeof current.value === 'object') {
      for (const [key, child] of Object.entries(current.value)) {
        if (unsafe.has(key))
          throw new AppError(400, 'UNSAFE_PROPERTY', `${current.path}.${key}: unsafe JSON property`);
        pending.push({ value: child, depth: current.depth + 1, path: `${current.path}.${key}` });
      }
    }
  }
}
