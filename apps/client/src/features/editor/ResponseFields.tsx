import type { MockResponse } from '@mocker/shared';
import type { ProjectDraft } from '../../hooks/useProjectDraft';
import { Button, Group, NumberInput, Select, Stack, Text } from '@mantine/core';
import { jsonValueSchema, MAX_DELAY_MS, responseSchema } from '@mocker/shared';
import { useState } from 'react';
import { CodeEditor } from '../../components/CodeEditor';
import styles from './editor.module.css';
import { GeneratorDialog } from './GeneratorDialog';

export function ResponseFields({ response, onChange, draft, fieldKey, notFound = false }: {
  response:  MockResponse;
  onChange:  (response: MockResponse) => void;
  draft:     ProjectDraft;
  fieldKey:  string;
  notFound?: boolean;
}) {
  const [generatorOpen, setGeneratorOpen] = useState(false);
  return (
    <Stack gap="xs">
      <div className={styles.responseToolbar}>
        <NumberInput
          size="xs"
          label="HTTP status"
          min={200}
          max={599}
          value={response.status}
          disabled={notFound}
          onChange={value => onChange({
            ...response,
            status: Number(value),
          })}
        />

        <Select
          size="xs"
          label="Content-Type"
          data={[
            'application/json',
            'text/plain',
            'text/html',
            'application/xml',
          ]}
          value={response.contentType}
          onChange={(value) => {
            if (value) {
              draft.removeBuffers(`${fieldKey}.body`);
              onChange({
                ...response,
                contentType: value as MockResponse['contentType'],
                body:        value === 'application/json'
                  ? response.body
                  : typeof response.body === 'string'
                    ? response.body
                    : JSON.stringify(response.body, null, 2),
                bodyMode: 'static',
              });
            }
          }}
        />

        <Select
          size="xs"
          className={styles.bodyMode}
          label="Режим тела ответа"
          value={response.bodyMode}
          data={[
            { value: 'static', label: 'Static' },
            { value: 'generated', label: 'Generated', disabled: response.contentType !== 'application/json' },
          ]}
          onChange={(value) => {
            if (value === 'generated' && !response.generation)
              setGeneratorOpen(true);
            else if (value)
              onChange({ ...response, bodyMode: value as MockResponse['bodyMode'] });
          }}
        />
        {response.contentType === 'application/json' && <Button size="xs" variant="light" onClick={() => setGeneratorOpen(true)}>{response.generation ? 'Настроить генератор' : 'Генератор по JSON-образцу'}</Button>}
      </div>
      <div className={styles.responseLayout}>
        <div>
          <Text size="sm" fw={500} mb={6}>Response body</Text>
          <CodeEditor
            height="clamp(240px, calc(100dvh - 540px), 560px)"
            language={response.contentType === 'application/json'
              ? 'json'
              : response.contentType === 'text/html'
                ? 'html'
                : 'plaintext'}
            value={response.contentType === 'application/json'
              ? draft.buffer(`${fieldKey}.body`, response.body)
              : String(response.body ?? '')}
            onChange={(value) => {
              if (response.contentType === 'application/json') {
                draft.editBuffer(`${fieldKey}.body`, value, parsed => onChange({
                  ...response,
                  body: jsonValueSchema.parse(parsed),
                }));
              }
              else {
                onChange({ ...response, body: value });
              }
            }}
          />
        </div>
        {generatorOpen && (
          <GeneratorDialog
            response={response}
            onClose={() => setGeneratorOpen(false)}
            onApply={(example, generation) => {
              draft.removeBuffers(`${fieldKey}.body`);
              onChange({
                ...response,
                body:     example,
                bodyMode: 'generated',
                generation,
              });
              setGeneratorOpen(false);
            }}
          />
        )}
        <Stack gap="xs" className={styles.responseOptions}>
          <div>
            <Text size="sm" fw={500} mb={6}>Headers · JSON object</Text>
            <CodeEditor
              height={132}
              value={draft.buffer(`${fieldKey}.headers`, response.headers)}
              onChange={value => draft.editBuffer(`${fieldKey}.headers`, value, parsed => onChange({
                ...response,
                headers: responseSchema.shape.headers.parse(parsed),
              }))}
            />
          </div>

          <Group align="end" grow gap="xs">
            <Select
              size="xs"
              label="Задержка"
              value={response.delay.type}
              data={[
                { value: 'fixed', label: 'Fixed · мс' },
                { value: 'random', label: 'Random · мс' },
              ]}
              onChange={value => onChange({
                ...response,
                delay: value === 'random'
                  ? { type: 'random', min: 0, max: 500 }
                  : { type: 'fixed', value: 0 },
              })}
            />
            {response.delay.type === 'fixed'
              ? (
                  <NumberInput
                    size="xs"
                    label="Задержка, мс"
                    min={0}
                    max={MAX_DELAY_MS}
                    value={response.delay.value}
                    onChange={value => onChange({
                      ...response,
                      delay: {
                        type:  'fixed',
                        value: Number(value),
                      },
                    })}
                  />
                )
              : (
                  <>
                    <NumberInput
                      size="xs"
                      label="От, мс"
                      min={0}
                      max={MAX_DELAY_MS}
                      value={response.delay.min}
                      onChange={value => onChange({
                        ...response,
                        delay: {
                          ...response.delay as { type: 'random'; min: number; max: number },
                          min: Number(value),
                        },
                      })}
                    />
                    <NumberInput
                      size="xs"
                      label="До, мс"
                      min={0}
                      max={MAX_DELAY_MS}
                      value={response.delay.max}
                      onChange={value => onChange({
                        ...response,
                        delay: {
                          ...response.delay as { type: 'random'; min: number; max: number },
                          max: Number(value),
                        },
                      })}
                    />
                  </>
                )}
          </Group>
        </Stack>
      </div>
    </Stack>
  );
}
