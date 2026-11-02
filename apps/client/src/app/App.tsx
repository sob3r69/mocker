import type { MockProject, ProjectSnapshot } from '@mocker/shared';
import type { CSSProperties } from 'react';
import { ActionIcon, Alert, Badge, Burger, Button, Group, Loader, Modal, Paper, SimpleGrid, Stack, Text, Title, useMantineColorScheme } from '@mantine/core';
import { IconArrowRight, IconCode, IconMoonStars, IconPlus, IconServer, IconUpload } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { Link, useBlocker, useMatch, useNavigate } from 'react-router-dom';
import { errorMessage, projectsApi } from '../api/projects';
import { ProjectDialogs } from '../components/ProjectDialogs';
import { Sidebar } from '../components/Sidebar';
import { ProjectWorkspace } from '../features/editor/ProjectWorkspace';
import { useProjectChanges } from '../hooks/useProjectChanges';
import styles from './app.module.css';

export function App() {
  const { diagnostics } = useProjectChanges();
  const { toggleColorScheme } = useMantineColorScheme();
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn:  projectsApi.list,
  });
  const status = useQuery({
    queryKey:        ['server-status'],
    queryFn:         projectsApi.status,
    refetchInterval: 10_000,
  });
  const match = useMatch('/projects/:projectId/*');
  const createMatch = useMatch('/projects/:projectId/new-endpoint');
  const endpointMatch = useMatch('/projects/:projectId/endpoints/:endpointId');
  const projectId = match?.params.projectId;
  const endpointId = endpointMatch?.params.endpointId;
  const [dirty, setDirty] = useState(false);
  const [working, setWorking] = useState<MockProject | null>(null);
  const [dialog, setDialog] = useState<'create' | 'import' | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [width, setWidth] = useState(280);
  const [notice, setNotice] = useState('');
  const client = useQueryClient();
  const navigate = useNavigate();
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname.split('/')[2] !== nextLocation.pathname.split('/')[2]);
  const onDraft = useCallback((config: MockProject | null) => setWorking(config), []);
  const onDirty = useCallback((value: boolean) => setDirty(value), []);
  const notify = useCallback((message: string) => setNotice(message), []);
  useEffect(() => {
    if (!notice)
      return;
    const timer = setTimeout(setNotice, 5000, '');
    return () => clearTimeout(timer);
  }, [notice]);
  const active = projects.data?.find(project => project.config.id === projectId);
  const sidebarProjects = projects.data?.map(project => working && working.id === projectId && project.config.id === projectId
    ? { ...project, config: working }
    : project) ?? [];
  function created(snapshot: ProjectSnapshot) {
    client.setQueryData<ProjectSnapshot[]>(['projects'], previous => [
      ...previous ?? [],
      snapshot,
    ]);
    void client.invalidateQueries({
      queryKey: ['projects'],
    });
    navigate(`/projects/${snapshot.config.id}`);
    notify('Проект создан');
  }
  return (
    <div className={styles.shell} style={{ '--sidebar-width': `${width}px` } as CSSProperties}>
      <header className={styles.header}>
        <Group gap="sm">
          <Burger hiddenFrom="sm" size="sm" opened={mobileOpen} onClick={() => setMobileOpen(value => !value)} aria-label="Проекты" />
          <Link className={styles.brand} to="/">
            <span className={styles.logo}><IconCode size={22} /></span>
            <div>
              <Text fw={700} size="sm" lh={1.2}>Mock HTTP Server</Text>
              <Text size="xs" c="dimmed">Local API workspace</Text>
            </div>
          </Link>
        </Group>
        <Group gap="sm">
          <Badge color={status.isSuccess ? 'teal' : 'gray'} variant="dot" visibleFrom="sm">
            {status.data
              ? `Mock :${status.data.mock.port}`
              : 'Connecting'}
          </Badge>
          <ActionIcon variant="default" size="lg" aria-label="Переключить тему" onClick={toggleColorScheme}><IconMoonStars size={18} /></ActionIcon>
        </Group>
      </header>
      <aside
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('a'))
            setMobileOpen(false);
        }}
        className={`${styles.sidebar} ${mobileOpen ? '' : styles.hidden}`}
      >
        <Sidebar
          projects={sidebarProjects}
          {...(projectId
            ? { activeId: projectId }
            : {})}
          {...(endpointId
            ? { endpointId }
            : {})}
          onCreate={() => setDialog('create')}
          onImport={() => setDialog('import')}
          {...(status.data
            ? { status: status.data }
            : {})}
          notify={notify}
        />
      </aside>
      <div
        role="separator"
        aria-label="Ширина sidebar"
        aria-orientation="vertical"
        aria-valuenow={width}
        tabIndex={0}
        className={styles.resize}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            setWidth(current => Math.max(230, Math.min(480, current + (event.key === 'ArrowLeft'
              ? -10
              : 10))));
          }
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            setWidth(Math.max(230, Math.min(480, event.clientX)));
        }}
        onPointerUp={event => event.currentTarget.releasePointerCapture(event.pointerId)}
      />
      <main className={styles.main}>
        <Stack gap="lg">
          {notice && <Alert color="teal" withCloseButton onClose={() => setNotice('')}>{notice}</Alert>}
          {projects.isError && (
            <Alert color="red" title="Не удалось загрузить проекты">
              {errorMessage(projects.error)}
              <Button
                variant="subtle"
                onClick={() => {
                  void projects.refetch();
                }}
              >
                Повторить
              </Button>
            </Alert>
          )}
          {diagnostics.data?.length
            ? (
                <Alert color="orange" title="Ошибки файлов проектов">
                  {diagnostics.data.map(item => (
                    <Text key={item.file} size="sm">
                      {item.file}
                      :
                      {' '}
                      {item.message}
                      {' '}
                      {item.issues?.map(issue => `${issue.path}: ${issue.message}`).join('; ')}
                    </Text>
                  ))}
                </Alert>
              )
            : null}
          {projects.isPending
            ? (
                <Group justify="center" py="xl">
                  <Loader size="sm" />
                  <Text c="dimmed">Загрузка проектов…</Text>
                </Group>
              )
            : active
              ? (
                  <ProjectWorkspace
                    key={active.config.id}
                    remote={active}
                    createRequested={!!createMatch}
                    {...(endpointId
                      ? { endpointId }
                      : {})}
                    {...(status.data
                      ? { status: status.data }
                      : {})}
                    onDraft={onDraft}
                    onDirty={onDirty}
                    notify={notify}
                  />
                )
              : (
                  <Stack className={styles.welcome} gap="xl">
                    <div>
                      <Badge variant="light" mb="md">Ваш локальный API</Badge>
                      <Title order={1}>{projectId ? 'Проект не найден' : 'API под вашим контролем.'}</Title>
                      <Text c="dimmed" mt="md" size="lg">{projectId ? 'Файл проекта удалён или его конфигурация не загрузилась. Проверьте диагностику или выберите другой проект.' : 'Создавайте HTTP-ответы, проверяйте сценарии ошибок и меняйте API без перезапуска сервера.'}</Text>
                    </div>
                    <Group>
                      <Button leftSection={<IconPlus size={16} />} onClick={() => setDialog('create')}>Создать проект</Button>
                      <Button variant="default" leftSection={<IconUpload size={16} />} onClick={() => setDialog('import')}>Импорт JSON</Button>
                    </Group>
                    <SimpleGrid cols={{ base: 1, sm: 2 }}>
                      {projects.data?.map(project => (
                        <Paper key={project.config.id} withBorder p="lg" radius="md">
                          <Group justify="space-between">
                            <IconServer size={21} />
                            <Badge
                              size="xs"
                              color={project.state === 'running'
                                ? 'teal'
                                : 'gray'}
                              variant="light"
                            >
                              {project.state}
                            </Badge>
                          </Group>
                          <Title order={3} size="h4" mt="md">{project.config.name}</Title>
                          <Text c="dimmed" size="sm" mt={4}>
                            {project.config.prefix}
                            {project.config.basePath === '/'
                              ? ''
                              : project.config.basePath}
                            {' '}
                            ·
                            {project.config.endpoints.length}
                            {' '}
                            endpoints
                          </Text>
                          <Button component={Link} to={`/projects/${project.config.id}`} mt="lg" variant="subtle" size="compact-sm" rightSection={<IconArrowRight size={14} />}>Открыть проект</Button>
                        </Paper>
                      ))}
                    </SimpleGrid>
                  </Stack>
                )}
        </Stack>
      </main>
      <ProjectDialogs kind={dialog} onClose={() => setDialog(null)} onCreated={created} />
      <Modal
        opened={blocker.state === 'blocked'}
        onClose={() => {
          if (blocker.state === 'blocked')
            blocker.reset();
        }}
        title="Есть несохранённые изменения"
        centered
      >
        <Stack>
          <Text size="sm">Перейти к другому проекту и потерять текущий черновик?</Text>
          <Group justify="end">
            <Button
              variant="default"
              onClick={() => {
                if (blocker.state === 'blocked')
                  blocker.reset();
              }}
            >
              Остаться
            </Button>
            <Button
              color="orange"
              onClick={() => {
                if (blocker.state === 'blocked')
                  blocker.proceed();
              }}
            >
              Уйти без сохранения
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  );
}
