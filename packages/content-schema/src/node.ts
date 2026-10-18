import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { formatIssue, loadStagePack, type ContentIssue, type LoadResult } from './loader';
import type { StagePack } from './schema';

export function directoryReader(stageDir: string) {
  return {
    async readJson(file: string): Promise<unknown> {
      return JSON.parse(await readFile(join(stageDir, file), 'utf8'));
    },
  };
}

export function loadStageDirectory(stageDir: string): Promise<LoadResult> {
  return loadStagePack(directoryReader(stageDir));
}

export interface StageLoadReport {
  stages: StagePack[];
  /** Optional stage packs that were skipped, with the reasons. */
  warnings: string[];
  /** Core stage packs that failed; the game must not start with these. */
  errors: string[];
}

/**
 * Loads every stage pack under `stagesRoot`, sorted by their `order`. A broken optional pack is skipped with a
 * warning; a broken core pack is reported as an error.
 */
export async function loadAllStages(stagesRoot: string): Promise<StageLoadReport> {
  const entries = await readdir(stagesRoot, { withFileTypes: true });
  const report: StageLoadReport = { stages: [], warnings: [], errors: [] };
  for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const result = await loadStageDirectory(join(stagesRoot, entry.name));
    if (result.ok) {
      report.stages.push(result.pack);
      continue;
    }
    const lines = result.issues.map((issue: ContentIssue) => formatIssue(entry.name, issue));
    const isCore = await isCoreStage(join(stagesRoot, entry.name));
    (isCore ? report.errors : report.warnings).push(...lines);
  }
  report.stages.sort((a, b) => a.manifest.order - b.manifest.order);
  return report;
}

/** Reads just the `core` flag, so a pack can be classified even when the rest of it is broken. */
async function isCoreStage(stageDir: string): Promise<boolean> {
  try {
    const manifest = JSON.parse(await readFile(join(stageDir, 'stage.json'), 'utf8')) as { core?: unknown };
    return manifest.core === true;
  } catch {
    return false;
  }
}
