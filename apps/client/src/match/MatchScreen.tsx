import type { AiThought } from '@gtd/ai';
import type { Action, StagePack } from '@gtd/content-schema';
import { createTranslator, type Translate } from '@gtd/i18n';
import type { ComputerPlayer, MatchCommand, MatchSpeed } from '@gtd/protocol';
import {
  TARGET_PRIORITIES,
  type DefenseEntity,
  type GroupEntity,
  type MatchSnapshot,
  type WaveGroupOrder,
} from '@gtd/sim';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { sounds, type SoundCue } from '../audio/sound';
import { AbilityBar } from '../hud/AbilityBar';
import { FORMATIONS, GroupList, GroupOrders, MAX_DRAFT_GROUPS, WaveBuilder } from '../hud/AttackerPanels';
import { AssetList, AssetOrders, BuildBar } from '../hud/DefenderPanels';
import {
  abilityAim,
  abilityNeedsGroup,
  freeBuildSites,
  patrolNodes,
  type MapMode,
  type Selection,
} from '../hud/hudState';
import { Minimap } from '../hud/Minimap';
import { HintToast, PauseMenu, TutorialPanel } from '../hud/Overlays';
import { TopBar } from '../hud/TopBar';
import { useLayout } from '../hud/useLayout';
import { actionForKey } from '../input/bindings';
import { AiReasoning } from '../level/AiReasoning';
import { ResultScreen } from '../level/ResultScreen';
import type { ServerConnection } from '../useServerConnection';
import type { SettingsState } from '../useSettings';
import type { MapOverlay } from '../world/selectionView';
import { LevelView, type MapPick } from '../world/levelView';
import { currentDevice, resolvePreset } from '../world/presets';
import type { MatchConfig } from './matchConfig';
import { nextStep, noActions, type PlayerActions } from './tutorial';

const KEPT_THOUGHTS = 40;
/** How often the HUD redraws from snapshots; the 3D view uses every snapshot. */
const HUD_INTERVAL_MS = 250;

interface Props {
  config: MatchConfig;
  pack: StagePack;
  connection: ServerConnection;
  settings: SettingsState;
  /** Opens the settings or the manual over the match. */
  overlayOpen: boolean;
  onQuit(): void;
  onManual(): void;
  onSettings(): void;
}

/** First-time hints (spec §6.3): shown once each, outside tutorials, one at a time. */
type HintId =
  | 'startAttacker'
  | 'startDefender'
  | 'combat'
  | 'spottedAttacker'
  | 'spottedDefender'
  | 'objectiveAttacker'
  | 'objectiveDefender'
  | 'blocked'
  | 'disrupted'
  | 'abilityReady';

/**
 * A single-player match with the real HUD (spec §15): the map takes clicks and taps for building, aiming and
 * choosing routes; panels follow the screen size; keyboard shortcuts, pause and 2× speed work against the computer.
 */
export function MatchScreen({
  config,
  pack,
  connection,
  settings,
  overlayOpen,
  onQuit,
  onManual,
  onSettings,
}: Props) {
  const { t, bindings, update } = settings;
  const { accessibility, onboarding, graphics } = settings.settings;
  const side = config.side;
  const level = pack.levels.find((l) => l.id === config.levelId);
  const stageText: Translate = useMemo(
    () => createTranslator(settings.language, pack.texts),
    [settings.language, pack],
  );
  const profile = pack.profiles.find(
    (p) => p.id === (side === 'attacker' ? config.attackerProfileId : config.defenderProfileId),
  );
  const units = useMemo(
    () => pack.catalog.units.filter((u) => profile?.units.includes(u.id)),
    [pack, profile],
  );
  const defenseTypes = useMemo(
    () => pack.catalog.defenses.filter((d) => profile?.defenses.includes(d.id)),
    [pack, profile],
  );
  const abilities = useMemo(
    () => pack.catalog.abilities.filter((a) => profile?.abilities.includes(a.id)),
    [pack, profile],
  );
  const layout = useLayout();
  const compact = layout === 'phone';

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<LevelView | null>(null);
  const [snapshot, setSnapshot] = useState<MatchSnapshot | null>(null);
  const [joined, setJoined] = useState(false);
  const [computer, setComputer] = useState<ComputerPlayer | null>(null);
  const [thoughts, setThoughts] = useState<AiThought[]>([]);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<MatchSpeed>(1);
  const [canControlClock, setCanControlClock] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [mode, setMode] = useState<MapMode>(null);
  const [buildChoice, setBuildChoice] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<WaveGroupOrder[]>(() => [
    {
      unitTypeId: units[0]?.id ?? '',
      count: 6,
      formation: 'column',
      routeId: level?.routes[0]?.id ?? '',
      delaySeconds: 0,
    },
  ]);
  const [currentDraft, setCurrentDraft] = useState(0);
  const [hoverRoute, setHoverRoute] = useState<string | null>(null);
  const [hints, setHints] = useState<HintId[]>([]);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [tutorialSkipped, setTutorialSkipped] = useState(false);
  const actionsRef = useRef<PlayerActions>(noActions());
  const [actionsVersion, setActionsVersion] = useState(0);

  const preset = useMemo(() => resolvePreset(graphics, currentDevice()), [graphics]);
  const { send, subscribe, status } = connection;

  // ── 3D view ──────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const labelLayer = labelsRef.current;
    if (!canvas || !labelLayer || !level) return;
    const view = new LevelView({
      canvas,
      labelLayer,
      pack,
      level,
      preset,
      stageText,
      reducedMotion:
        accessibility.reducedEffects || window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      highContrastRoutes: accessibility.highContrastRoutes,
    });
    viewRef.current = view;
    view.onPointer({
      tap: (pick, button) => tapRef.current(pick, button),
      hover: (pick) => hoverRef.current(pick),
    });
    return () => {
      viewRef.current = null;
      view.dispose();
    };
  }, [pack, level, preset, stageText, accessibility.reducedEffects, accessibility.highContrastRoutes]);

  // ── Match messages ───────────────────────────────────────────────────
  const startMatch = useCallback(() => {
    send({
      type: 'createMatch',
      stageId: config.stageId,
      levelId: config.levelId,
      seat: config.side,
      attackerProfileId: config.attackerProfileId,
      defenderProfileId: config.defenderProfileId,
      opponent: config.difficulty,
      showAiReasoning: config.showAiReasoning,
      tutorial: config.tutorial,
    });
  }, [send, config]);

  useEffect(() => {
    let lastHud = 0;
    return subscribe((message) => {
      switch (message.type) {
        case 'matchStarted':
          viewRef.current?.buffer.clear();
          setComputer(message.computer ?? null);
          setThoughts([]);
          setSnapshot(null);
          setSelection(null);
          setMode(null);
          setTutorialStep(0);
          setTutorialSkipped(false);
          actionsRef.current = noActions();
          return;
        case 'joined':
          return setJoined(true);
        case 'clock':
          setPaused(message.paused);
          setSpeed(message.speed);
          setCanControlClock(message.canControl);
          return;
        case 'aiThought':
          return setThoughts((kept) => [...kept, message.thought].slice(-KEPT_THOUGHTS));
        case 'commandRejected':
          sounds.play('rejected');
          return setNotice(t('ctl.rejected', { reason: t(`reject.${message.reason}`) }));
        case 'snapshot': {
          viewRef.current?.pushSnapshot(message.snapshot);
          const now = performance.now();
          if (now - lastHud > HUD_INTERVAL_MS || message.snapshot.phase === 'ended') {
            lastHud = now;
            setSnapshot(message.snapshot);
          }
          return;
        }
        default:
          return;
      }
    });
  }, [subscribe, t]);

  useEffect(() => {
    if (status !== 'connected') return;
    startMatch();
    return () => {
      send({ type: 'leaveMatch' });
      setJoined(false);
    };
  }, [status, startMatch, send]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // ── Derived state ────────────────────────────────────────────────────
  const groups = useMemo(
    () => (snapshot?.entities ?? []).filter((e): e is GroupEntity => e.kind === 'group'),
    [snapshot],
  );
  const defenses = useMemo(
    () => (snapshot?.entities ?? []).filter((e): e is DefenseEntity => e.kind === 'defense'),
    [snapshot],
  );
  const ownGroups = side === 'attacker' ? groups : [];
  const ownAssets = side === 'defender' ? defenses : [];
  const selectedGroup =
    selection?.kind === 'group' ? (groups.find((g) => g.id === selection.id) ?? null) : null;
  const selectedAsset =
    selection?.kind === 'defense' && side === 'defender'
      ? (defenses.find((d) => d.id === selection.id) ?? null)
      : null;
  const selectedId = selectedGroup?.id ?? selectedAsset?.id ?? null;
  const ended = Boolean(snapshot?.result);

  // ── Sending commands ─────────────────────────────────────────────────
  const record = useCallback((change: (actions: PlayerActions) => void) => {
    change(actionsRef.current);
    setActionsVersion((v) => v + 1);
  }, []);

  const command = useCallback(
    (cmd: MatchCommand, cue?: SoundCue) => {
      send({ type: 'command', command: cmd });
      if (cue) sounds.play(cue);
      const orders: Partial<Record<MatchCommand['type'], string>> = {
        holdGroup: 'hold',
        advanceGroup: 'advance',
        rerouteGroup: 'reroute',
        retreatGroup: 'retreat',
        setFormation: 'formation',
        setPriority: 'priority',
      };
      const order = cmd.type === 'orderDefense' ? cmd.order.type : (orders[cmd.type] as string | undefined);
      if (order) record((a) => a.orders.add(order));
      if (cmd.type === 'upgradeDefense') record((a) => (a.upgraded = true));
    },
    [send, record],
  );

  const select = useCallback(
    (next: Selection) => {
      setSelection(next);
      setMode(null);
      if (next) {
        sounds.play('select');
        record((a) => a.selected.add(next.kind));
        if (layout !== 'desktop') setDrawerOpen(true);
      }
    },
    [record, layout],
  );

  const triggerAbility = useCallback(
    (ability: Action) => {
      if (!snapshot) return;
      const cooldown = snapshot.cooldowns[ability.id] ?? 0;
      if (cooldown > 0) return setNotice(t('ctl.rejected', { reason: t('reject.cooldown') }));
      if ((snapshot.points[side] ?? 0) < ability.cost)
        return setNotice(t('ctl.rejected', { reason: t('reject.notEnoughPoints') }));
      if (mode?.type === 'ability' && mode.abilityId === ability.id) return setMode(null);
      const aim = abilityAim(ability);
      const base = { type: 'useAbility' as const, side, abilityId: ability.id };
      if (aim === 'now') return command(base, 'ability');
      if (abilityNeedsGroup(ability) && aim === 'route') {
        if (!selectedGroup) return setNotice(t('hud.pickGroupFirst'));
        return setMode({ type: 'ability', abilityId: ability.id, groupId: selectedGroup.id });
      }
      if (aim === 'group' && selectedGroup) return command({ ...base, groupId: selectedGroup.id }, 'ability');
      setMode({ type: 'ability', abilityId: ability.id });
      setNotice(t(`hud.aim.${aim}`));
    },
    [snapshot, side, mode, selectedGroup, command, t],
  );

  const chooseBuild = useCallback(
    (typeId: string) => {
      if (buildChoice === typeId && mode?.type === 'build') {
        setBuildChoice(null);
        setMode(null);
        return;
      }
      setBuildChoice(typeId);
      setSelection(null);
      setMode({ type: 'build', defenseTypeId: typeId });
      if (layout !== 'desktop') setDrawerOpen(false);
    },
    [buildChoice, mode, layout],
  );

  const updateDraft = useCallback(
    (index: number, patch: Partial<WaveGroupOrder>) =>
      setDrafts((list) => list.map((d, i) => (i === index ? { ...d, ...patch } : d))),
    [],
  );
  const addDraft = useCallback(() => {
    setDrafts((list) => {
      if (list.length >= MAX_DRAFT_GROUPS) return list;
      const next = [...list, { ...(list[list.length - 1] as WaveGroupOrder) }];
      setCurrentDraft(next.length - 1);
      return next;
    });
  }, []);
  const removeDraft = useCallback((index: number) => {
    setDrafts((list) => (list.length > 1 ? list.filter((_, i) => i !== index) : list));
    setCurrentDraft(0);
  }, []);
  const launch = useCallback(
    () => command({ type: 'launchWave', side: 'attacker', groups: drafts }, 'launch'),
    [command, drafts],
  );

  // ── Map clicks and taps ──────────────────────────────────────────────
  const nodeById = useCallback((id: string) => level?.map.nodes.find((n) => n.id === id), [level]);
  const tap = (pick: MapPick, button: number) => {
    if (!level || !snapshot || ended) return;
    if (button === 2) {
      if (mode) setMode(null);
      else setSelection(null);
      return;
    }
    const entity = pick.entityId === null ? undefined : snapshot.entities.find((e) => e.id === pick.entityId);
    switch (mode?.type) {
      case 'build': {
        const type = defenseTypes.find((d) => d.id === mode.defenseTypeId);
        const free = freeBuildSites(level, type, defenses);
        if (pick.nodeId && free.some((n) => n.id === pick.nodeId)) {
          command(
            {
              type: 'placeDefense',
              side: 'defender',
              defenseTypeId: mode.defenseTypeId,
              nodeId: pick.nodeId,
            },
            'build',
          );
          setMode(null);
          setBuildChoice(null);
        } else setNotice(t('hud.notHere'));
        return;
      }
      case 'ability': {
        const ability = abilities.find((a) => a.id === mode.abilityId);
        if (!ability) return setMode(null);
        const base = { type: 'useAbility' as const, side, abilityId: ability.id };
        const aim = abilityAim(ability);
        if (aim === 'ground' && pick.ground)
          command({ ...base, x: pick.ground.x, z: pick.ground.z }, 'ability');
        else if (aim === 'node' && pick.nodeId) {
          const node = nodeById(pick.nodeId);
          if (node) command({ ...base, x: node.x, z: node.z }, 'ability');
        } else if (aim === 'route' && pick.routeId)
          command(
            { ...base, routeId: pick.routeId, ...(mode.groupId ? { groupId: mode.groupId } : {}) },
            'ability',
          );
        else if (aim === 'group' && entity?.kind === 'group')
          command({ ...base, groupId: entity.id }, 'ability');
        else return setNotice(t(`hud.aim.${aim}`));
        setMode(null);
        return;
      }
      case 'reroute':
        if (pick.routeId) {
          command(
            { type: 'rerouteGroup', side: 'attacker', groupId: mode.groupId, routeId: pick.routeId },
            'select',
          );
          setMode(null);
        } else setNotice(t('hud.aim.route'));
        return;
      case 'focus':
        if (entity?.kind === 'group') {
          command(
            { type: 'focusTarget', side: 'defender', defenseId: mode.defenseId, groupId: entity.id },
            'select',
          );
          setMode(null);
        } else setNotice(t('hud.aim.group'));
        return;
      case 'guard':
      case 'patrol': {
        const asset = defenses.find((d) => d.id === mode.defenseId);
        if (asset && pick.nodeId && patrolNodes(level).includes(pick.nodeId)) {
          command(
            {
              type: 'orderDefense',
              side: 'defender',
              defenseId: asset.id,
              order:
                mode.type === 'guard'
                  ? { type: 'guard', nodeId: pick.nodeId }
                  : { type: 'patrol', nodeIds: [asset.nodeId, pick.nodeId] },
            },
            'select',
          );
          setMode(null);
        } else setNotice(t('hud.aim.node'));
        return;
      }
      default:
        break;
    }
    if (entity?.kind === 'group' && side === 'attacker') return select({ kind: 'group', id: entity.id });
    if (entity?.kind === 'defense' && side === 'defender') return select({ kind: 'defense', id: entity.id });
    if (side === 'attacker' && pick.routeId && snapshot.phase !== 'ended') {
      updateDraft(currentDraft, { routeId: pick.routeId });
      sounds.play('select');
      return;
    }
    if (side === 'defender' && buildChoice === null && pick.nodeId && defenseTypes[0]) {
      // A tap on a free site without a chosen item does nothing but hint at the build bar.
      setNotice(t('hud.buildChoose'));
    }
    setSelection(null);
  };
  const tapRef = useRef(tap);
  tapRef.current = tap;
  const hoverRef = useRef((pick: MapPick) => setHoverRoute(pick.routeId));
  hoverRef.current = (pick: MapPick) =>
    setHoverRoute(side === 'attacker' || mode?.type === 'ability' ? pick.routeId : null);

  // Marks on the map for the current mode and selection.
  const overlay: MapOverlay = useMemo(() => {
    if (!level) return {};
    const result: MapOverlay = { selectedId };
    if (mode?.type === 'build') {
      const type = defenseTypes.find((d) => d.id === mode.defenseTypeId);
      result.buildSites = freeBuildSites(level, type, defenses).map((n) => ({ id: n.id, x: n.x, z: n.z }));
    } else if (mode?.type === 'guard' || mode?.type === 'patrol') {
      result.buildSites = patrolNodes(level)
        .map((id) => level.map.nodes.find((n) => n.id === id))
        .filter((n) => n !== undefined)
        .map((n) => ({ id: n.id, x: n.x, z: n.z }));
    } else if (mode?.type === 'ability') {
      const ability = abilities.find((a) => a.id === mode.abilityId);
      if (ability && abilityAim(ability) === 'ground') result.areaRadius = ability.range;
      if (ability && abilityAim(ability) === 'node')
        result.buildSites = level.map.nodes
          .filter((n) => n.kind === 'junction')
          .map((n) => ({ id: n.id, x: n.x, z: n.z }));
    }
    if (selectedAsset)
      result.selectedRange = defenseTypes.find((d) => d.id === selectedAsset.defenseTypeId)?.range;
    return result;
  }, [level, mode, selectedId, selectedAsset, defenses, defenseTypes, abilities]);

  useEffect(() => viewRef.current?.setOverlay(overlay), [overlay]);
  const shownRoute =
    hoverRoute ??
    (mode?.type === 'reroute' ? null : side === 'attacker' ? (drafts[currentDraft]?.routeId ?? null) : null);
  useEffect(() => viewRef.current?.highlightRoute(shownRoute), [shownRoute]);

  // ── Clock ────────────────────────────────────────────────────────────
  const togglePause = useCallback(() => {
    if (canControlClock) send({ type: 'setPaused', paused: !paused });
  }, [canControlClock, paused, send]);
  const toggleSpeed = useCallback(() => {
    if (canControlClock) send({ type: 'setSpeed', speed: speed === 1 ? 2 : 1 });
  }, [canControlClock, speed, send]);

  // ── Tutorial ─────────────────────────────────────────────────────────
  const steps = useMemo(
    () => (config.tutorial && !tutorialSkipped ? (level?.tutorial?.[side] ?? []) : []),
    [config.tutorial, tutorialSkipped, level, side],
  );
  const abilityIds = useMemo(() => abilities.map((a) => a.id), [abilities]);
  useEffect(() => {
    if (steps.length === 0) return;
    const next = nextStep(steps, tutorialStep, snapshot, side, actionsRef.current, abilityIds);
    if (next !== tutorialStep) {
      setTutorialStep(next);
      sounds.play('hint');
    }
  }, [steps, tutorialStep, snapshot, side, abilityIds, actionsVersion]);
  const step = steps[tutorialStep];
  const waitsForNext = step?.until.type === 'continue';
  const tutorialDone = config.tutorial && steps.length > 0 && tutorialStep >= steps.length;

  // An explaining step holds the clock so nothing happens while the player reads.
  const holdForTutorial = waitsForNext && canControlClock && !ended;
  useEffect(() => {
    if (!holdForTutorial) return;
    send({ type: 'setPaused', paused: true });
    return () => {
      send({ type: 'setPaused', paused: false });
    };
  }, [holdForTutorial, tutorialStep, send]);

  const finishTutorial = useCallback(() => {
    if (!onboarding.tutorialsDone.includes(side))
      void update({ onboarding: { tutorialsDone: [...onboarding.tutorialsDone, side] } });
  }, [onboarding.tutorialsDone, side, update]);
  useEffect(() => {
    if (tutorialDone) finishTutorial();
  }, [tutorialDone, finishTutorial]);

  // Point at the HUD element the step talks about.
  const highlight = step?.highlight;
  useEffect(() => {
    if (!highlight) return;
    const mark = () =>
      document
        .querySelectorAll(`[data-tutorial="${highlight}"]`)
        .forEach((el) => el.classList.add('tutorial-highlight'));
    mark();
    const timer = window.setInterval(mark, 400);
    return () => {
      window.clearInterval(timer);
      document
        .querySelectorAll('.tutorial-highlight')
        .forEach((el) => el.classList.remove('tutorial-highlight'));
    };
  }, [highlight]);

  // ── First-time hints and sounds from what happens in the match ──────
  const previous = useRef<MatchSnapshot | null>(null);
  useEffect(() => {
    if (!snapshot) return;
    const before = previous.current;
    previous.current = snapshot;
    const spotted = (s: MatchSnapshot) =>
      side === 'defender'
        ? s.entities.filter((e) => e.kind === 'group' && e.detection !== 'unknown').length
        : s.entities.filter((e) => e.kind === 'defense').length;
    const raise: HintId[] = [];
    if (!before) raise.push(side === 'attacker' ? 'startAttacker' : 'startDefender');
    if (before) {
      if (spotted(snapshot) > spotted(before)) {
        sounds.play('spotted');
        raise.push(side === 'attacker' ? 'spottedAttacker' : 'spottedDefender');
      }
      if (before.phase === 'preparation' && snapshot.phase === 'combat') raise.push('combat');
      if (snapshot.objective.heldTicks > 0 && before.objective.heldTicks === 0) {
        sounds.play('objective');
        raise.push(side === 'attacker' ? 'objectiveAttacker' : 'objectiveDefender');
      }
      if (side === 'attacker' && groups.some((g) => g.state === 'blocked')) raise.push('blocked');
      if (side === 'defender' && defenses.some((d) => d.condition <= 0)) raise.push('disrupted');
      const readyAgain = abilities.some(
        (a) => (before.cooldowns[a.id] ?? 0) > 0 && (snapshot.cooldowns[a.id] ?? 0) <= 0,
      );
      if (readyAgain) {
        sounds.play('abilityReady');
        raise.push('abilityReady');
      }
      if (!before.result && snapshot.result)
        sounds.play(snapshot.result.winner === side ? 'victory' : 'defeat');
    }
    if (config.tutorial) return;
    const fresh = raise.filter((id) => !onboarding.hintsSeen.includes(id));
    if (fresh.length > 0) setHints((queue) => [...queue, ...fresh.filter((id) => !queue.includes(id))]);
  }, [snapshot, side, groups, defenses, abilities, config.tutorial, onboarding.hintsSeen]);

  const hint = hints[0];
  useEffect(() => {
    if (hint) sounds.play('hint');
  }, [hint]);
  const dismissHint = useCallback(() => {
    if (!hint) return;
    setHints((queue) => queue.slice(1));
    void update({ onboarding: { hintsSeen: [...new Set([...onboarding.hintsSeen, hint])] } });
  }, [hint, onboarding.hintsSeen, update]);

  // ── Keyboard ─────────────────────────────────────────────────────────
  const openMenu = useCallback(() => {
    setMenuOpen(true);
    if (canControlClock && !paused) send({ type: 'setPaused', paused: true });
  }, [canControlClock, paused, send]);
  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    if (canControlClock && !holdForTutorial) send({ type: 'setPaused', paused: false });
  }, [canControlClock, holdForTutorial, send]);

  const groupCommand = (slot: number) => {
    if (!selectedGroup) return;
    const groupId = selectedGroup.id;
    if (slot === 1) command({ type: 'holdGroup', side: 'attacker', groupId });
    if (slot === 2) command({ type: 'advanceGroup', side: 'attacker', groupId });
    if (slot === 3) command({ type: 'retreatGroup', side: 'attacker', groupId });
    if (slot === 4) setMode({ type: 'reroute', groupId });
    if (slot === 5) {
      const formation = FORMATIONS[(FORMATIONS.indexOf(selectedGroup.formation) + 1) % FORMATIONS.length];
      if (formation) command({ type: 'setFormation', side: 'attacker', groupId, formation });
    }
  };
  const assetCommand = (slot: number) => {
    if (!selectedAsset) return;
    const defenseId = selectedAsset.id;
    if (slot === 1) command({ type: 'upgradeDefense', side: 'defender', defenseId }, 'build');
    if (slot === 2) command({ type: 'repairDefense', side: 'defender', defenseId }, 'build');
    if (slot === 3) {
      command({ type: 'sellDefense', side: 'defender', defenseId });
      setSelection(null);
    }
    if (slot === 4) {
      const priority =
        TARGET_PRIORITIES[(TARGET_PRIORITIES.indexOf(selectedAsset.priority) + 1) % TARGET_PRIORITIES.length];
      if (priority) command({ type: 'setPriority', side: 'defender', defenseId, priority });
    }
    if (slot === 5) setMode({ type: 'focus', defenseId });
    if (slot === 6 && selectedAsset.mobile) setMode({ type: 'guard', defenseId });
  };

  const keyRef = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keyRef.current = (event: KeyboardEvent) => {
    if (overlayOpen || ended) return;
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (menuOpen) return closeMenu();
      if (mode) return setMode(null);
      if (selection) return setSelection(null);
      if (drawerOpen && layout !== 'desktop') return setDrawerOpen(false);
      return openMenu();
    }
    if (menuOpen || document.querySelector('[role="dialog"]')) return;
    const action = actionForKey(event.code, side, bindings);
    if (!action) return;
    event.preventDefault();
    const [kind, slotText] = action.split('.');
    const slot = Number(slotText);
    switch (kind) {
      case 'match':
        if (slotText === 'pause') togglePause();
        if (slotText === 'speed') toggleSpeed();
        if (slotText === 'menu') openMenu();
        return;
      case 'ability': {
        const ability = abilities[slot - 1];
        if (ability) triggerAbility(ability);
        return;
      }
      case 'command':
        return side === 'attacker' ? groupCommand(slot) : assetCommand(slot);
      case 'unit': {
        const unit = units[slot - 1];
        if (unit) updateDraft(currentDraft, { unitTypeId: unit.id });
        return;
      }
      case 'route': {
        const route = level?.routes[slot - 1];
        if (route) updateDraft(currentDraft, { routeId: route.id });
        return;
      }
      case 'wave': {
        if (slotText === 'formation') {
          const draft = drafts[currentDraft];
          const formation =
            draft && FORMATIONS[(FORMATIONS.indexOf(draft.formation) + 1) % FORMATIONS.length];
          if (formation) updateDraft(currentDraft, { formation });
        }
        if (slotText === 'addGroup') addDraft();
        if (slotText === 'launch') launch();
        return;
      }
      case 'group': {
        if (ownGroups.length === 0) return;
        const index = ownGroups.findIndex((g) => g.id === selectedGroup?.id);
        const next = ownGroups[(index + 1) % ownGroups.length] as GroupEntity;
        select({ kind: 'group', id: next.id });
        viewRef.current?.focus(next.x, next.z);
        return;
      }
      case 'build': {
        const type = defenseTypes[slot - 1];
        if (type) chooseBuild(type.id);
        return;
      }
      case 'asset': {
        if (ownAssets.length === 0) return;
        const index = ownAssets.findIndex((d) => d.id === selectedAsset?.id);
        const next = ownAssets[(index + 1) % ownAssets.length] as DefenseEntity;
        select({ kind: 'defense', id: next.id });
        viewRef.current?.focus(next.x, next.z);
        return;
      }
    }
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => keyRef.current(event);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Swipe up on the phone drawer handle opens it, swipe down closes it.
  const swipeStart = useRef<number | null>(null);
  const onHandleDown = (event: PointerEvent) => {
    swipeStart.current = event.clientY;
  };
  const onHandleUp = (event: PointerEvent) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (start === null) return;
    const dy = event.clientY - start;
    if (dy < -24) setDrawerOpen(true);
    else if (dy > 24) setDrawerOpen(false);
  };

  if (!level) return <p className="error panel level-error">{t('level.loading')}</p>;

  // ── Panels ───────────────────────────────────────────────────────────
  const minimap = (
    <Minimap
      level={level}
      snapshot={snapshot}
      camera={viewRef.current?.cameraTarget ?? null}
      selectedId={selectedId}
      highContrast={accessibility.highContrastRoutes}
      t={t}
      onFocus={(x, z) => viewRef.current?.focus(x, z)}
    />
  );
  const list =
    side === 'attacker' ? (
      <GroupList
        units={units}
        level={level}
        groups={ownGroups}
        selectedId={selectedGroup?.id ?? null}
        t={t}
        stageText={stageText}
        onSelect={(g) => {
          select({ kind: 'group', id: g.id });
          viewRef.current?.focus(g.x, g.z);
        }}
      />
    ) : (
      <AssetList
        types={defenseTypes}
        assets={ownAssets}
        selectedId={selectedAsset?.id ?? null}
        t={t}
        stageText={stageText}
        onSelect={(a) => {
          select({ kind: 'defense', id: a.id });
          viewRef.current?.focus(a.x, a.z);
        }}
      />
    );
  const orders = selectedGroup ? (
    <GroupOrders
      group={selectedGroup}
      level={level}
      units={units}
      rerouting={mode?.type === 'reroute'}
      t={t}
      stageText={stageText}
      onHold={() => groupCommand(1)}
      onAdvance={() => groupCommand(2)}
      onRetreat={() => groupCommand(3)}
      onReroute={(routeId) =>
        routeId
          ? command({ type: 'rerouteGroup', side: 'attacker', groupId: selectedGroup.id, routeId }, 'select')
          : setMode(mode?.type === 'reroute' ? null : { type: 'reroute', groupId: selectedGroup.id })
      }
      onFormation={(formation) =>
        command({ type: 'setFormation', side: 'attacker', groupId: selectedGroup.id, formation })
      }
      onClose={() => setSelection(null)}
    />
  ) : selectedAsset ? (
    <AssetOrders
      asset={selectedAsset}
      type={defenseTypes.find((d) => d.id === selectedAsset.defenseTypeId)}
      groups={groups}
      supplies={snapshot?.resources.defender ?? 0}
      mode={mode?.type === 'focus' || mode?.type === 'guard' || mode?.type === 'patrol' ? mode.type : null}
      t={t}
      stageText={stageText}
      onUpgrade={() => assetCommand(1)}
      onRepair={() => assetCommand(2)}
      onSell={() => assetCommand(3)}
      onPriority={(priority) =>
        command({ type: 'setPriority', side: 'defender', defenseId: selectedAsset.id, priority })
      }
      onFocus={() => setMode(mode?.type === 'focus' ? null : { type: 'focus', defenseId: selectedAsset.id })}
      onClearFocus={() =>
        command({ type: 'focusTarget', side: 'defender', defenseId: selectedAsset.id, groupId: null })
      }
      onGuard={() => setMode(mode?.type === 'guard' ? null : { type: 'guard', defenseId: selectedAsset.id })}
      onPatrol={() =>
        setMode(mode?.type === 'patrol' ? null : { type: 'patrol', defenseId: selectedAsset.id })
      }
      onClose={() => setSelection(null)}
    />
  ) : null;
  const abilityBar = snapshot && (
    <AbilityBar
      abilities={abilities}
      side={side}
      snapshot={snapshot}
      aiming={mode?.type === 'ability' ? mode.abilityId : null}
      floating={compact}
      t={t}
      stageText={stageText}
      onUse={triggerAbility}
    />
  );
  const bottom =
    snapshot &&
    (side === 'attacker' ? (
      <WaveBuilder
        pack={pack}
        level={level}
        units={units}
        snapshot={snapshot}
        drafts={drafts}
        current={Math.min(currentDraft, drafts.length - 1)}
        compact={compact}
        t={t}
        stageText={stageText}
        onCurrent={setCurrentDraft}
        onChange={updateDraft}
        onAdd={addDraft}
        onRemove={removeDraft}
        onLaunch={launch}
      />
    ) : (
      <BuildBar
        types={defenseTypes}
        snapshot={snapshot}
        chosen={mode?.type === 'build' ? mode.defenseTypeId : null}
        compact={compact}
        t={t}
        stageText={stageText}
        onChoose={chooseBuild}
      />
    ));
  const modeText =
    mode?.type === 'build'
      ? t('hud.buildPick')
      : mode?.type === 'reroute'
        ? t('hud.aim.route')
        : mode?.type === 'focus'
          ? t('hud.aim.group')
          : mode?.type === 'guard' || mode?.type === 'patrol'
            ? t('hud.aim.node')
            : null;

  const won = snapshot?.result?.winner === side;
  return (
    <div
      className={`match-screen layout-${layout} ${side} ${mode ? 'aiming' : ''} ${drawerOpen ? 'drawer-open' : ''}`}
      data-testid="match-screen"
      data-layout={layout}
    >
      <canvas ref={canvasRef} className="world-canvas" data-testid="level-canvas" />
      <div ref={labelsRef} className="label-layer" aria-hidden="true" />

      <TopBar
        title={stageText(level.title)}
        side={side}
        snapshot={snapshot}
        computer={computer}
        paused={paused}
        speed={speed}
        canControlClock={canControlClock}
        compact={compact}
        t={t}
        onMenu={openMenu}
        onPause={togglePause}
        onSpeed={toggleSpeed}
      />

      {joined && snapshot && !ended && (
        <>
          {layout === 'desktop' ? (
            <>
              <aside className="hud-left">
                {list}
                {minimap}
              </aside>
              <aside className="hud-right">
                {orders}
                {abilityBar}
              </aside>
            </>
          ) : (
            <>
              {layout === 'tablet' && <div className="hud-minimap">{minimap}</div>}
              <aside
                className={`hud-drawer ${drawerOpen ? 'open' : ''}`}
                aria-label={t('hud.drawer')}
                data-testid="hud-drawer"
              >
                <button
                  type="button"
                  className="drawer-handle"
                  aria-expanded={drawerOpen}
                  aria-label={drawerOpen ? t('hud.drawerClose') : t('hud.drawerOpen')}
                  onClick={() => setDrawerOpen((open) => !open)}
                  onPointerDown={onHandleDown}
                  onPointerUp={onHandleUp}
                  data-testid="drawer-handle"
                >
                  <span aria-hidden="true" />
                  {!compact && (side === 'attacker' ? t('ctl.groups') : t('ctl.assets'))}
                </button>
                <div className="drawer-content">
                  {orders}
                  {list}
                  {compact && minimap}
                </div>
              </aside>
              {layout === 'tablet' ? <div className="hud-abilities">{abilityBar}</div> : abilityBar}
            </>
          )}
          <footer className="hud-bottom">{bottom}</footer>
        </>
      )}

      {modeText && (
        <p className="mode-hint panel" role="status" data-testid="mode-hint">
          {modeText}{' '}
          <button type="button" className="small" onClick={() => setMode(null)}>
            {t('hud.cancel')}
          </button>
        </p>
      )}
      {paused && !menuOpen && !waitsForNext && !ended && (
        <p className="paused-banner panel" role="status" data-testid="paused-banner">
          {t('pause.paused')}
        </p>
      )}
      {notice && (
        <p className="notice panel" role="status" data-testid="notice">
          {notice}
        </p>
      )}

      {config.showAiReasoning && computer && <AiReasoning thoughts={thoughts} t={t} />}

      {step && !ended && (
        <TutorialPanel
          text={stageText(step.text)}
          step={tutorialStep}
          total={steps.length}
          waitsForNext={waitsForNext}
          t={t}
          onNext={() => setTutorialStep((i) => i + 1)}
          onSkip={() => {
            setTutorialSkipped(true);
            finishTutorial();
          }}
        />
      )}
      {hint && !step && !ended && !menuOpen && (
        <HintToast text={t(`hint.${hint}`)} t={t} onDismiss={dismissHint} />
      )}

      {menuOpen && !ended && (
        <PauseMenu
          canPause={canControlClock}
          t={t}
          onResume={closeMenu}
          onManual={onManual}
          onSettings={onSettings}
          onRestart={() => {
            setMenuOpen(false);
            startMatch();
          }}
          onQuit={onQuit}
        />
      )}

      {snapshot?.result && (
        <ResultScreen
          result={snapshot.result}
          stats={snapshot.stats}
          seat={side}
          t={t}
          onPlayAgain={startMatch}
          onBack={onQuit}
          quip={{
            name: t('guo.name'),
            won,
            text: t(
              config.tutorial ? 'guo.quip.tutorial' : won ? `guo.quip.won.${side}` : `guo.quip.lost.${side}`,
            ),
          }}
        />
      )}
    </div>
  );
}
