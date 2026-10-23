import { RouteGraph, VisionField, type Point, type VisionArea } from '@gtd/sim';
import type { ContentIssue } from './loader';
import { toVisionArea } from './setup';
import {
  ATTACKER_ORDERS,
  DEFENDER_ORDERS,
  LANGUAGES,
  RANK_CHANGES,
  type Action,
  type Level,
  type StagePack,
} from './schema';

type Side = 'attacker' | 'defender';

/** Effects that do something for a side (see EffectSchema: who an effect works on follows from the side). */
const EFFECTS_FOR: Record<Side, ReadonlySet<string>> = {
  attacker: new Set([
    'slow',
    'reveal',
    'conceal',
    'protect',
    'disrupt',
    'boost',
    'move',
    'spawn',
    'resource',
    'dismantle',
  ]),
  defender: new Set([
    'slow',
    'reveal',
    'conceal',
    'protect',
    'disrupt',
    'boost',
    'spawn',
    'blockBranch',
    'resource',
  ]),
};

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
  if (manifest.description) useText(manifest.description, 'stage.json');
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
    if (level.description) useText(level.description, file);
    if (level.briefing) {
      useText(level.briefing.attacker, file);
      useText(level.briefing.defender, file);
    }
    for (const side of ['attacker', 'defender'] as const) {
      level.tutorial?.[side]?.forEach((step, i) => {
        useText(step.text, file);
        const { until } = step;
        if (until.type === 'build' && until.defense && !catalog.defenses.some((d) => d.id === until.defense))
          add(file, `tutorial.${side}.${i}.until.defense`, `unknown defense "${until.defense}"`);
        if (
          until.type === 'ability' &&
          until.ability &&
          !catalog.abilities.some((a) => a.id === until.ability)
        )
          add(file, `tutorial.${side}.${i}.until.ability`, `unknown ability "${until.ability}"`);
      });
    }
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

    // Concealment Zones: a rock wall may stand beside a route but never across it, and nothing is built inside one.
    findDuplicates(level.vision.map((area) => area.id)).forEach((dup) =>
      add(file, 'vision', `area "${dup}" is defined twice`),
    );
    const routeMapOk = level.routes.every((route) =>
      route.nodes.every((node, n) => n === 0 || links.has(`${route.nodes[n - 1]}>${node}`)),
    );
    const paths = routeMapOk && nodeIds.has(level.objective.nodeId) ? routePaths(level) : [];
    level.vision.forEach((area, i) => {
      if (area.label) useText(area.label, file);
      if (area.los !== 'blocker') return;
      const blocker = new VisionField([toVisionArea(area)]);
      for (const { id, points } of paths) {
        const crossed = points.some((p, k) => k > 0 && blocker.blocked(points[k - 1] as Point, p));
        if (crossed) add(file, `vision.${i}`, `blocker "${area.id}" stands across route "${id}"`);
      }
      for (const node of level.map.nodes)
        if (blocker.contains(blocker.areas[0] as VisionArea, node))
          add(file, `vision.${i}`, `node "${node.id}" lies inside the blocker "${area.id}"`);
    });
    level.hints.forEach((hint, i) => {
      useText(hint.text, file);
      if (hint.when === 'area' && !level.vision.some((area) => area.kind === hint.area))
        add(file, `hints.${i}.area`, `no vision area of kind "${hint.area ?? ''}" on this level`);
    });
    findDuplicates(level.hints.map((hint) => hint.id)).forEach((dup) =>
      add(file, 'hints', `hint "${dup}" is defined twice`),
    );
  });

  // Catalog
  for (const [kind, entries] of Object.entries(catalog) as [string, { id: string; name: string }[]][]) {
    findDuplicates(entries.map((entry) => entry.id)).forEach((dup) =>
      add('catalog.json', kind, `"${dup}" is defined twice`),
    );
    entries.forEach((entry) => useText(entry.name, 'catalog.json'));
  }
  [...catalog.units, ...catalog.defenses].forEach(
    (entry) => entry.description && useText(entry.description, 'catalog.json'),
  );
  const spawnable = new Set([...catalog.units, ...catalog.defenses].map((entry) => entry.id));
  [...catalog.abilities, ...catalog.commands].forEach((action) => {
    useText(action.description, 'catalog.json');
    action.effects.forEach((effect, i) => {
      if (effect.type === 'spawn' && (!effect.spawn || !spawnable.has(effect.spawn))) {
        add('catalog.json', `${action.id}.effects.${i}`, `spawn effect needs a known unit or defense id`);
      }
    });
  });
  // Abilities and commands share one cooldown list per side, so their ids must not collide.
  findDuplicates([...catalog.abilities, ...catalog.commands].map((action) => action.id)).forEach((dup) =>
    add('catalog.json', 'commands', `"${dup}" is both an ability and a command`),
  );
  catalog.abilities.forEach((ability) => {
    if (ability.order)
      add('catalog.json', `abilities.${ability.id}.order`, 'only command slots can stand for an order');
  });
  catalog.commands.forEach((command) => {
    if (!command.order && !['unit', 'area', 'self'].includes(command.target))
      add(
        'catalog.json',
        `commands.${command.id}.target`,
        'a command works on its group or asset: unit, area or self',
      );
  });
  const checkAction = (file: string, path: string, action: Action, side: Side) => {
    action.effects.forEach((effect, i) => {
      if (!EFFECTS_FOR[side].has(effect.type))
        add(file, `${path}.effects.${i}`, `"${effect.type}" does nothing for the ${side} ("${action.id}")`);
      if (effect.type === 'spawn' && effect.spawn) {
        const list: { id: string }[] = side === 'attacker' ? catalog.units : catalog.defenses;
        if (!list.some((entry) => entry.id === effect.spawn))
          add(file, `${path}.effects.${i}`, `the ${side} cannot spawn "${effect.spawn}"`);
      }
    });
    if (action.order) {
      const orders: readonly string[] = side === 'attacker' ? ATTACKER_ORDERS : DEFENDER_ORDERS;
      if (!orders.includes(action.order))
        add(file, `${path}.order`, `"${action.order}" is not an order of the ${side}`);
    }
  };

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
    if (profile.points) useText(profile.points.name, file);
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
    findDuplicates(profile.commands).forEach((dup) =>
      add(file, 'commands', `command "${dup}" is listed twice`),
    );
    profile.abilities.forEach((ref, i) => {
      const ability = catalog.abilities.find((a) => a.id === ref);
      if (ability) checkAction(file, `abilities.${i}`, ability, profile.side);
    });
    profile.commands.forEach((ref, i) => {
      const command = catalog.commands.find((c) => c.id === ref);
      if (command) checkAction(file, `commands.${i}`, command, profile.side);
    });
    findDuplicates(profile.ranks.map((rank) => String(rank.level))).forEach((dup) =>
      add(file, 'ranks', `level ${dup} has two ranks`),
    );
    profile.ranks.forEach((rank, i) => {
      useText(rank.name, file);
      useText(rank.description, file);
      const kind = rank.ability ? 'ability' : rank.unit ? 'unit' : 'defense';
      const target = (rank.ability ?? rank.unit ?? rank.defense) as string;
      const own: string[] =
        kind === 'ability' ? profile.abilities : kind === 'unit' ? profile.units : profile.defenses;
      if (!own.includes(target)) add(file, `ranks.${i}.${kind}`, `the profile has no ${kind} "${target}"`);
      const allowed: readonly string[] = RANK_CHANGES[kind];
      const changes = Object.keys(rank.changes);
      if (changes.length === 0) add(file, `ranks.${i}.changes`, 'a rank needs at least one change');
      for (const change of changes)
        if (!allowed.includes(change))
          add(file, `ranks.${i}.changes.${change}`, `a ${kind} rank can change ${allowed.join(', ')}`);
    });
    profile.passive.effects.forEach((effect, i) => {
      const passives = profile.side === 'attacker' ? ['boost', 'conceal'] : ['boost', 'protect', 'reveal'];
      if (!passives.includes(effect.type))
        add(file, `passive.effects.${i}`, `a ${profile.side} passive can be ${passives.join(', ')}`);
    });
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

/** Every route as the walkable line of points the simulation moves groups along. */
function routePaths(level: Level): { id: string; points: Point[] }[] {
  const graph = new RouteGraph({ nodes: level.map.nodes, edges: level.map.edges, routes: level.routes });
  return level.routes.map((route) => ({
    id: route.id,
    points: graph.routeLegs(route.id).flatMap((leg, i) => (i === 0 ? leg.points : leg.points.slice(1))),
  }));
}
