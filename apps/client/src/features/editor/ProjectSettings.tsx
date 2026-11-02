import type { MockProject } from '@mocker/shared';
import type { ProjectDraft } from '../../hooks/useProjectDraft';
import { Accordion, Checkbox, Grid, Group, MultiSelect, NumberInput, Stack, Textarea, TextInput } from '@mantine/core';
import { HTTP_METHODS } from '@mocker/shared';
import { ResponseFields } from './ResponseFields';

export function ProjectSettings({ config, onChange, draft }: { config: MockProject; onChange: (project: MockProject) => void; draft: ProjectDraft }) {
  const cors = config.cors;
  const corsChange = (next: Partial<typeof cors>) => onChange({
    ...config,
    cors: {
      ...cors,
      ...next,
    },
  });
  return (
    <Stack maw={900}>
      <Grid>
        <Grid.Col span={{ base: 12, sm: 8 }}><TextInput label="Название проекта" value={config.name} onChange={event => onChange({ ...config, name: event.currentTarget.value })} /></Grid.Col>
        <Grid.Col span={{ base: 12, sm: 4 }}><TextInput label="ID" value={config.id} readOnly /></Grid.Col>
      </Grid>
      <Textarea label="Описание" autosize minRows={2} value={config.description ?? ''} onChange={event => onChange({ ...config, description: event.currentTarget.value })} />
      <Group grow>
        <TextInput label="Prefix" placeholder="/shop" value={config.prefix} onChange={event => onChange({ ...config, prefix: event.currentTarget.value })} />
        <TextInput label="Base path" placeholder="/api" value={config.basePath} onChange={event => onChange({ ...config, basePath: event.currentTarget.value })} />
      </Group>
      <Group>
        <Checkbox label="Проект включён" checked={config.enabled} onChange={event => onChange({ ...config, enabled: event.currentTarget.checked })} />
        <Checkbox label="Автозапуск при старте приложения" checked={config.autoStart} onChange={event => onChange({ ...config, autoStart: event.currentTarget.checked })} />
      </Group>
      <Accordion multiple defaultValue={['cors']}>
        <Accordion.Item value="cors">
          <Accordion.Control>CORS</Accordion.Control>
          <Accordion.Panel>
            <Stack>
              <Checkbox label="Разрешить CORS" checked={cors.enabled} onChange={event => corsChange({ enabled: event.currentTarget.checked })} />
              <Textarea
                label="Origins"
                description="Один origin на строку. Например https://example.com или *"
                value={cors.origins.join('\n')}
                onChange={event => corsChange({
                  origins: event.currentTarget.value.split('\n'),
                })}
              />
              <MultiSelect label="Методы" data={[...HTTP_METHODS]} value={cors.methods} onChange={value => corsChange({ methods: value as typeof cors.methods })} />
              <Textarea
                label="Allowed headers"
                description="По одному заголовку на строку"
                value={cors.allowedHeaders.join('\n')}
                onChange={event => corsChange({
                  allowedHeaders: event.currentTarget.value.split('\n'),
                })}
              />
              <Textarea
                label="Exposed headers"
                value={cors.exposedHeaders.join('\n')}
                onChange={event => corsChange({
                  exposedHeaders: event.currentTarget.value.split('\n'),
                })}
              />
              <Group grow>
                <Checkbox label="Allow credentials" checked={cors.credentials} onChange={event => corsChange({ credentials: event.currentTarget.checked })} />
                <NumberInput
                  label="Max age, секунд"
                  min={0}
                  max={86400}
                  value={cors.maxAge}
                  onChange={value => corsChange({
                    maxAge: Number(value),
                  })}
                />
              </Group>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
        <Accordion.Item value="not-found">
          <Accordion.Control>Ответ для неизвестного маршрута · 404</Accordion.Control>
          <Accordion.Panel><ResponseFields response={config.notFound} onChange={notFound => onChange({ ...config, notFound })} draft={draft} fieldKey="notFound" notFound /></Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  );
}
