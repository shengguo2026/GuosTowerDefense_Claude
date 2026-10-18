import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMatchSetup, loadStagePack, type ContentIssue } from './index';
import { loadAllStages, loadStageDirectory } from './node';

const STAGES = resolve(import.meta.dirname, '../../../content/stages');
const TEST_STAGE = join(STAGES, 'test-stage');

/** Loads the test stage with one file changed in memory. */
async function loadWithChange(file: string, change: (json: Record<string, unknown>) => void) {
  return loadStagePack({
    async readJson(name) {
      const json = JSON.parse(await readFile(join(TEST_STAGE, name), 'utf8'));
      if (name === file) change(json);
      return json;
    },
  });
}

function messages(result: { ok: boolean; issues?: ContentIssue[] }): string[] {
  return result.ok
    ? []
    : (result.issues ?? []).map((issue) => `${issue.file} ${issue.path}: ${issue.message}`);
}

describe('stage pack loader', () => {
  it('loads every stage pack in the repository without problems', async () => {
    const report = await loadAllStages(STAGES);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.stages.map((stage) => stage.manifest.id)).toContain('test-stage');
  });

  it('loads the test stage with its own level and profile counts', async () => {
    const result = await loadStageDirectory(TEST_STAGE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pack.levels).toHaveLength(2);
    expect(result.pack.profiles.filter((p) => p.side === 'attacker')).toHaveLength(2);
    expect(result.pack.profiles.filter((p) => p.side === 'defender')).toHaveLength(2);
  });

  it('reports a route that skips an edge', async () => {
    const result = await loadWithChange('levels/meadow.json', (level) => {
      (level.routes as { nodes: string[] }[])[0]!.nodes = ['gate', 'hill', 'beacon'];
    });
    expect(messages(result)).toContainEqual(expect.stringContaining('no edge connects "gate" and "hill"'));
  });

  it('reports a route that does not end at the objective', async () => {
    const result = await loadWithChange('levels/meadow.json', (level) => {
      (level.routes as { nodes: string[] }[])[0]!.nodes = ['gate', 'fork', 'hill'];
    });
    expect(messages(result)).toContainEqual(expect.stringContaining('must end at the objective'));
  });

  it('reports unknown references and too many ability slots', async () => {
    const result = await loadWithChange('profiles/courier.json', (profile) => {
      profile.units = ['runner', 'teleporter'];
      profile.abilities = ['tailwind', 'tailwind', 'tailwind', 'tailwind', 'tailwind', 'tailwind'];
    });
    expect(messages(result).join('\n')).toMatch(/abilities/);
  });

  it('reports texts missing in one language', async () => {
    const result = await loadWithChange('texts/de.json', (texts) => {
      delete texts['unit.runner'];
    });
    expect(messages(result)).toContainEqual(
      expect.stringContaining('texts/de.json unit.runner: missing text'),
    );
  });

  it('reports schema errors with the file and field', async () => {
    const result = await loadWithChange('levels/canyon.json', (level) => {
      level.timerSeconds = -5;
    });
    expect(messages(result)).toContainEqual(expect.stringMatching(/^levels\/canyon\.json timerSeconds:/));
  });

  it('builds a simulation setup from a profile choice', async () => {
    const result = await loadStageDirectory(TEST_STAGE);
    if (!result.ok) throw new Error('test stage should load');
    const setup = createMatchSetup(result.pack, {
      levelId: 'canyon',
      attackerProfileId: 'sprinter',
      defenderProfileId: 'lookout',
      seed: 5,
    });
    expect(setup.level.routes).toHaveLength(3);
    expect(setup.attacker.units.map((u) => u.id)).toEqual(['runner', 'glider']);
    expect(setup.defender.defenses.map((d) => d.id)).toEqual(['gate-post', 'watch-light']);
    expect(() => createMatchSetup(result.pack, { ...setupChoice(), attackerProfileId: 'lookout' })).toThrow();
  });
});

function setupChoice() {
  return { levelId: 'meadow', attackerProfileId: 'courier', defenderProfileId: 'gatekeeper', seed: 1 };
}

describe('loading several stage packs', () => {
  let root: string | undefined;
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('skips a broken optional pack with a warning and flags a broken core pack as an error', async () => {
    root = await mkdtemp(join(tmpdir(), 'gtd-stages-'));
    await cp(TEST_STAGE, join(root, 'good'), { recursive: true });
    await cp(TEST_STAGE, join(root, 'broken-optional'), { recursive: true });
    await writeFile(join(root, 'broken-optional', 'catalog.json'), '{ not json');
    await cp(TEST_STAGE, join(root, 'broken-core'), { recursive: true });
    const manifestPath = join(root, 'broken-core', 'stage.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    await writeFile(manifestPath, JSON.stringify({ ...manifest, core: true, levels: ['missing-level'] }));

    const report = await loadAllStages(root);
    expect(report.stages).toHaveLength(1);
    expect(report.warnings.join('\n')).toContain('[broken-optional] catalog.json');
    expect(report.errors.join('\n')).toContain('[broken-core] levels/missing-level.json');
  });
});
