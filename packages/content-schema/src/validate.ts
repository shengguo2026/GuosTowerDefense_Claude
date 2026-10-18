import type { ContentIssue } from './loader';
import { LANGUAGES, type StagePack } from './schema';

/** Checks that need more than one file: references between levels, profiles, catalog and texts. */
export function crossCheck(pack: StagePack): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const add = (file: string, path: string, message: string) => issues.push({ file, path, message });
  const { manifest, catalog } = pack;
  const usedTextKeys = new Map<string, string>();
  const useText = (key: string, file: string) => {
    if (!usedTextKeys.has(key)) usedTextKeys.set(key, file);
  };

  useText(manifest.title, 'stage.json');
  findDuplicates(manifest.levels).forEach((dup) =>
    add('stage.json', 'levels', `level "${dup}" is listed twice`),
  );
  findDuplicates([...manifest.profiles.attacker, ...manifest.profiles.defender]).forEach((dup) =>
    add('stage.json', 'profiles', `profile "${dup}" is listed twice`),
  );

  // Levels
  pack.levels.forEach((level, index) => {
    const file = `levels/${manifest.levels[index]}.json`;
    useText(level.title, file);
    if (level.id !== manifest.levels[index]) add(file, 'id', `id "${level.id}" does not match the file name`);
    if (level.unlockedBy !== null) {
      const unlockIndex = manifest.levels.indexOf(level.unlockedBy);
      if (unlockIndex < 0) add(file, 'unlockedBy', `unknown level "${level.unlockedBy}"`);
      else if (unlockIndex >= index)
        add(file, 'unlockedBy', `"${level.unlockedBy}" must come earlier in the level order`);
    }

    const nodeIds = new Set(level.map.nodes.map((node) => node.id));
    findDuplicates(level.map.nodes.map((node) => node.id)).forEach((dup) =>
      add(file, 'map.nodes', `node "${dup}" is defined twice`),
    );
    const links = new Set<string>();
    level.map.edges.forEach((edge, i) => {
      for (const end of [edge.from, edge.to] as const) {
        if (!nodeIds.has(end)) add(file, `map.edges.${i}`, `unknown node "${end}"`);
      }
      links.add(`${edge.from}>${edge.to}`).add(`${edge.to}>${edge.from}`);
    });
    if (!nodeIds.has(level.objective.nodeId))
      add(file, 'objective.nodeId', `unknown node "${level.objective.nodeId}"`);

    findDuplicates(level.routes.map((route) => route.id)).forEach((dup) =>
      add(file, 'routes', `route "${dup}" is defined twice`),
    );
    level.routes.forEach((route, r) => {
      route.nodes.forEach((node, n) => {
        if (!nodeIds.has(node)) add(file, `routes.${r}.nodes.${n}`, `unknown node "${node}"`);
        const next = route.nodes[n + 1];
        if (next !== undefined && !links.has(`${node}>${next}`)) {
          add(file, `routes.${r}.nodes.${n}`, `no edge connects "${node}" and "${next}"`);
        }
      });
      if (route.name) useText(route.name, file);
      if (route.nodes.at(-1) !== level.objective.nodeId) {
        add(file, `routes.${r}`, `route "${route.id}" must end at the objective "${level.objective.nodeId}"`);
      }
    });
    if (level.scene) {
      const { scene } = level;
      if (scene.streambedRoute && !level.routes.some((route) => route.id === scene.streambedRoute)) {
        add(file, 'scene.streambedRoute', `unknown route "${scene.streambedRoute}"`);
      }
      findDuplicates(scene.landmarks.map((landmark) => landmark.id)).forEach((dup) =>
        add(file, 'scene.landmarks', `landmark "${dup}" is defined twice`),
      );
      scene.landmarks.forEach((landmark) => landmark.label && useText(landmark.label, file));
    }
  });

  // Catalog
  for (const [kind, entries] of Object.entries(catalog) as [string, { id: string; name: string }[]][]) {
    findDuplicates(entries.map((entry) => entry.id)).forEach((dup) =>
      add('catalog.json', kind, `"${dup}" is defined twice`),
    );
    entries.forEach((entry) => useText(entry.name, 'catalog.json'));
  }
  const spawnable = new Set([...catalog.units, ...catalog.defenses].map((entry) => entry.id));
  [...catalog.abilities, ...catalog.commands].forEach((action) => {
    useText(action.description, 'catalog.json');
    action.effects.forEach((effect, i) => {
      if (effect.type === 'spawn' && (!effect.spawn || !spawnable.has(effect.spawn))) {
        add('catalog.json', `${action.id}.effects.${i}`, `spawn effect needs a known unit or defense id`);
      }
    });
  });

  // Profiles
  const ids = (entries: { id: string }[]) => new Set(entries.map((entry) => entry.id));
  const known = {
    units: ids(catalog.units),
    defenses: ids(catalog.defenses),
    abilities: ids(catalog.abilities),
    commands: ids(catalog.commands),
  };
  const allProfileIds = [...manifest.profiles.attacker, ...manifest.profiles.defender];
  pack.profiles.forEach((profile, index) => {
    const file = `profiles/${allProfileIds[index]}.json`;
    if (profile.id !== allProfileIds[index])
      add(file, 'id', `id "${profile.id}" does not match the file name`);
    const listedSide = manifest.profiles.attacker.includes(profile.id) ? 'attacker' : 'defender';
    if (profile.side !== listedSide)
      add(file, 'side', `listed as ${listedSide} in stage.json but says ${profile.side}`);
    for (const key of [profile.name, profile.description, profile.resource.name, profile.passive.name]) {
      useText(key, file);
    }
    useText(profile.passive.description, file);
    if (profile.side === 'attacker' && profile.units.length === 0)
      add(file, 'units', 'an Attacker profile needs units');
    if (profile.side === 'defender' && profile.defenses.length === 0) {
      add(file, 'defenses', 'a Defender profile needs defenses');
    }
    for (const list of ['units', 'defenses', 'abilities', 'commands'] as const) {
      profile[list].forEach((ref, i) => {
        if (!known[list].has(ref)) add(file, `${list}.${i}`, `unknown ${list.slice(0, -1)} "${ref}"`);
      });
    }
  });

  // Texts: every player-facing text exists in every language (spec §1).
  for (const [key, file] of usedTextKeys) {
    for (const language of LANGUAGES) {
      if (!pack.texts[language][key]?.trim())
        add(`texts/${language}.json`, key, `missing text (used in ${file})`);
    }
  }
  return issues;
}

function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) (seen.has(value) ? duplicates : seen).add(value);
  return [...duplicates];
}
