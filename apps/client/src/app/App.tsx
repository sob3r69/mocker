import type { ServerStatus } from '@mocker/shared';
import { Alert, Badge, Button, Container, Group, Paper, Stack, Text, Title, useMantineColorScheme } from '@mantine/core';
import { IconMoonStars, IconServer } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useProjectChanges } from '../hooks/useProjectChanges';

export function App() {
  const { changes, diagnostics } = useProjectChanges();
  const { toggleColorScheme } = useMantineColorScheme();
  const status = useQuery({
    queryKey:        ['server-status'],
    queryFn:         async () => (await api.get<ServerStatus>('/server/status')).data,
    refetchInterval: 10_000,
  });
  return (
    <Container size="md" py="xl">
      <Stack gap="lg">
        <Group justify="space-between">
          <Group>
            <IconServer />
            <Title order={1} size="h2">Mock HTTP Server</Title>
            <Badge variant="light">Этап C</Badge>
          </Group>
          <Button variant="default" leftSection={<IconMoonStars size={16} />} onClick={toggleColorScheme}>Тема</Button>
        </Group>
        <Paper withBorder p="lg" radius="md">
          <Stack gap="sm">
            <Title order={2} size="h3">Backend core</Title>
            <Text c="dimmed">Управление проектами доступно через административный API. Визуальный редактор запланирован на этап D.</Text>
            {changes.data && (
              <Text size="sm" c="dimmed">
                Configuration revision:
                {changes.data.version}
              </Text>
            )}
            {diagnostics.data?.map(diagnostic => (
              <Alert key={diagnostic.file} color="orange" title={diagnostic.file}>
                {diagnostic.message}
                {diagnostic.issues?.map((issue, index) => (
                  <Text key={index} size="sm">
                    {issue.path}
                    :
                    {' '}
                    {issue.message}
                  </Text>
                ))}
              </Alert>
            ))}
            {status.isPending && <Text>Подключение к административному серверу…</Text>}
            {status.isError && <Alert color="red">Административный сервер недоступен. Проверьте запуск backend.</Alert>}
            {status.data && (
              <>
                <Text>
                  Admin:
                  {status.data.admin.host}
                  :
                  {status.data.admin.port}
                </Text>
                <Text>
                  Mock API:
                  {status.data.mock.host}
                  :
                  {status.data.mock.port}
                </Text>
              </>
            )}
          </Stack>
        </Paper>
      </Stack>
    </Container>
  );
}
