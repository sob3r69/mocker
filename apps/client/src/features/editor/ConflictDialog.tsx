import type { ProjectDiskDocument } from '@mocker/shared';
import { Alert, Button, Group, Modal, Stack, Text } from '@mantine/core';
import { CodeEditor } from '../../components/CodeEditor';

export function ConflictDialog({ opened, disk, text, pending, onClose, onLoad, onOverwrite }: { opened: boolean; disk: ProjectDiskDocument | null; text: string; pending: boolean; onClose: () => void; onLoad: () => void; onOverwrite: () => void }) {
  return (
    <Modal opened={opened} onClose={onClose} title="Конфликт версий" size="90%">
      <Stack>
        <Alert color="orange">Файл изменился. Загрузите внешнюю версию или подтвердите сохранение своего документа поверх просмотренной версии. Повторное изменение файла снова вызовет конфликт.</Alert>
        <Group grow align="start">
          <div>
            <Text size="sm" fw={500} mb="xs">Ваш черновик</Text>
            <CodeEditor value={text} readOnly height={320} />
          </div>
          <div>
            <Text size="sm" fw={500} mb="xs">Версия с диска</Text>
            <CodeEditor value={disk?.text ?? ''} readOnly height={320} />
          </div>
        </Group>
        {disk?.issues.map((issue, i) => (
          <Text c="red" size="sm" key={i}>
            {issue.path}
            :
            {' '}
            {issue.message}
          </Text>
        ))}
        <Group justify="end">
          <Button variant="default" onClick={onClose}>Продолжить редактирование</Button>
          <Button
            variant="light"
            disabled={!disk || pending}
            onClick={onLoad}
          >
            Загрузить с диска
          </Button>
          <Button color="orange" loading={pending} onClick={onOverwrite}>Сохранить свою версию</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
