// @vitest-environment jsdom
import type { GenerationConfig, GenerationPreview } from '@mocker/shared';
import type { ChangeEvent } from 'react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { generatorApi } from '../../api/generator';
import { newResponse } from '../../utils/editor';
import { GeneratorDialog } from './GeneratorDialog';

vi.mock('../../components/CodeEditor', () => ({
  CodeEditor: ({ value, onChange, readOnly }: { value: string; onChange?: (value: string) => void; readOnly?: boolean }) => createElement('textarea', {
    'aria-label': readOnly ? 'Generated result' : 'JSON sample editor',
    value,
    readOnly,
    'onChange':   (event: ChangeEvent<HTMLTextAreaElement>) => onChange?.(event.currentTarget.value),
  }),
}));
beforeAll(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches:       false,
    media:         '',
    onchange:      null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true,
  }));
});
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
  vi.restoreAllMocks();
});
const generation: GenerationConfig = {
  schema: {
    type:       'object',
    properties: {
      email: { type: 'value', generator: 'email' },
    },
  },
};
const result: GenerationPreview = {
  generation,
  body: { email: 'generated@example.com' },
};
function setup() {
  const client = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
    },
  });
  clients.push(client);
  const apply = vi.fn();
  render(createElement(MantineProvider, { forceColorScheme: 'light', env: 'test' }, createElement(QueryClientProvider, { client }, createElement(GeneratorDialog, {
    response: newResponse(),
    onApply:  apply,
    onClose:  vi.fn(),
  }))));
  return apply;
}
describe('generator preview workflow', () => {
  it('only applies a schema after explicit confirmation, not when preview finishes', async () => {
    const infer = vi.spyOn(generatorApi, 'infer').mockResolvedValue(generation);
    vi.spyOn(generatorApi, 'preview').mockResolvedValue(result);
    const apply = setup();
    fireEvent.change(screen.getByLabelText('JSON sample editor'), {
      target: { value: '{"email":"sample@example.com"}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate preview' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Применить генератор' }).hasAttribute('disabled')).toBe(false));
    expect(apply).not.toHaveBeenCalled();
    expect(infer).toHaveBeenCalledWith({
      example: { email: 'sample@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Применить генератор' }));
    expect(apply).toHaveBeenCalledWith({ email: 'sample@example.com' }, generation);
  });
  it('does not apply an older preview when the sample changes during a request', async () => {
    let resolve: (value: GenerationConfig) => void = () => {};
    vi.spyOn(generatorApi, 'infer').mockReturnValue(new Promise((done) => {
      resolve = done;
    }));
    const preview = vi.spyOn(generatorApi, 'preview').mockResolvedValue(result);
    const apply = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Generate preview' }));
    fireEvent.change(screen.getByLabelText('JSON sample editor'), {
      target: { value: '{"name":"new sample"}' },
    });
    await act(async () => {
      resolve(generation);
    });
    await waitFor(() => expect(preview).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Применить генератор' }).hasAttribute('disabled')).toBe(true);
    expect(apply).not.toHaveBeenCalled();
  });
  it('reports malformed samples without calling the API or applying a generator', async () => {
    const infer = vi.spyOn(generatorApi, 'infer');
    const apply = setup();
    fireEvent.change(screen.getByLabelText('JSON sample editor'), {
      target: { value: '{invalid' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate preview' }));
    await waitFor(() => expect(screen.getByText(/Некорректный JSON-образец/)).toBeDefined());
    expect(infer).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });
});
