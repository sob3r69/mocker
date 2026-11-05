import type { MockResponse } from '@mocker/shared';
import { Accordion, Alert, Badge, Button, Group, Stack, Text } from '@mantine/core';
import { useMutation } from '@tanstack/react-query';
import { generatorApi } from '../../api/generator';
import { errorMessage } from '../../api/projects';
import { pretty } from '../../utils/editor';
import styles from './editor.module.css';

export function ResponsePreview({ response, method = 'GET' }: { response?: MockResponse; method?: string }) {
  const preview = useMutation({ mutationFn: generatorApi.preview });
  const current = response?.generation && preview.data && pretty(preview.data.generation) === pretty(response.generation)
    ? preview.data
    : undefined;
  if (!response)
    return null;
  const empty = [204, 304].includes(response.status) || method === 'HEAD';
  return (
    <Accordion variant="contained" className={styles.preview}>
      <Accordion.Item value="preview">
        <Accordion.Control>
          <Group gap="sm">
            <Text size="xs" fw={600}>Response preview</Text>
            <Badge
              variant="light"
              color={response.status >= 400
                ? 'red'
                : 'teal'}
            >
              {response.status}
            </Badge>
            <Text size="xs" c="dimmed">
              {response.contentType}
              {' '}
              ·
              {' '}
              {response.bodyMode}
            </Text>
          </Group>
        </Accordion.Control>
        <Accordion.Panel>
          <Stack gap="xs">
            <pre className={styles.code}>{`HTTP/1.1 ${response.status}\nContent-Type: ${response.contentType}\n${Object.entries(response.headers).filter(([key]) => key.toLowerCase() !== 'content-type').map(([key, value]) => `${key}: ${value}`).join('\n')}`}</pre>
            <Text size="xs" c="dimmed">
              {response.delay.type === 'fixed'
                ? `${response.delay.value} мс`
                : `${response.delay.min}–${response.delay.max} мс`}
              {' '}
              ·
              {' '}
              {response.bodyMode}
            </Text>
            {response.bodyMode === 'generated' && !empty && (
              <Button
                size="xs"
                variant="light"
                disabled={!response.generation}
                loading={preview.isPending}
                onClick={() => {
                  if (response.generation)
                    preview.mutate(response.generation);
                }}
              >
                Generate preview
              </Button>
            )}
            {response.bodyMode === 'generated' && preview.isError && <Alert color="red">{errorMessage(preview.error)}</Alert>}
            <pre className={styles.code}>
              {empty
                ? '(без тела ответа)'
                : response.bodyMode === 'generated'
                  ? current
                    ? pretty(current.body)
                    : 'Нажмите Generate preview для генерации примера.'
                  : response.contentType === 'application/json'
                    ? pretty(response.body)
                    : String(response.body ?? '')}
            </pre>
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
