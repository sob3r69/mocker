import { useComputedColorScheme } from '@mantine/core';
import { projectJsonSchema } from '@mocker/shared';
import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import { jsonDefaults } from 'monaco-editor/languages/features/json/register.js';

globalThis.MonacoEnvironment = {
  getWorker: (_id, label) => label === 'json'
    ? new JsonWorker()
    : new EditorWorker(),
};
loader.config({ monaco });
function configure() {
  jsonDefaults.setDiagnosticsOptions({
    validate:      true,
    allowComments: false,
    schemas:       [
      {
        uri:       'https://mocker.local/schema/project.json',
        fileMatch: ['**/project-config.json'],
        schema:    projectJsonSchema,
      },
    ],
  });
}
export interface CodeEditorProps {
  value:     string;
  onChange?: (value: string) => void;
  height?:   number | string;
  language?: string;
  project?:  boolean;
  readOnly?: boolean;
}
export function CodeEditor({ value, onChange, height = 320, language = 'json', project = false, readOnly = false }: CodeEditorProps) {
  const scheme = useComputedColorScheme('light');
  return (
    <Editor
      height={height}
      language={language}
      theme={scheme === 'dark'
        ? 'vs-dark'
        : 'light'}
      value={value}
      onChange={value => onChange?.(value ?? '')}
      {...(project
        ? { path: 'file:///project-config.json' }
        : {})}
      beforeMount={configure}
      loading="Загрузка редактора…"
      options={{
        readOnly,
        minimap:              { enabled: false },
        fontSize:             13,
        lineNumbersMinChars:  3,
        tabSize:              2,
        scrollBeyondLastLine: false,
        automaticLayout:      true,
        wordWrap:             'on',
        padding:              { top: 12 },
        fixedOverflowWidgets: true,
      }}
    />
  );
}
