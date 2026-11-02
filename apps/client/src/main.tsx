import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { App } from './app/App';
import { ConfirmProvider } from './components/ConfirmProvider';
import '@mantine/core/styles.css';

const queryClient = new QueryClient();
const router = createBrowserRouter([
  {
    path:     '/',
    element:  <App />,
    children: [
      { path: '*', element: null },
    ],
  },
]);
const root = document.getElementById('root');
if (!root)
  throw new Error('Application root is missing');
createRoot(root).render(
  <StrictMode>
    <MantineProvider defaultColorScheme="auto" theme={{ primaryColor: 'teal', fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif', defaultRadius: 'sm' }}>
      <QueryClientProvider client={queryClient}>
        <ConfirmProvider><RouterProvider router={router} /></ConfirmProvider>
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
);
