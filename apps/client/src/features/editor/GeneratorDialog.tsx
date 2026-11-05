import type { GenerationConfig, JsonValue, MockResponse } from '@mocker/shared';
import { Accordion, Alert, Button, Grid, Group, Modal, NumberInput, Stack, Text } from '@mantine/core';
import { MAX_GENERATED_ITEMS } from '@mocker/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { generatorApi } from '../../api/generator';
import { errorMessage } from '../../api/projects';
import { CodeEditor } from '../../components/CodeEditor';
import { pretty } from '../../utils/editor';

export function GeneratorDialog({ response, onApply, onClose }: { response: MockResponse; onApply: (example: JsonValue, generation: GenerationConfig) => void; onClose: () => void }) {
  const [sample, setSample] = useState(() => pretty(response.body));
  const [count, setCount] = useState<number | ''>(() => response.generation?.schema.type === 'array'
    ? response.generation.schema.count
    : '');
  const [seed, setSeed] = useState<number | ''>(response.generation?.seed ?? '');
  const fingerprint = JSON.stringify({ sample, count, seed });
  const preview = useMutation({
    mutationFn: async (key: string) => {
      let example: JsonValue;
      try {
        example = JSON.parse(sample) as JsonValue;
      }
      catch {
        throw new Error('Некорректный JSON-образец: исправьте синтаксис');
      }
      const generation = await generatorApi.infer({
        example,
        ...(count !== ''
          ? { arrayCount: count }
          : {}),
        ...(seed !== ''
          ? { seed }
          : {}),
      });
      const result = await generatorApi.preview(generation);
      return { ...result, example, key };
    },
  });
  const current = preview.data?.key === fingerprint
    ? preview.data
    : undefined;
  return (
    <Modal opened onClose={onClose} size="90%" title="Генерация по JSON-образцу" closeOnClickOutside={false}>
      <Stack>
        <Text size="sm" c="dimmed">Вставьте пример и проверьте результат. Preview не изменяет проект; применение добавит схему в черновик.</Text>
        <Grid>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Stack>
              <Text size="sm" fw={600}>JSON-образец</Text>
              <CodeEditor height={300} value={sample} onChange={setSample} />
              <Group grow>
                <NumberInput
                  label="Количество элементов массива"
                  description="Для непустых однородных массивов"
                  placeholder="Как в образце"
                  value={count}
                  min={0}
                  max={MAX_GENERATED_ITEMS}
                  allowDecimal={false}
                  onChange={value => setCount(typeof value === 'number'
                    ? value
                    : '')}
                />
                <NumberInput
                  label="Seed · необязательно"
                  description="Одинаковый seed — одинаковый ответ"
                  placeholder="Случайные данные"
                  value={seed}
                  min={0}
                  max={4_294_967_295}
                  allowDecimal={false}
                  onChange={value => setSeed(typeof value === 'number'
                    ? value
                    : '')}
                />
              </Group>
            </Stack>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Stack>
              <Text size="sm" fw={600}>Generated preview</Text>
              {current
                ? <CodeEditor height={300} value={pretty(current.body)} readOnly />
                : <Alert color="gray">Нажмите Generate preview. После изменения образца, количества или seed обновите результат.</Alert>}
              {current && (
                <Accordion>
                  <Accordion.Item value="schema">
                    <Accordion.Control>Схема генерации</Accordion.Control>
                    <Accordion.Panel><CodeEditor height={220} value={pretty(current.generation)} readOnly /></Accordion.Panel>
                  </Accordion.Item>
                </Accordion>
              )}
            </Stack>
          </Grid.Col>
        </Grid>
        {preview.isError && <Alert color="red" style={{ whiteSpace: 'pre-wrap' }}>{errorMessage(preview.error)}</Alert>}
        <Group justify="space-between">
          <Button variant="light" loading={preview.isPending} onClick={() => preview.mutate(fingerprint)}>Generate preview</Button>
          <Group>
            <Button variant="default" onClick={onClose}>Закрыть без применения</Button>
            <Button
              disabled={!current || preview.isPending}
              onClick={() => {
                if (current)
                  onApply(current.example, current.generation);
              }}
            >
              Применить генератор
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
