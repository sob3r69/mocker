import type { ProjectSnapshot } from '@mocker/shared';
import { Alert, Button, FileInput, Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import { createProjectSchema, projectSchema } from '@mocker/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage, projectsApi } from '../api/projects';
import { CodeEditor } from './CodeEditor';

export function ProjectDialogs({ kind, onClose, onCreated }: { kind: 'create' | 'import' | null; onClose: () => void; onCreated: (snapshot: ProjectSnapshot) => void }) {
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [prefix, setPrefix] = useState('');
  const [basePath, setBasePath] = useState('/api');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const create = useMutation({
    mutationFn: async () => kind === 'import'
      ? projectsApi.import(projectSchema.parse(JSON.parse(text)))
      : projectsApi.create(createProjectSchema.parse({ id, name, prefix, basePath })),
    onSuccess: (snapshot) => {
      onCreated(snapshot);
      onClose();
      setName('');
      setId('');
      setPrefix('');
      setText('');
      setError('');
    },
    onError: error => setError(errorMessage(error)),
  });
  return (
    <Modal
      opened={!!kind}
      onClose={onClose}
      title={kind === 'create'
        ? 'Новый проект'
        : 'Импорт проекта'}
      size={kind === 'import'
        ? 'xl'
        : 'md'}
      closeOnClickOutside={!create.isPending}
    >
      <form onSubmit={(event) => {
        event.preventDefault();
        setError('');
        create.mutate();
      }}
      >
        <Stack>
          {error && <Alert color="red" style={{ whiteSpace: 'pre-wrap' }}>{error}</Alert>}
          {kind === 'create'
            ? (
                <>
                  <TextInput label="Название проекта" placeholder="Shop API" required value={name} onChange={event => setName(event.currentTarget.value)} data-autofocus />
                  <TextInput
                    label="ID проекта"
                    description="Латинские буквы в нижнем регистре, цифры, дефисы"
                    placeholder="shop"
                    required
                    value={id}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setId(value);
                      if (!prefix || prefix === `/${id}`)
                        setPrefix(`/${value}`);
                    }}
                  />
                  <Group grow>
                    <TextInput label="Prefix" placeholder="/shop" required value={prefix} onChange={event => setPrefix(event.currentTarget.value)} />
                    <TextInput label="Base path" value={basePath} onChange={event => setBasePath(event.currentTarget.value)} />
                  </Group>
                </>
              )
            : (
                <>
                  <FileInput
                    label="JSON-файл"
                    accept=".json,application/json"
                    clearable
                    onChange={async (file) => {
                      if (!file)
                        return;
                      if (file.size > 10_485_760) {
                        setError('Файл превышает 10 МБ');
                        return;
                      }
                      try {
                        setText(await file.text());
                        setError('');
                      }
                      catch {
                        setError('Не удалось прочитать файл');
                      }
                    }}
                  />
                  <Text c="dimmed" size="sm">Или вставьте полную конфигурацию. Импорт сохраняет ID и проверяет конфликты prefix.</Text>
                  <CodeEditor height={360} value={text} onChange={setText} />
                </>
              )}
          <Group justify="end">
            <Button variant="default" onClick={onClose}>Отмена</Button>
            <Button type="submit" loading={create.isPending}>
              {kind === 'create'
                ? 'Создать проект'
                : 'Импортировать'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
