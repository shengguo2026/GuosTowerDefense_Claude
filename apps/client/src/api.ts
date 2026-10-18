import type { StagePack } from '@gtd/content-schema';
import type { HealthResponse, Settings, SettingsPatch } from '@gtd/protocol';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${path} failed with ${response.status}`);
  return (await response.json()) as T;
}

export const api = {
  health: () => request<HealthResponse>('/api/health'),
  stage: (id: string) => request<StagePack>(`/api/stages/${encodeURIComponent(id)}`),
  settings: () => request<Settings>('/api/settings'),
  updateSettings: (patch: SettingsPatch) =>
    request<Settings>('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }),
};
