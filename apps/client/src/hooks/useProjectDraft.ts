import type { MockProject, ProjectSnapshot } from '@mocker/shared';
import { projectSchema, validationIssues } from '@mocker/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { pretty } from '../utils/editor';

export function useProjectDraft(remote: ProjectSnapshot) {
  const [base, setBase] = useState(remote);
  const [config, setConfig] = useState(remote.config);
  const [baseText, setBaseText] = useState(() => pretty(remote.config));
  const [text, setText] = useState(() => pretty(remote.config));
  const [buffers, setBuffers] = useState<Record<string, { text: string; error: string }>>({});
  const dirty = text !== baseText || Object.keys(buffers).length > 0;
  const conflict = (remote.diskRevision ?? remote.revision) !== base.revision;
  const load = useCallback((snapshot: ProjectSnapshot, sourceText = pretty(snapshot.config)) => {
    setBase(snapshot);
    setConfig(snapshot.config);
    setBaseText(sourceText);
    setText(sourceText);
    setBuffers({});
  }, []);
  const lastRemoteRef = useRef(`${remote.revision}:${remote.diskRevision ?? ''}`);
  useEffect(() => {
    const fingerprint = `${remote.revision}:${remote.diskRevision ?? ''}`;
    if (lastRemoteRef.current !== fingerprint) {
      lastRemoteRef.current = fingerprint;
      if (!dirty)
        load(remote);
    }
  }, [remote, dirty, load]);
  function acceptSaved(snapshot: ProjectSnapshot, submittedText: string, submittedBuffers: typeof buffers) {
    setBase(snapshot);
    setBaseText(pretty(snapshot.config));
    setText(current => current === submittedText
      ? pretty(snapshot.config)
      : current);
    setConfig(current => pretty(current) === pretty(projectSchema.parse(JSON.parse(submittedText)))
      ? snapshot.config
      : current);
    setBuffers(current => Object.fromEntries(Object.entries(current).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(submittedBuffers[key]))));
  }
  const change = (next: MockProject) => {
    setConfig(next);
    setText(pretty(next));
  };
  const changeText = (next: string) => {
    setText(next);
    try {
      const parsed = projectSchema.safeParse(JSON.parse(next));
      if (parsed.success)
        setConfig(parsed.data);
    }
    catch {}
  };
  function validate() {
    for (const value of Object.values(buffers)) {
      if (value.error)
        throw new Error(value.error);
    }
    let input: unknown;
    try {
      input = JSON.parse(text);
    }
    catch {
      throw new Error('Некорректный JSON: исправьте синтаксис перед сохранением');
    }
    const parsed = projectSchema.safeParse(input);
    if (!parsed.success)
      throw new Error(validationIssues(parsed.error).map(issue => `${issue.path}: ${issue.message}`).join('\n'));
    if (parsed.data.id !== remote.config.id)
      throw new Error('ID проекта нельзя изменить');
    return parsed.data;
  }
  function buffer(key: string, value: unknown) {
    return buffers[key]?.text ?? pretty(value);
  }
  function editBuffer(key: string, value: string, apply: (parsed: unknown) => void) {
    try {
      const parsed: unknown = JSON.parse(value);
      apply(parsed);
      setBuffers(previous => ({
        ...previous,
        [key]: { text: value, error: '' },
      }));
    }
    catch (error) {
      setBuffers(previous => ({
        ...previous,
        [key]: { text:  value, error: `Некорректное значение ${key}: ${error instanceof Error
          ? error.message
          : 'JSON'}` },
      }));
    }
  }
  function removeBuffers(prefix: string) {
    setBuffers(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !key.startsWith(prefix))));
  }
  return {
    base,
    config,
    text,
    buffers,
    dirty,
    conflict,
    load,
    acceptSaved,
    change,
    changeText,
    validate,
    buffer,
    editBuffer,
    removeBuffers,
  };
}
export type ProjectDraft = ReturnType<typeof useProjectDraft>;
