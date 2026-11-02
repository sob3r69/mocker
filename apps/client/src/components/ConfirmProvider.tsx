import type { ReactNode } from 'react';
import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { createContext, use, useCallback, useRef, useState } from 'react';

const Context = createContext<(message: string) => Promise<boolean>>(async () => false);
export function useConfirm() {
  return use(Context);
}
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);
  const confirm = useCallback((value: string) => new Promise<boolean>((resolve) => {
    resolveRef.current?.(false);
    resolveRef.current = resolve;
    setMessage(value);
  }), []);
  const finish = (value: boolean) => {
    resolveRef.current?.(value);
    resolveRef.current = null;
    setMessage(null);
  };
  return (
    <Context value={confirm}>
      {children}
      <Modal opened={message !== null} onClose={() => finish(false)} title="Подтверждение" centered>
        <Stack>
          <Text size="sm">{message}</Text>
          <Group justify="end">
            <Button variant="default" onClick={() => finish(false)}>Отмена</Button>
            <Button color="orange" onClick={() => finish(true)}>Подтвердить</Button>
          </Group>
        </Stack>
      </Modal>
    </Context>
  );
}
