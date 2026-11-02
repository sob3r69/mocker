import type { MockResponse } from '@mocker/shared';
import { Badge, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { pretty } from '../../utils/editor';
import styles from './editor.module.css';

export function ResponsePreview({ response, method = 'GET' }: { response?: MockResponse; method?: string }) {
  if (!response)
    return null;
  const empty = [204, 304].includes(response.status) || method === 'HEAD';
  return (
    <Paper withBorder p="lg" className={styles.preview}>
      <Stack gap="md">
        <Group justify="space-between">
          <Title order={3} size="sm">RESPONSE PREVIEW</Title>
          <Badge
            variant="light"
            color={response.status >= 400
              ? 'red'
              : 'teal'}
          >
            {response.status}
          </Badge>
        </Group>
        <Text c="dimmed" size="xs">Предпросмотр выбранного варианта</Text>
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
        <pre className={styles.code}>
          {empty
            ? '(без тела ответа)'
            : response.contentType === 'application/json'
              ? pretty(response.body)
              : String(response.body ?? '')}
        </pre>
      </Stack>
    </Paper>
  );
}
