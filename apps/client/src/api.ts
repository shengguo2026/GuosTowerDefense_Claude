import type { StagePack } from '@gtd/content-schema';
import type {
  HealthResponse,
  NearbyGames,
  NetworkInfo,
  Progress,
  Records,
  SaveInfo,
  Settings,
  SettingsPatch,
} from '@gtd/protocol';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${path} failed with ${response.status}`);
  return (await response.json()) as T;
}

/** Downloads the save as a file (from the PC only). */
export const SAVE_EXPORT_URL = '/api/save/export';

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
  /** High scores and statistics. */
  records: () => request<Records>('/api/records'),
  /** The save on the PC: where it was loaded from and its backups (from the PC only). */
  saveInfo: () => request<SaveInfo>('/api/save'),
  /** Replaces the save with an exported one; the current save is kept as a backup (from the PC only). */
  importSave: (text: string) =>
    request<SaveInfo>('/api/save/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: text,
    }),
  /** Whether phones and tablets in the PC's network can join, and where. */
  network: () => request<NetworkInfo>('/api/network'),
  /** Opens the game to phones and tablets in the PC's network, or closes it (from the PC only). */
  setSharing: (sharing: boolean) =>
    request<NetworkInfo>('/api/network', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sharing }),
    }),
  /** Wi-Fi games other PCs in the network announce (from the PC only). */
  nearby: () => request<NearbyGames>('/api/nearby'),
  /** Codex pictures that exist on the PC, by art id. */
  art: () => request<Record<string, string>>('/api/art'),
};
