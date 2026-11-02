import type { ApiError, CreateProjectInput, MockProject, ProjectDiskDocument, ProjectSnapshot, ServerStatus } from '@mocker/shared';
import { isAxiosError } from 'axios';
import { api } from './client';

export const projectsApi = {
  list:   async () => (await api.get<ProjectSnapshot[]>('/projects')).data,
  status: async () => (await api.get<ServerStatus>('/server/status')).data,
  create: async (input: CreateProjectInput) => (await api.post<ProjectSnapshot>('/projects', input)).data,
  import: async (input: unknown) => (await api.post<ProjectSnapshot>('/projects/import', input)).data,
  save:   async (config: MockProject, revision: string, overwrite = false) => (await api.put<ProjectSnapshot>(`/projects/${config.id}/config`, config, {
    headers: { 'If-Match': revision },
    params:  overwrite
      ? { overwrite: 'true' }
      : {},
  })).data,
  disk:      async (id: string) => (await api.get<ProjectDiskDocument>(`/projects/${id}/disk`)).data,
  state:     async (id: string, action: 'start' | 'stop') => (await api.post<ProjectSnapshot>(`/projects/${id}/${action}`)).data,
  duplicate: async (id: string) => (await api.post<ProjectSnapshot>(`/projects/${id}/duplicate`)).data,
  remove:    async (id: string, revision: string) => api.delete(`/projects/${id}`, {
    headers: { 'If-Match': revision },
  }),
  export: async (id: string) => {
    const { data } = await api.get<Blob>(`/projects/${id}/export`, { responseType: 'blob' });
    const url = URL.createObjectURL(data);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${id}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
export function errorMessage(error: unknown) {
  if (isAxiosError<ApiError>(error)) {
    const detail = error.response?.data?.error;
    return detail?.message
      ? `${detail.message}${detail.issues?.map(issue => `\n${issue.path}: ${issue.message}`).join('') ?? ''}`
      : error.message;
  }
  return error instanceof Error
    ? error.message
    : 'Не удалось выполнить действие';
}
export function isConflict(error: unknown) {
  return isAxiosError<ApiError>(error) && error.response?.status === 409 && error.response.data.error?.code === 'REVISION_CONFLICT';
}
