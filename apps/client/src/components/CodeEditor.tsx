import type { CodeEditorProps } from './CodeEditorImpl';
import { Center, Loader } from '@mantine/core';
import { lazy, Suspense } from 'react';

const LazyEditor = lazy(async () => ({ default: (await import('./CodeEditorImpl')).CodeEditor }));
export function CodeEditor(props: CodeEditorProps) {
  return <Suspense fallback={<Center h={props.height ?? 320}><Loader size="sm" aria-label="Загрузка редактора" /></Center>}><LazyEditor {...props} /></Suspense>;
}
