import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../..', 'ADMIN_');
  return {
    optimizeDeps: {
      exclude: ['monaco-editor'],
    },
    plugins: [
      react(),
    ],
    server: {
      port:       5173,
      strictPort: true,
      proxy:      {
        '/api': { target: `http://${env.ADMIN_HOST ?? '127.0.0.1'}:${env.ADMIN_PORT ?? '3001'}`, changeOrigin: true },
      },
    },
  };
});
