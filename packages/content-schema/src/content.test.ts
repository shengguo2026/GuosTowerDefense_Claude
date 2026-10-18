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

  it('loads the Big Five stage with the Lion level, its two routes and its scene', async () => {
    const result = await loadStageDirectory(join(STAGES, 'stage-01-big-five'));
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.pack.manifest.core).toBe(true);
    const lion = result.pack.levels.find((level) => level.id === 'lion');
    expect(lion?.routes.map((route) => route.id)).toEqual(['ridge', 'riverbed']);
    expect(lion?.objective.nodeId).toBe('lion-waterhole');
    expect(lion?.scene?.landmarks.map((l) => l.kind)).toEqual(
      expect.arrayContaining(['acaciaGrove', 'rockyRidge', 'riverCrossing', 'waterhole']),
    );
  });

  it('reports a scene that names an unknown streambed route or label', async () => {
    const result = await loadStagePack({
      async readJson(name) {
        const json = JSON.parse(await readFile(join(STAGES, 'stage-01-big-five', name), 'utf8'));
        if (name === 'levels/lion.json') {
          json.scene.streambedRoute = 'canyon';
          json.scene.landmarks[0].label = 'landmark.nowhere';
        }
        return json;
      },
    });
    const found = messages(result).join('\n');
    expect(found).toMatch(/canyon/);
    expect(found).toMatch(/landmark\.nowhere/);
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

  it('fills in match rules the level leaves out with defaults', async () => {
    const result = await loadStageDirectory(TEST_STAGE);
    if (!result.ok) throw new Error('test stage should load');
    const { level, attacker } = createMatchSetup(result.pack, setupChoice());
    expect(level).toMatchObject({ preparationSeconds: 30, deploymentCapacity: 40, maxActiveWaves: 2 });
    expect(level.objective.radius).toBe(4.5);
    expect(attacker.units[0]).toMatchObject({ capacity: 1, visibility: 'normal' });
  });

  it('builds the Explorer vs Ranger setup for Lion with abilities, passives and the patrol', async () => {
    const result = await loadStageDirectory(join(STAGES, 'stage-01-big-five'));
    if (!result.ok) throw new Error('Stage 1 should load');
    const setup = createMatchSetup(result.pack, {
      levelId: 'lion',
      attackerProfileId: 'explorer',
      defenderProfileId: 'ranger',
      seed: 1,
    });
    expect(setup.attacker.abilities.map((a) => a.id)).toEqual(['reconnaissance', 'rapid-reroute']);
    expect(setup.defender.abilities.map((a) => a.id)).toEqual(['rapid-response', 'intercept']);
    expect(setup.attacker.passive).toEqual([
      { type: 'boost', stat: 'speed', magnitude: 0.1, condition: 'knownRoute' },
    ]);
    expect(setup.defender.passive).toEqual([{ type: 'boost', stat: 'detectionRange', magnitude: 0.1 }]);
    const patrol = setup.defender.defenses.find((d) => d.id === 'ranger-patrol');
    expect(patrol).toMatchObject({ mobile: true, placement: 'routeNode', maxCount: 2 });
    expect(setup.defender.defenses.find((d) => d.id === 'temporary-checkpoint')?.blocksNode).toBe(true);
    const terrain = new Map(setup.level.edges.map((e) => [`${e.from}>${e.to}`, e.terrain]));
    expect(terrain.get('acacia-junction>rocky-ridge')).toBe('open');
    expect(terrain.get('acacia-junction>dry-river-crossing')).toBe('cover');
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
