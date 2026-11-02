// @vitest-environment jsdom
import type { ProjectSnapshot } from '@mocker/shared';
import { projectSchema } from '@mocker/shared';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import shop from '../../../../examples/shop.json';
import { pretty } from '../utils/editor';
import { useProjectDraft } from './useProjectDraft';

function snapshot(revision = 'initial'): ProjectSnapshot {
  return {
    config: projectSchema.parse(shop),
    revision,
    state:  'running',
  };
}
afterEach(cleanup);
describe('project editor drafts', () => {
  it('updates clean documents when files change externally', () => {
    const initial = snapshot();
    const { result, rerender } = renderHook(useProjectDraft, { initialProps: initial });
    const next = snapshot('external');
    next.config.name = 'External';
    rerender(next);
    expect(result.current.config.name).toBe('External');
    expect(result.current.dirty).toBe(false);
  });
  it('retains dirty documents and detects conflicts including invalid disk versions', () => {
    const initial = snapshot();
    const { result, rerender } = renderHook(useProjectDraft, { initialProps: initial });
    act(() => result.current.change({ ...initial.config, name: 'Local draft' }));
    rerender({
      ...snapshot(),
      state:        'error',
      diskRevision: 'invalid-external',
    });
    expect(result.current.config.name).toBe('Local draft');
    expect(result.current.conflict).toBe(true);
    expect(result.current.base.revision).toBe('initial');
  });
  it('does not reload stale props after loading a reviewed disk document', () => {
    const { result } = renderHook(useProjectDraft, {
      initialProps: snapshot(),
    });
    const reviewed = snapshot('reviewed');
    reviewed.config.name = 'Reviewed on disk';
    act(() => result.current.load(reviewed));
    expect(result.current.config.name).toBe('Reviewed on disk');
    expect(result.current.base.revision).toBe('reviewed');
  });
  it('treats an unchanged reviewed raw disk document as clean', () => {
    const reviewed = snapshot('disk');
    const raw = `${JSON.stringify(reviewed.config)}\n`;
    const { result } = renderHook(useProjectDraft, {
      initialProps: snapshot(),
    });
    act(() => result.current.load(reviewed, raw));
    expect(result.current.text).toBe(raw);
    expect(result.current.dirty).toBe(false);
  });
  it('validates JSON syntax and immutable project IDs', () => {
    const { result } = renderHook(useProjectDraft, {
      initialProps: snapshot(),
    });
    act(() => result.current.changeText('{broken'));
    expect(() => result.current.validate()).toThrow(/JSON/);
    act(() => result.current.changeText(pretty({
      ...snapshot().config,
      id: 'changed',
    })));
    expect(() => result.current.validate()).toThrow(/ID/);
  });
  it('keeps invalid body buffers dirty without corrupting the last valid model', () => {
    const initial = snapshot();
    const { result } = renderHook(useProjectDraft, { initialProps: initial });
    act(() => result.current.editBuffer('body', '{broken', () => {
      throw new Error('must not apply');
    }));
    expect(result.current.dirty).toBe(true);
    expect(result.current.config).toEqual(initial.config);
    expect(result.current.buffer('body', {})).toBe('{broken');
    expect(() => result.current.validate()).toThrow();
    act(() => result.current.load(initial));
    expect(result.current.dirty).toBe(false);
  });
  it('acknowledges a save without dropping edits made while it was in flight', () => {
    const { result } = renderHook(useProjectDraft, {
      initialProps: snapshot(),
    });
    act(() => result.current.change({
      ...snapshot().config,
      name: 'Submitted',
    }));
    const submitted = result.current.text;
    const buffers = result.current.buffers;
    const saved = {
      ...snapshot('saved'),
      config: result.current.config,
    };
    act(() => result.current.change({ ...result.current.config, name: 'Typed during save' }));
    act(() => result.current.acceptSaved(saved, submitted, buffers));
    expect(result.current.base.revision).toBe('saved');
    expect(result.current.config.name).toBe('Typed during save');
    expect(result.current.dirty).toBe(true);
    expect(result.current.validate().name).toBe('Typed during save');
  });
  it('clears saved buffers but retains newer invalid input', () => {
    const { result } = renderHook(useProjectDraft, {
      initialProps: snapshot(),
    });
    act(() => result.current.editBuffer('body', '{}', () => {}));
    const submitted = result.current.text;
    const buffers = result.current.buffers;
    act(() => result.current.editBuffer('body', '{new invalid', () => {}));
    act(() => result.current.acceptSaved(snapshot('saved'), submitted, buffers));
    expect(result.current.buffer('body', {})).toBe('{new invalid');
    expect(result.current.dirty).toBe(true);
  });
});
