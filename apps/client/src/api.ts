import type { StagePack } from '@gtd/content-schema';
import type { HealthResponse, NetworkInfo, Progress, Settings, SettingsPatch } from '@gtd/protocol';

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
  progress: () => request<Progress>('/api/progress'),
  /** Whether phones and tablets in the PC's network can join, and where. */
  network: () => request<NetworkInfo>('/api/network'),
  /** Opens the game to phones and tablets in the PC's network, or closes it (from the PC only). */
  setSharing: (sharing: boolean) =>
    request<NetworkInfo>('/api/network', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sharing }),
    }),
  /** Codex pictures that exist on the PC, by art id. */
  art: () => request<Record<string, string>>('/api/art'),
};
