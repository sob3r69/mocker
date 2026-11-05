import type { MockEndpoint, MockResponseVariant, ServerStatus } from '@mocker/shared';
import type { ProjectDraft } from '../../hooks/useProjectDraft';
import { ActionIcon, Alert, Badge, Button, Checkbox, Grid, Group, Paper, Select, Stack, Tabs, Text, Textarea, TextInput, Title } from '@mantine/core';
import { HTTP_METHODS } from '@mocker/shared';
import { IconArrowDown, IconArrowUp, IconCopy, IconPlus, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { useConfirm } from '../../components/ConfirmProvider';
import { endpointUrl, newId, newVariant } from '../../utils/editor';
import styles from './editor.module.css';
import { ResponseFields } from './ResponseFields';
import { ResponsePreview } from './ResponsePreview';
import { RulesEditor } from './RulesEditor';

export function EndpointEditor({ endpoint, draft, status, onDuplicate, onDelete, notify }: {
  endpoint:    MockEndpoint;
  draft:       ProjectDraft;
  status?:     ServerStatus;
  onDuplicate: () => void;
  onDelete:    () => void;
  notify:      (message: string) => void;
}) {
  const confirm = useConfirm();
  const [selected, setSelected] = useState(endpoint.responses[0]?.id ?? '');
  const [tab, setTab] = useState<string | null>('response');
  const variant = endpoint.responses.find(response => response.id === selected) ?? endpoint.responses[0];
  const update = (next: MockEndpoint) => draft.change({
    ...draft.config,
    endpoints: draft.config.endpoints.map(current => current.id === endpoint.id
      ? next
      : current),
  });
  const changeVariant = (next: MockResponseVariant) => update({
    ...endpoint,
    responses: endpoint.responses.map(current => current.id === next.id
      ? next
      : current),
  });
  const move = (direction: number) => {
    if (!variant)
      return;
    const variants = [...endpoint.responses];
    const current = variants.findIndex(item => item.id === variant.id);
    const target = current + direction;
    if (target < 0 || target >= variants.length)
      return;
    [variants[current], variants[target]] = [variants[target]!, variants[current]!];
    update({ ...endpoint, responses: variants });
  };
  return (
    <Stack gap="xs">
      <Grid align="end" gap="xs">
        <Grid.Col span={{ base: 4, sm: 2 }}><Select size="xs" label="Метод" data={[...HTTP_METHODS]} value={endpoint.method} onChange={value => value && update({ ...endpoint, method: value as MockEndpoint['method'] })} /></Grid.Col>
        <Grid.Col span={{ base: 8, sm: 6 }}><TextInput size="xs" label="Путь" placeholder="/products/:id" value={endpoint.path} onChange={event => update({ ...endpoint, path: event.currentTarget.value })} /></Grid.Col>
        <Grid.Col span={{ base: 12, sm: 4 }}><TextInput size="xs" label="Название endpoint" value={endpoint.name} onChange={event => update({ ...endpoint, name: event.currentTarget.value })} /></Grid.Col>
      </Grid>
      <Group justify="space-between">
        <Text className={styles.url}>{endpointUrl(draft.config, endpoint, status)}</Text>
        <Button size="compact-xs" variant="subtle" leftSection={<IconCopy size={14} />} onClick={() => navigator.clipboard.writeText(endpointUrl(draft.config, endpoint, status)).then(() => notify('URL скопирован')).catch(() => notify('Не удалось скопировать URL'))}>Копировать URL</Button>
      </Group>
      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="request">Request</Tabs.Tab>
          <Tabs.Tab value="response">Response</Tabs.Tab>
          <Tabs.Tab value="rules">Rules</Tabs.Tab>
          <Tabs.Tab value="settings">Settings</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="request" pt="lg">
          <Stack>
            <Title order={3} size="sm">Параметры запроса</Title>
            <Text size="sm">
              {endpoint.method}
              {' '}
              {endpoint.path}
            </Text>
            <Paper withBorder p="md">
              <Text size="sm">
                Path parameters:
                {endpoint.path.split('/').filter(segment => segment.startsWith(':')).join(', ') || 'нет'}
              </Text>
              <Text size="sm" mt="sm">
                Правила:
                {endpoint.responses.flatMap(response => response.conditions.map(condition => `${condition.source}.${condition.key} (${condition.operator})`)).join(', ') || 'условия не настроены'}
              </Text>
            </Paper>
            <Alert color="gray">Query, headers и body проверяются в Rules. Все условия варианта должны совпасть.</Alert>
          </Stack>
        </Tabs.Panel>
        {(tab === 'response' || tab === 'rules') && variant && (
          <Stack gap="sm" mt="sm">
            <div className={styles.variantBar}>
              <Select
                size="xs"
                label="Response variant"
                value={variant.id}
                data={endpoint.responses.map(item => ({ value: item.id, label: `${item.response.status} · ${item.name}${item.default ? ' · default' : ''}${!item.enabled
                  ? ' · off'
                  : ''}` }))}
                onChange={value => value && setSelected(value)}
              />
              <ActionIcon
                aria-label="Добавить вариант ответа"
                variant="light"
                size="sm"
                onClick={() => {
                  const next = newVariant();
                  update({
                    ...endpoint,
                    responses: [...endpoint.responses, next],
                  });
                  setSelected(next.id);
                }}
              >
                <IconPlus size={17} />
              </ActionIcon>
              <ActionIcon
                aria-label="Дублировать вариант ответа"
                variant="default"
                size="sm"
                onClick={() => {
                  const next = {
                    ...structuredClone(variant),
                    id:         newId(),
                    name:       `${variant.name.slice(0, 180)} (copy)`,
                    default:    false,
                    conditions: variant.conditions.map(condition => ({
                      ...condition,
                      id: newId(),
                    })),
                  };
                  update({
                    ...endpoint,
                    responses: [...endpoint.responses, next],
                  });
                  setSelected(next.id);
                }}
              >
                <IconCopy size={17} />
              </ActionIcon>
              <ActionIcon
                aria-label="Удалить вариант ответа"
                color="red"
                variant="subtle"
                size="sm"
                disabled={endpoint.responses.length === 1}
                onClick={async () => {
                  if (await confirm(`Удалить вариант «${variant.name}»?`)) {
                    draft.removeBuffers(`${endpoint.id}.${variant.id}`);
                    update({
                      ...endpoint,
                      responses: endpoint.responses.filter(item => item.id !== variant.id),
                    });
                  }
                }}
              >
                <IconTrash size={17} />
              </ActionIcon>
              <TextInput size="xs" label="Название варианта" value={variant.name} onChange={event => changeVariant({ ...variant, name: event.currentTarget.value })} />
              <Checkbox size="xs" label="Включён" checked={variant.enabled} onChange={event => changeVariant({ ...variant, enabled: event.currentTarget.checked })} />
              <ActionIcon aria-label="Вариант выше" variant="subtle" onClick={() => move(-1)}><IconArrowUp size={15} /></ActionIcon>
              <ActionIcon aria-label="Вариант ниже" variant="subtle" onClick={() => move(1)}><IconArrowDown size={15} /></ActionIcon>
            </div>
            {tab === 'response'
              ? <ResponseFields key={variant.id} response={variant.response} onChange={response => changeVariant({ ...variant, response })} draft={draft} fieldKey={`${endpoint.id}.${variant.id}`} />
              : (
                  <RulesEditor
                    variant={variant}
                    onChange={changeVariant}
                    onDefault={checked => update({
                      ...endpoint,
                      responses: endpoint.responses.map(item => ({
                        ...item,
                        default: item.id === variant.id
                          ? checked
                          : checked ? false : item.default,
                      })),
                    })}
                    draft={draft}
                    fieldKey={`${endpoint.id}.${variant.id}.rules`}
                  />
                )}
            <ResponsePreview response={variant.response} method={endpoint.method} />
          </Stack>
        )}
        <Tabs.Panel value="settings" pt="lg">
          <Stack maw={700}>
            <Textarea label="Описание endpoint" value={endpoint.description ?? ''} onChange={event => update({ ...endpoint, description: event.currentTarget.value })} />
            <Checkbox label="Endpoint включён" checked={endpoint.enabled} onChange={event => update({ ...endpoint, enabled: event.currentTarget.checked })} />
            <Group>
              <Button variant="default" leftSection={<IconCopy size={16} />} onClick={onDuplicate}>Дублировать endpoint</Button>
              <Button color="red" variant="light" leftSection={<IconTrash size={16} />} onClick={onDelete}>Удалить endpoint</Button>
              <Badge color={endpoint.enabled ? 'teal' : 'gray'}>{endpoint.enabled ? 'enabled' : 'disabled'}</Badge>
            </Group>
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
