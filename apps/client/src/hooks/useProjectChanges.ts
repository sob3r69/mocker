import type { ProjectChanges, ProjectDiagnostic } from '@mocker/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '../api/client';

export function useProjectChanges() {
  const client = useQueryClient();
  const changes = useQuery({
    queryKey:        ['project-changes'],
    queryFn:         async () => (await api.get<ProjectChanges>('/project-changes')).data,
    refetchInterval: 1000,
  });
  const diagnostics = useQuery({
    queryKey: ['project-diagnostics', changes.data?.instanceId, changes.data?.version],
    queryFn:  async () => (await api.get<ProjectDiagnostic[]>('/project-diagnostics')).data,
    enabled:  !!changes.data,
    gcTime:   0,
  });
  useEffect(() => {
    if (changes.data?.instanceId) {
      // Invalidate server documents only. Editors keep their own dirty draft.
      void client.invalidateQueries({
        queryKey: ['projects'],
      });
      void client.invalidateQueries({
        queryKey: ['project'],
      });
    }
  }, [client, changes.data?.instanceId, changes.data?.version]);
  return { changes, diagnostics };
}
