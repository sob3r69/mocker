import type { ProjectSnapshot, ServerStatus } from '@mocker/shared';
import { ActionIcon, Badge, Button, Collapse, Group, Menu, Stack, Text, TextInput, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconDots, IconPlus, IconSearch, IconUpload } from '@tabler/icons-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import styles from '../app/app.module.css';
import { endpointUrl } from '../utils/editor';

export function methodColor(method: string) {
  return {
    GET:     'teal',
    POST:    'blue',
    PUT:     'orange',
    PATCH:   'yellow',
    DELETE:  'red',
    HEAD:    'violet',
    OPTIONS: 'gray',
  }[method] ?? 'gray';
}
export function Sidebar({ projects, activeId, endpointId, onCreate, onImport, status, notify }: { projects: ProjectSnapshot[]; activeId?: string; endpointId?: string; onCreate: () => void; onImport: () => void; status?: ServerStatus; notify: (message: string) => void }) {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const query = search.toLowerCase();
  const filtered = projects.filter(({ config }) => `${config.name} ${config.id}`.toLowerCase().includes(query) || config.endpoints.some(endpoint => `${endpoint.name} ${endpoint.method} ${endpoint.path}`.toLowerCase().includes(query)));
  return (
    <Stack gap="md" p="md">
      <Group justify="space-between">
        <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: 1.4 }}>Workspace</Text>
        <Badge variant="light" size="xs" color="gray">{projects.length}</Badge>
      </Group>
      <TextInput aria-label="Поиск проектов и endpoints" placeholder="Найти проект или endpoint…" leftSection={<IconSearch size={15} />} value={search} onChange={event => setSearch(event.currentTarget.value)} size="xs" />
      <Group grow gap="xs">
        <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={onCreate}>Проект</Button>
        <Button size="xs" variant="default" leftSection={<IconUpload size={14} />} onClick={onImport}>Импорт</Button>
      </Group>
      <Stack gap={6}>
        {filtered.map(project => (
          <div key={project.config.id}>
            <Group
              gap={4}
              wrap="nowrap"
              className={activeId === project.config.id && !endpointId
                ? styles.activeProject
                : undefined}
            >
              <ActionIcon variant="subtle" color="gray" size="sm" aria-label={`Свернуть или раскрыть ${project.config.name}`} onClick={() => setCollapsed(previous => ({ ...previous, [project.config.id]: !previous[project.config.id] }))}>
                {collapsed[project.config.id] && !query
                  ? <IconChevronRight size={14} />
                  : <IconChevronDown size={14} />}
              </ActionIcon>
              <UnstyledButton component={Link} to={`/projects/${project.config.id}`} style={{ flex: 1, minWidth: 0 }}><Text size="sm" fw={600} truncate>{project.config.name}</Text></UnstyledButton>
              <span
                title={project.state}
                className={`${styles.dot} ${project.state === 'running'
                  ? styles.running
                  : project.state === 'error'
                    ? styles.error
                    : ''}`}
              />
              <Menu position="bottom-end">
                <Menu.Target><ActionIcon variant="subtle" color="gray" aria-label={`Действия проекта ${project.config.name}`} size="sm"><IconDots size={14} /></ActionIcon></Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item component={Link} to={`/projects/${project.config.id}`}>Открыть проект</Menu.Item>
                  <Menu.Item component={Link} to={`/projects/${project.config.id}/new-endpoint`}>Создать endpoint</Menu.Item>
                  <Menu.Item onClick={() => navigator.clipboard.writeText(endpointUrl(project.config, { path: '/' }, status)).then(() => notify('Базовый URL скопирован')).catch(() => notify('Не удалось скопировать URL'))}>Копировать базовый URL</Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </Group>
            <Collapse expanded={!collapsed[project.config.id] || !!query}>
              <Stack gap={2} pl={20} mt={4}>
                {project.config.endpoints.filter(endpoint => !query || project.config.name.toLowerCase().includes(query) || `${endpoint.name} ${endpoint.method} ${endpoint.path}`.toLowerCase().includes(query)).map(endpoint => (
                  <UnstyledButton
                    component={Link}
                    key={endpoint.id}
                    to={`/projects/${project.config.id}/endpoints/${endpoint.id}`}
                    className={`${styles.endpoint} ${activeId === project.config.id && endpointId === endpoint.id
                      ? styles.selected
                      : ''}`}
                    style={{
                      opacity: endpoint.enabled ? 1 : 0.5,
                    }}
                  >
                    <Badge size="xs" variant="light" color={methodColor(endpoint.method)} w={54}>{endpoint.method}</Badge>
                    <Text size="xs" truncate title={endpoint.name} style={{ fontFamily: 'var(--mantine-font-family-monospace)' }}>{endpoint.path}</Text>
                  </UnstyledButton>
                ))}
                {!project.config.endpoints.length && <Text c="dimmed" size="xs" py="xs">Нет endpoints</Text>}
              </Stack>
            </Collapse>
          </div>
        ))}
        {!filtered.length && <Text c="dimmed" size="sm" py="lg">{search ? 'Ничего не найдено' : 'Создайте проект или импортируйте JSON.'}</Text>}
      </Stack>
    </Stack>
  );
}
