import type { MockProject, ProjectDiskDocument, ProjectSnapshot, ServerStatus } from '@mocker/shared';
import { Alert, Badge, Button, Group, Paper, SegmentedControl, Stack, Tabs, Text, Title } from '@mantine/core';
import { projectSchema } from '@mocker/shared';
import { IconCheck, IconCode, IconPlayerPlay, IconPlayerStop, IconPlus, IconRefresh, IconSettings } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { errorMessage, isConflict, projectsApi } from '../../api/projects';
import { CodeEditor } from '../../components/CodeEditor';
import { useConfirm } from '../../components/ConfirmProvider';
import { useProjectDraft } from '../../hooks/useProjectDraft';
import { duplicateEndpoint, newEndpoint, pretty } from '../../utils/editor';
import { ConflictDialog } from './ConflictDialog';
import { EndpointEditor } from './EndpointEditor';
import { ProjectActions } from './ProjectActions';
import { ProjectOverview } from './ProjectOverview';
import { ProjectSettings } from './ProjectSettings';

export function ProjectWorkspace({ remote, endpointId, status, createRequested = false, onDraft, onDirty, notify }: {
  remote:           ProjectSnapshot;
  endpointId?:      string;
  createRequested?: boolean;
  status?:          ServerStatus;
  onDraft:          (config: MockProject | null) => void;
  onDirty:          (value: boolean) => void;
  notify:           (message: string) => void;
}) {
  const confirm = useConfirm();
  const draft = useProjectDraft(remote);
  const navigate = useNavigate();
  const client = useQueryClient();
  const [mode, setMode] = useState('visual');
  const [error, setError] = useState('');
  const [disk, setDisk] = useState<ProjectDiskDocument | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const endpoint = draft.config.endpoints.find(item => item.id === endpointId);
  const hasBufferErrors = Object.values(draft.buffers).some(item => item.error);
  const busy = useMutation({
    mutationFn: (action: () => Promise<void>) => action(),
    onError:    error => setError(errorMessage(error)),
  });
  useEffect(() => {
    onDirty(draft.dirty);
  }, [draft.dirty, onDirty]);
  useEffect(() => {
    onDraft(draft.config);
  }, [draft.config, onDraft]);
  useEffect(() => () => {
    onDirty(false);
    onDraft(null);
  }, [onDirty, onDraft]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (draft.dirty)
        event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [draft.dirty]);
  function cache(snapshot: ProjectSnapshot) {
    client.setQueryData<ProjectSnapshot[]>(['projects'], previous => previous?.map(item => item.config.id === snapshot.config.id
      ? snapshot
      : item));
    void client.invalidateQueries({
      queryKey: ['projects'],
    });
  }
  async function reviewConflict() {
    setDisk(await projectsApi.disk(remote.config.id));
    setConflictOpen(true);
  }
  async function save(overwrite = false) {
    setError('');
    const config = draft.validate();
    const submittedText = draft.text;
    const submittedBuffers = draft.buffers;
    try {
      const snapshot = await projectsApi.save(config, overwrite && disk
        ? disk.revision
        : draft.base.revision, overwrite);
      cache(snapshot);
      draft.acceptSaved(snapshot, submittedText, submittedBuffers);
      setDisk(null);
      setConflictOpen(false);
      notify('Изменения сохранены в JSON-файл');
    }
    catch (error) {
      if (isConflict(error))
        await reviewConflict();
      else throw error;
    }
  }
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (!busy.isPending)
          busy.mutate(() => save());
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  });
  function addEndpoint() {
    const next = newEndpoint(draft.config);
    draft.change({
      ...draft.config,
      endpoints: [...draft.config.endpoints, next],
    });
    navigate(`/projects/${remote.config.id}/endpoints/${next.id}`);
  }
  const createIntentRef = useRef(false);
  useEffect(() => {
    if (!createRequested) {
      createIntentRef.current = false;
      return;
    }
    if (createIntentRef.current)
      return;
    createIntentRef.current = true;
    const next = newEndpoint(draft.config);
    draft.change({
      ...draft.config,
      endpoints: [...draft.config.endpoints, next],
    });
    navigate(`/projects/${remote.config.id}/endpoints/${next.id}`, { replace: true });
  }, [
    createRequested,
    draft,
    navigate,
    remote.config.id,
  ]);
  function copyEndpoint() {
    if (!endpoint)
      return;
    const next = duplicateEndpoint(endpoint);
    draft.change({
      ...draft.config,
      endpoints: [...draft.config.endpoints, next],
    });
    navigate(`/projects/${remote.config.id}/endpoints/${next.id}`);
  }
  async function deleteEndpoint() {
    if (endpoint && await confirm(`Удалить endpoint ${endpoint.method} ${endpoint.path}? Изменение вступит в силу после сохранения.`)) {
      draft.removeBuffers(endpoint.id);
      draft.change({
        ...draft.config,
        endpoints: draft.config.endpoints.filter(item => item.id !== endpoint.id),
      });
      navigate(`/projects/${remote.config.id}`);
    }
  }
  let validText = false;
  try {
    validText = projectSchema.safeParse(JSON.parse(draft.text)).success;
  }
  catch {}
  return (
    <Stack gap="lg">
      <Group justify="space-between" align="start">
        <div>
          <Group gap="sm">
            <Title order={1} size="h2">{endpoint ? endpoint.name : draft.config.name}</Title>
            <Badge
              color={remote.state === 'running'
                ? 'teal'
                : remote.state === 'error'
                  ? 'red'
                  : 'gray'}
              variant="dot"
            >
              {remote.state}
            </Badge>
            {draft.dirty && <Badge color="orange" variant="light">Не сохранено</Badge>}
          </Group>
          <Text c="dimmed" size="sm" mt={5}>
            {draft.config.name}
            {' '}
            /
            {' '}
            {endpoint
              ? `${endpoint.method} ${endpoint.path}`
              : `${draft.config.endpoints.length} endpoints`}
          </Text>
        </div>
        <Group gap="xs">
          <Button
            variant="default"
            leftSection={<IconRefresh size={16} />}
            disabled={!draft.dirty || busy.isPending}
            onClick={async () => {
              if (await confirm('Отменить все несохранённые изменения?')) {
                draft.load(remote);
                setError('');
              }
            }}
          >
            Отменить
          </Button>
          <Button leftSection={<IconCheck size={16} />} loading={busy.isPending} disabled={!draft.dirty} onClick={() => busy.mutate(() => save())}>Сохранить</Button>
        </Group>
      </Group>
      <Group justify="space-between">
        <Group gap="xs">
          <Button
            size="xs"
            variant="light"
            color={remote.state === 'running'
              ? 'gray'
              : 'teal'}
            leftSection={<IconPlayerPlay size={14} />}
            disabled={draft.dirty || remote.state === 'running' || !!remote.error || !remote.config.enabled || busy.isPending}
            onClick={() => busy.mutate(async () => {
              cache(await projectsApi.state(remote.config.id, 'start'));
              notify('Проект запущен');
            })}
          >
            Запустить
          </Button>
          <Button
            size="xs"
            variant="default"
            leftSection={<IconPlayerStop size={14} />}
            disabled={remote.state === 'stopped' || busy.isPending}
            onClick={() => busy.mutate(async () => {
              cache(await projectsApi.state(remote.config.id, 'stop'));
              notify('Проект остановлен');
            })}
          >
            Остановить
          </Button>
          <Button size="xs" variant="subtle" leftSection={<IconSettings size={14} />} onClick={() => navigate(`/projects/${remote.config.id}`)}>Проект</Button>
          <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} onClick={addEndpoint}>Endpoint</Button>
        </Group>
        <SegmentedControl
          aria-label="Режим редактора"
          size="xs"
          value={mode}
          data={[
            { label: 'Визуальный', value: 'visual', disabled: !validText },
            { label: 'JSON', value: 'json', disabled: hasBufferErrors },
          ]}
          onChange={(next) => {
            if (next === 'json')
              draft.removeBuffers('');
            setMode(next);
          }}
        />
      </Group>
      {draft.dirty && <Text size="xs" c="dimmed">Изменения применяются после сохранения · Ctrl / ⌘ S</Text>}
      {error && <Alert color="red" withCloseButton onClose={() => setError('')} style={{ whiteSpace: 'pre-wrap' }}>{error}</Alert>}
      {Object.entries(draft.buffers).filter(([, value]) => value.error).map(([key, value]) => <Alert key={key} color="red">{value.error}</Alert>)}
      {remote.error && (
        <Alert color="red" title="Ошибка файла проекта">
          {remote.error}
          . Последняя корректная конфигурация сохранена.
          {' '}
          <Button variant="subtle" size="compact-xs" onClick={() => busy.mutate(reviewConflict)}>Открыть версию с диска</Button>
        </Alert>
      )}
      {draft.conflict && draft.dirty && (
        <Alert color="orange" title="Файл изменился снаружи">
          Черновик сохранён в редакторе.
          <Button variant="subtle" size="compact-xs" onClick={() => busy.mutate(reviewConflict)}>Сравнить версии</Button>
        </Alert>
      )}
      {mode === 'json'
        ? (
            <Stack>
              <Group justify="space-between">
                <Text size="sm" c="dimmed">
                  {remote.config.id}
                  .json · единая конфигурация проекта
                </Text>
                <Button
                  size="xs"
                  variant="default"
                  leftSection={<IconCode size={14} />}
                  onClick={async () => {
                    try {
                      draft.changeText(pretty(JSON.parse(draft.text)));
                    }
                    catch {
                      setError('Не удалось форматировать: некорректный JSON');
                    }
                  }}
                >
                  Форматировать
                </Button>
              </Group>
              <Paper withBorder style={{ overflow: 'hidden' }}><CodeEditor project height="65vh" value={draft.text} onChange={draft.changeText} /></Paper>
            </Stack>
          )
        : endpoint
          ? (
              <EndpointEditor
                key={endpoint.id}
                endpoint={endpoint}
                draft={draft}
                {...(status
                  ? { status }
                  : {})}
                onDuplicate={copyEndpoint}
                onDelete={deleteEndpoint}
                notify={notify}
              />
            )
          : endpointId
            ? (
                <Alert color="orange">
                  Endpoint отсутствует в текущем документе.
                  <Button variant="subtle" onClick={() => navigate(`/projects/${remote.config.id}`)}>К проекту</Button>
                </Alert>
              )
            : (
                <Tabs defaultValue="overview" keepMounted={false}>
                  <Tabs.List>
                    <Tabs.Tab value="overview">Endpoints</Tabs.Tab>
                    <Tabs.Tab value="settings">Настройки проекта</Tabs.Tab>
                  </Tabs.List>
                  <Tabs.Panel value="overview" pt="lg">
                    <ProjectOverview
                      config={draft.config}
                      {...(status
                        ? { status }
                        : {})}
                      onAdd={addEndpoint}
                    />
                  </Tabs.Panel>
                  <Tabs.Panel value="settings" pt="lg">
                    <Stack>
                      <ProjectSettings config={draft.config} onChange={draft.change} draft={draft} />
                      <ProjectActions remote={remote} disabled={draft.dirty || busy.isPending} run={busy.mutate} notify={notify} />
                    </Stack>
                  </Tabs.Panel>
                </Tabs>
              )}
      <ConflictDialog
        opened={conflictOpen}
        disk={disk}
        text={draft.text}
        pending={busy.isPending}
        onClose={() => setConflictOpen(false)}
        onOverwrite={() => busy.mutate(() => save(true))}
        onLoad={async () => {
          if (!disk || !await confirm('Загрузить версию с диска? Ваш несохранённый черновик будет заменён.'))
            return;
          const snapshot: ProjectSnapshot = { config: disk.config ?? remote.config, revision: disk.revision, state: remote.state };
          draft.load(snapshot, disk.text);
          if (!disk.config)
            setMode('json');
          setConflictOpen(false);
          setError('');
        }}
      />
    </Stack>
  );
}
