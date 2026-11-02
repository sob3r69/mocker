import type { ProjectSnapshot } from '@mocker/shared';
import { Button, Group } from '@mantine/core';
import { IconCopy, IconDownload, IconTrash } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { projectsApi } from '../../api/projects';
import { useConfirm } from '../../components/ConfirmProvider';

export function ProjectActions({ remote, disabled, run, notify }: { remote: ProjectSnapshot; disabled: boolean; run: (action: () => Promise<void>) => void; notify: (message: string) => void }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  return (
    <Group mt="lg">
      <Button
        variant="default"
        disabled={disabled}
        leftSection={<IconCopy size={16} />}
        onClick={() => run(async () => {
          const copy = await projectsApi.duplicate(remote.config.id);
          await client.invalidateQueries({
            queryKey: ['projects'],
          });
          navigate(`/projects/${copy.config.id}`);
          notify('Проект скопирован');
        })}
      >
        Дублировать проект
      </Button>
      <Button
        variant="default"
        disabled={disabled}
        leftSection={<IconDownload size={16} />}
        onClick={() => run(async () => {
          await projectsApi.export(remote.config.id);
        })}
      >
        Экспорт JSON
      </Button>
      <Button
        color="red"
        variant="light"
        disabled={disabled}
        leftSection={<IconTrash size={16} />}
        onClick={async () => {
          if (await confirm(`Удалить проект «${remote.config.name}» и его JSON-файл?`)) {
            run(async () => {
              await projectsApi.remove(remote.config.id, remote.diskRevision ?? remote.revision);
              await client.invalidateQueries({
                queryKey: ['projects'],
              });
              navigate('/');
              notify('Проект удалён');
            });
          }
        }}
      >
        Удалить проект
      </Button>
    </Group>
  );
}
