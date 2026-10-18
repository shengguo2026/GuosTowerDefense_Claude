import type { z } from 'zod';
import {
  CatalogSchema,
  LANGUAGES,
  LevelSchema,
  ProfileSchema,
  StageManifestSchema,
  TextsSchema,
  type Language,
  type StagePack,
  type Texts,
} from './schema';
import { crossCheck } from './validate';

export interface ContentIssue {
  /** File inside the stage pack, e.g. `levels/meadow.json`. */
  file: string;
  /** Location inside the file, e.g. `routes.0.nodes.2`. */
  path: string;
  message: string;
}

export type LoadResult = { ok: true; pack: StagePack } | { ok: false; issues: ContentIssue[] };

/** Reads files of one stage pack. Kept abstract so the loader works in Node, in tests and in the browser. */
export interface StageFileReader {
  /** Parsed JSON of a file relative to the stage pack root; throws if the file is missing or not valid JSON. */
  readJson(file: string): Promise<unknown>;
}

export async function loadStagePack(reader: StageFileReader): Promise<LoadResult> {
  const issues: ContentIssue[] = [];

  async function read<T extends z.ZodType>(file: string, schema: T): Promise<z.infer<T> | undefined> {
    let raw: unknown;
    try {
      raw = await reader.readJson(file);
    } catch (error) {
      issues.push({ file, path: '', message: `cannot read file: ${(error as Error).message}` });
      return undefined;
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push({ file, path: issue.path.join('.'), message: issue.message });
      }
      return undefined;
    }
    return parsed.data;
  }

  const manifest = await read('stage.json', StageManifestSchema);
  if (!manifest) return { ok: false, issues };

  const allProfileIds = [...manifest.profiles.attacker, ...manifest.profiles.defender];
  const [levels, profiles, catalog, texts] = await Promise.all([
    Promise.all(manifest.levels.map((level) => read(`levels/${level}.json`, LevelSchema))),
    Promise.all(allProfileIds.map((profile) => read(`profiles/${profile}.json`, ProfileSchema))),
    read('catalog.json', CatalogSchema),
    Promise.all(LANGUAGES.map((language) => read(`texts/${language}.json`, TextsSchema))),
  ]);

  if (issues.length > 0 || !catalog) return { ok: false, issues };

  const pack: StagePack = {
    manifest,
    levels: levels.filter((level) => level !== undefined),
    profiles: profiles.filter((profile) => profile !== undefined),
    catalog,
    texts: Object.fromEntries(LANGUAGES.map((language, i) => [language, texts[i] as Texts])) as Record<
      Language,
      Texts
    >,
  };
  issues.push(...crossCheck(pack));
  return issues.length > 0 ? { ok: false, issues } : { ok: true, pack };
}

export function formatIssue(stage: string, issue: ContentIssue): string {
  const where = issue.path ? `${issue.file} › ${issue.path}` : issue.file;
  return `[${stage}] ${where}: ${issue.message}`;
}
