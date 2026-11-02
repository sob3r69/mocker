import type { MockResponse } from '@mocker/shared';
import type { ProjectDraft } from '../../hooks/useProjectDraft';
import { Alert, Grid, Group, NumberInput, Select, Stack, Text } from '@mantine/core';
import { jsonValueSchema, MAX_DELAY_MS, responseSchema } from '@mocker/shared';
import { CodeEditor } from '../../components/CodeEditor';

export function ResponseFields({ response, onChange, draft, fieldKey, notFound = false }: {
  response:  MockResponse;
  onChange:  (response: MockResponse) => void;
  draft:     ProjectDraft;
  fieldKey:  string;
  notFound?: boolean;
}) {
  return (
    <Stack gap="md">
      <Grid>
        <Grid.Col span={4}>
          <NumberInput
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
        </Grid.Col>
        <Grid.Col span={8}>
          <Select
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
        </Grid.Col>
      </Grid>
      <div>
        <Text size="sm" fw={500} mb={6}>Response body</Text>
        <CodeEditor
          height={300}
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
      <Select
        label="Режим тела ответа"
        value={response.bodyMode}
        data={[
          { value: 'static', label: 'Static — фиксированный ответ' },
          { value: 'generated', label: 'Generated', disabled: !response.generation },
        ]}
        onChange={value => value && onChange({ ...response, bodyMode: value as MockResponse['bodyMode'] })}
      />
      {response.bodyMode === 'generated' && <Alert color="orange">Генерация ещё недоступна. Выберите Static для отправки указанного тела.</Alert>}
      <div>
        <Text size="sm" fw={500} mb={6}>Headers · JSON object</Text>
        <CodeEditor
          height={120}
          value={draft.buffer(`${fieldKey}.headers`, response.headers)}
          onChange={value => draft.editBuffer(`${fieldKey}.headers`, value, parsed => onChange({
            ...response,
            headers: responseSchema.shape.headers.parse(parsed),
          }))}
        />
      </div>

      <Group align="end" grow>
        <Select
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
  );
}
