import type { MatchCondition, MockResponseVariant } from '@mocker/shared';
import type { ProjectDraft } from '../../hooks/useProjectDraft';
import { ActionIcon, Button, Checkbox, Grid, Group, NumberInput, Paper, Select, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { conditionSchema, jsonValueSchema } from '@mocker/shared';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { newId } from '../../utils/editor';

const operators = [
  'equals',
  'notEquals',
  'contains',
  'notContains',
  'exists',
  'notExists',
  'in',
];
export function RulesEditor({ variant, onChange, onDefault, draft, fieldKey }: {
  variant:   MockResponseVariant;
  onChange:  (variant: MockResponseVariant) => void;
  onDefault: (value: boolean) => void;
  draft:     ProjectDraft;
  fieldKey:  string;
}) {
  const update = (index: number, condition: MatchCondition) => onChange({
    ...variant,
    conditions: variant.conditions.map((current, i) => i === index
      ? condition
      : current),
  });
  return (
    <Stack>
      <Group grow>
        <NumberInput
          label="Приоритет"
          value={variant.priority}
          onChange={value => onChange({
            ...variant,
            priority: Number(value),
          })}
        />
        <Checkbox mt="lg" label="Default — резервный ответ" checked={variant.default} onChange={event => onDefault(event.currentTarget.checked)} />
      </Group>
      <Text c="dimmed" size="sm">Все условия объединяются AND. При равном приоритете используется порядок вариантов.</Text>
      {variant.default && <Text size="sm" c="orange">Условия default-варианта не проверяются: он используется только как fallback.</Text>}
      {variant.conditions.map((condition, index) => (
        <Paper withBorder p="sm" key={condition.id}>
          <Grid>
            <Grid.Col span={3}><Select label="Source" data={['query', 'path', 'header', 'body']} value={condition.source} onChange={value => value && update(index, { ...condition, source: value as MatchCondition['source'] })} /></Grid.Col>
            <Grid.Col span={4}><TextInput label="Key" placeholder="user.role" value={condition.key} onChange={event => update(index, { ...condition, key: event.currentTarget.value })} /></Grid.Col>
            <Grid.Col span={4}>
              <Select
                label="Operator"
                data={operators}
                value={condition.operator}
                onChange={(operator) => {
                  if (!operator)
                    return;
                  draft.removeBuffers(`${fieldKey}.${condition.id}`);
                  update(index, conditionSchema.parse({
                    id:     condition.id,
                    source: condition.source,
                    key:    condition.key || 'key',
                    operator,
                    ...(['exists', 'notExists'].includes(operator)
                      ? {}
                      : {
                          value: operator === 'in'
                            ? ['value']
                            : '',
                        }),
                  }));
                }}
              />
            </Grid.Col>
            <Grid.Col span={1}>
              <ActionIcon
                mt={27}
                color="red"
                variant="subtle"
                aria-label="Удалить условие"
                onClick={() => {
                  draft.removeBuffers(`${fieldKey}.${condition.id}`);
                  onChange({
                    ...variant,
                    conditions: variant.conditions.filter(current => current.id !== condition.id),
                  });
                }}
              >
                <IconTrash size={16} />
              </ActionIcon>
            </Grid.Col>
          </Grid>
          {'value' in condition && (
            <Textarea
              mt="sm"
              label="Value · JSON"
              description={'Строка: "error", число: 42, in: ["a", "b"]'}
              autosize
              minRows={2}
              value={draft.buffer(`${fieldKey}.${condition.id}`, condition.value)}
              onChange={event => draft.editBuffer(`${fieldKey}.${condition.id}`, event.currentTarget.value, (parsed) => {
                const value = jsonValueSchema.parse(parsed);
                update(index, conditionSchema.parse({ ...condition, value }));
              })}
            />
          )}
        </Paper>
      ))}
      <Button
        variant="light"
        leftSection={<IconPlus size={16} />}
        onClick={() => onChange({
          ...variant,
          conditions: [
            ...variant.conditions,
            {
              id:       newId(),
              source:   'query',
              key:      'mode',
              operator: 'equals',
              value:    'error',
            },
          ],
        })}
      >
        Добавить условие
      </Button>
    </Stack>
  );
}
