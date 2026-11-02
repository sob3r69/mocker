import type { MockProject, ServerStatus } from '@mocker/shared';
import { Badge, Button, Code, Group, Paper, Stack, Table, Text, Title } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { endpointUrl } from '../../utils/editor';

export function ProjectOverview({ config, status, onAdd }: { config: MockProject; status?: ServerStatus; onAdd: () => void }) {
  const navigate = useNavigate();
  return (
    <Stack>
      <Group justify="space-between">
        <Text size="sm" c="dimmed">{endpointUrl(config, { path: '/' }, status)}</Text>
        <Button variant="light" leftSection={<IconPlus size={16} />} onClick={onAdd}>Добавить endpoint</Button>
      </Group>
      {config.endpoints.length === 0
        ? (
            <Paper p="xl" withBorder ta="center">
              <Title order={3}>Создайте первый endpoint</Title>
              <Text c="dimmed" mt="sm">Задайте метод, путь и ответ — затем сохраните и запустите проект.</Text>
            </Paper>
          )
        : (
            <Table highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Метод</Table.Th>
                  <Table.Th>Путь</Table.Th>
                  <Table.Th>Название</Table.Th>
                  <Table.Th>Статус</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {config.endpoints.map(item => (
                  <Table.Tr key={item.id}>
                    <Table.Td><Badge size="sm" variant="light">{item.method}</Badge></Table.Td>
                    <Table.Td><Button variant="subtle" size="compact-sm" onClick={() => navigate(`/projects/${config.id}/endpoints/${item.id}`)}><Code>{item.path}</Code></Button></Table.Td>
                    <Table.Td>{item.name}</Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {item.enabled
                          ? `${item.responses.length} ответов`
                          : 'отключён'}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
    </Stack>
  );
}
