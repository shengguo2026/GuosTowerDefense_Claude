import type { Action, StagePack } from '@gtd/content-schema';
import { createTranslator, type Translate } from '@gtd/i18n';
import type { MatchCommand, PlanningPauses } from '@gtd/protocol';
import {
  TARGET_PRIORITIES,
  type DefenseEntity,
  type GroupEntity,
  type MatchSnapshot,
  type Side,
} from '@gtd/sim';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sounds, type SoundCue } from '../audio/sound';
import { AbilityBar } from '../hud/AbilityBar';
import { GroupList, GroupOrders, WaveBuilder } from '../hud/AttackerPanels';
import { CommandWheel, type WheelItem } from '../hud/CommandWheel';
import { AssetList, AssetOrders, BuildBar } from '../hud/DefenderPanels';
import {
  abilityAim,
  abilityNeedsGroup,
  freeBuildSites,
  patrolNodes,
  upgradeCost,
  type MapMode,
} from '../hud/hudState';
import { KeyHint, NoKeyHints, useKeyLabel } from '../hud/KeyHint';
import { Minimap } from '../hud/Minimap';
import { PauseMenu } from '../hud/Overlays';
import { RouteSchematic } from '../hud/RouteSchematic';
import { MatchClock, ObjectiveBar, SideNumbers } from '../hud/TopBar';
import { Tooltip } from '../hud/Tooltip';
import { actionForKey } from '../input/bindings';
import { ResultScreen } from '../level/ResultScreen';
import type { ServerConnection } from '../useServerConnection';
import type { SettingsState } from '../useSettings';
import { LevelView, type MapPick } from '../world/levelView';
import { currentDevice, resolvePreset } from '../world/presets';
import type { MapOverlay } from '../world/selectionView';
import type { HotSeatConfig } from './matchConfig';
import {
  holdAtCursor,
  junctionIds,
  moveCursor,
  nodesAhead,
  rerouteAtCursor,
  startCursor,
  type CursorDirection,
} from './schematic';
import { useWaveDrafts } from './useWaveDrafts';

const HUD_INTERVAL_MS = 250;

interface Props {
  config: HotSeatConfig;
  pack: StagePack;
  connection: ServerConnection;
  settings: SettingsState;
  overlayOpen: boolean;
  onQuit(): void;
  onManual(): void;
  onSettings(): void;
}

/** What the Attacker's next T Z U press picks a route for, besides the wave being built. */
type AttackerMode = { type: 'reroute' } | { type: 'ability'; abilityId: string } | null;

/**
 * Hot-seat (spec §5.2): two people at one PC. The Attacker plays with the keyboard on the left half (route schematic
 * with a junction cursor, so they never need the camera); the Defender plays with the mouse on the right half and owns
 * the camera. Both see the whole map; each may take three planning pauses of up to 20 seconds.
 */
export function HotSeatScreen({
  config,
  pack,
  connection,
  settings,
  overlayOpen,
  onQuit,
  onManual,
  onSettings,
}: Props) {
  const { t, bindings } = settings;
  const { accessibility, graphics } = settings.settings;
  const level = pack.levels.find((l) => l.id === config.levelId);
  const stageText: Translate = useMemo(
    () => createTranslator(settings.language, pack.texts),
    [settings.language, pack],
  );
  const profileOf = (side: Side) =>
    pack.profiles.find(
      (p) => p.id === (side === 'attacker' ? config.attackerProfileId : config.defenderProfileId),
    );
  const attackerProfile = profileOf('attacker');
  const defenderProfile = profileOf('defender');
  const units = useMemo(
    () => pack.catalog.units.filter((u) => attackerProfile?.units.includes(u.id)),
    [pack, attackerProfile],
  );
  const defenseTypes = useMemo(
    () => pack.catalog.defenses.filter((d) => defenderProfile?.defenses.includes(d.id)),
    [pack, defenderProfile],
  );
  const abilitiesOf = useCallback(
    (side: Side) => {
      const profile = side === 'attacker' ? attackerProfile : defenderProfile;
      return pack.catalog.abilities.filter((a) => profile?.abilities.includes(a.id));
    },
    [pack, attackerProfile, defenderProfile],
  );
  const attackerAbilities = useMemo(() => abilitiesOf('attacker'), [abilitiesOf]);
  const defenderAbilities = useMemo(() => abilitiesOf('defender'), [abilitiesOf]);
  const keyLabel = useKeyLabel();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<LevelView | null>(null);
  const [snapshot, setSnapshot] = useState<MatchSnapshot | null>(null);
  const [joined, setJoined] = useState(false);
  const [paused, setPaused] = useState(false);
  const [planning, setPlanning] = useState<PlanningPauses | null>(null);
  const [pauseEndsAt, setPauseEndsAt] = useState(0);
  const [now, setNow] = useState(() => performance.now());
  const [menuOpen, setMenuOpen] = useState(false);
  const [notices, setNotices] = useState<Partial<Record<Side, string>>>({});
  // The Attacker's side: junction cursor, selected field group and the wave being built.
  const [cursor, setCursor] = useState(() => (level ? startCursor(level) : ''));
  const [groupId, setGroupId] = useState<number | null>(null);
  const [attackerMode, setAttackerMode] = useState<AttackerMode>(null);
  const wave = useWaveDrafts(units, level);
  // The Defender's side: selected asset, what the next click does, and the right-click wheel.
  const [assetId, setAssetId] = useState<number | null>(null);
  const [mode, setMode] = useState<MapMode>(null);
  const [wheel, setWheel] = useState<{ x: number; y: number; assetId: number } | null>(null);

  const preset = useMemo(() => resolvePreset(graphics, currentDevice()), [graphics]);
  const { send, subscribe, status } = connection;

  const notify = useCallback((side: Side, text: string) => {
    setNotices((current) => ({ ...current, [side]: text }));
  }, []);
  useEffect(() => {
    if (!notices.attacker && !notices.defender) return;
    const timer = window.setTimeout(() => setNotices({}), 3500);
    return () => window.clearTimeout(timer);
  }, [notices]);

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
      hiddenMarkers: true,
    });
    viewRef.current = view;
    view.onPointer({ tap: (pick, button, screen) => tapRef.current(pick, button, screen) });
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
      seat: 'both',
      hotSeat: true,
      attackerProfileId: config.attackerProfileId,
      defenderProfileId: config.defenderProfileId,
    });
  }, [send, config]);

  useEffect(() => {
    let lastHud = 0;
    return subscribe((message) => {
      switch (message.type) {
        case 'matchStarted':
          viewRef.current?.buffer.clear();
          setSnapshot(null);
          setGroupId(null);
          setAssetId(null);
          setMode(null);
          setAttackerMode(null);
          setWheel(null);
          return;
        case 'joined':
          return setJoined(true);
        case 'clock':
          setPaused(message.paused);
          setPlanning(message.planning ?? null);
          setPauseEndsAt(performance.now() + (message.planning?.secondsLeft ?? 0) * 1000);
          return;
        case 'commandRejected':
          sounds.play('rejected');
          return notify(message.side, t('ctl.rejected', { reason: t(`reject.${message.reason}`) }));
        case 'error':
          if (message.code === 'noPausesLeft') notify('attacker', t('hot.noPausesLeft'));
          return;
        case 'snapshot': {
          viewRef.current?.pushSnapshot(message.snapshot);
          const time = performance.now();
          if (time - lastHud > HUD_INTERVAL_MS || message.snapshot.phase === 'ended') {
            lastHud = time;
            setSnapshot(message.snapshot);
          }
          return;
        }
        default:
          return;
      }
    });
  }, [subscribe, t, notify]);

  useEffect(() => {
    if (status !== 'connected') return;
    startMatch();
    return () => {
      send({ type: 'leaveMatch' });
      setJoined(false);
    };
  }, [status, startMatch, send]);

  // The running planning pause counts down on screen between clock messages.
  useEffect(() => {
    if (!planning?.by) return;
    const timer = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(timer);
  }, [planning?.by]);

  // ── Derived state ────────────────────────────────────────────────────
  const groups = useMemo(
    () => (snapshot?.entities ?? []).filter((e): e is GroupEntity => e.kind === 'group'),
    [snapshot],
  );
  const defenses = useMemo(
    () => (snapshot?.entities ?? []).filter((e): e is DefenseEntity => e.kind === 'defense'),
    [snapshot],
  );
  const selectedGroup = groups.find((g) => g.id === groupId) ?? null;
  const selectedAsset = defenses.find((d) => d.id === assetId) ?? null;
  const ended = Boolean(snapshot?.result);
  const junctions = useMemo(() => (level ? junctionIds(level) : new Set<string>()), [level]);

  // A group that left the field is no longer selected.
  useEffect(() => {
    if (groupId !== null && snapshot && !selectedGroup) {
      setGroupId(null);
      setAttackerMode(null);
    }
  }, [groupId, snapshot, selectedGroup]);

  const command = useCallback(
    (cmd: MatchCommand, cue?: SoundCue) => {
      send({ type: 'command', command: cmd });
      if (cue) sounds.play(cue);
    },
    [send],
  );

  // ── Planning pauses ──────────────────────────────────────────────────
  const togglePause = useCallback(
    (side: Side) => {
      if (!planning || ended) return;
      if (paused) return send({ type: 'setPaused', paused: false });
      if (planning.left[side] <= 0) return notify(side, t('hot.noPausesLeft'));
      send({ type: 'planningPause', side });
    },
    [planning, paused, ended, send, notify, t],
  );

  // ── Attacker (keyboard) ──────────────────────────────────────────────
  const launch = useCallback(
    () => command({ type: 'launchWave', side: 'attacker', groups: wave.drafts }, 'launch'),
    [command, wave.drafts],
  );

  const cursorProblem = (reason: string) => notify('attacker', t(`hot.cursor.${reason}`));

  const attackerRoute = (routeId: string) => {
    if (!level) return;
    if (attackerMode?.type === 'ability' && selectedGroup) {
      command(
        {
          type: 'useAbility',
          side: 'attacker',
          abilityId: attackerMode.abilityId,
          groupId: selectedGroup.id,
          routeId,
        },
        'ability',
      );
      return setAttackerMode(null);
    }
    if (!selectedGroup) return wave.update(wave.current, { routeId });
    const order = rerouteAtCursor(level, selectedGroup, cursor, routeId);
    if (order.type === 'none') return cursorProblem(order.reason);
    command(
      order.type === 'switch'
        ? { type: 'rerouteGroup', side: 'attacker', groupId: selectedGroup.id, routeId, nodeId: order.nodeId }
        : { type: 'rerouteGroup', side: 'attacker', groupId: selectedGroup.id, routeId },
      'select',
    );
    setAttackerMode(null);
  };

  const attackerAbility = (ability: Action) => {
    if (!snapshot || !level) return;
    if ((snapshot.cooldowns[ability.id] ?? 0) > 0)
      return notify('attacker', t('ctl.rejected', { reason: t('reject.cooldown') }));
    if ((snapshot.points.attacker ?? 0) < ability.cost)
      return notify('attacker', t('ctl.rejected', { reason: t('reject.notEnoughPoints') }));
    const base = { type: 'useAbility' as const, side: 'attacker' as const, abilityId: ability.id };
    const aim = abilityAim(ability);
    const node = level.map.nodes.find((n) => n.id === cursor);
    if (aim === 'now') return command(base, 'ability');
    if (aim === 'ground' || aim === 'node') {
      if (node) command({ ...base, x: node.x, z: node.z }, 'ability');
      return;
    }
    if (!selectedGroup) return notify('attacker', t('hud.pickGroupFirst'));
    if (aim === 'route' && abilityNeedsGroup(ability)) {
      setAttackerMode({ type: 'ability', abilityId: ability.id });
      return notify('attacker', t('hot.help.pickRoute', { keys: routeKeys }));
    }
    command({ ...base, groupId: selectedGroup.id }, 'ability');
  };

  const groupCommand = (slot: number) => {
    if (!selectedGroup) return notify('attacker', t('hud.pickGroupFirst'));
    const id = selectedGroup.id;
    if (slot === 1) command({ type: 'holdGroup', side: 'attacker', groupId: id });
    if (slot === 2) command({ type: 'advanceGroup', side: 'attacker', groupId: id });
    if (slot === 3) command({ type: 'retreatGroup', side: 'attacker', groupId: id });
    if (slot === 4) {
      setAttackerMode(attackerMode?.type === 'reroute' ? null : { type: 'reroute' });
      notify('attacker', t('hot.help.pickRoute', { keys: routeKeys }));
    }
    if (slot === 5)
      command({
        type: 'setFormation',
        side: 'attacker',
        groupId: id,
        formation: selectedGroup.formation === 'column' ? 'spread' : 'column',
      });
  };

  const selectGroup = (next: GroupEntity | null) => {
    setGroupId(next?.id ?? null);
    setAttackerMode(null);
    if (next) sounds.play('select');
  };

  const openMenu = useCallback(() => setMenuOpen(true), []);

  const keyRef = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keyRef.current = (event: KeyboardEvent) => {
    if (overlayOpen || ended || !level) return;
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (menuOpen) return setMenuOpen(false);
      if (attackerMode) return setAttackerMode(null);
      if (groupId !== null) return selectGroup(null);
      return openMenu();
    }
    if (menuOpen || document.querySelector('[role="dialog"]')) return;
    // Only the Attacker has keys in hot-seat; the Defender plays with the mouse.
    const action = actionForKey(event.code, 'attacker', bindings);
    if (!action) return;
    event.preventDefault();
    const [kind, slotText] = action.split('.');
    const slot = Number(slotText);
    switch (kind) {
      case 'match':
        if (slotText === 'pause') togglePause('attacker');
        if (slotText === 'menu') openMenu();
        return;
      case 'cursor': {
        const next = moveCursor(level, cursor, slotText as CursorDirection);
        if (next !== cursor) sounds.play('select');
        return setCursor(next);
      }
      case 'ability': {
        const ability = attackerAbilities[slot - 1];
        if (ability) attackerAbility(ability);
        return;
      }
      case 'command':
        return groupCommand(slot);
      case 'unit': {
        const unit = units[slot - 1];
        if (unit) wave.unitKey(unit.id, event.shiftKey);
        return;
      }
      case 'route': {
        const route = level.routes[slot - 1];
        if (route) attackerRoute(route.id);
        return;
      }
      case 'wave':
        if (slotText === 'formation') wave.cycleFormation();
        if (slotText === 'launch') launch();
        if (slotText === 'addGroup') {
          if (!selectedGroup) return wave.add();
          const order = holdAtCursor(level, selectedGroup, cursor);
          if (order.type === 'none') return cursorProblem(order.reason);
          command(
            { type: 'holdGroup', side: 'attacker', groupId: selectedGroup.id, nodeId: cursor },
            'select',
          );
        }
        return;
      case 'group': {
        const field = groups.filter((g) => g.state !== 'retreating');
        if (field.length === 0) return notify('attacker', t('ctl.noGroups'));
        const index = field.findIndex((g) => g.id === groupId);
        const step = event.shiftKey ? field.length - 1 : 1;
        selectGroup(field[(Math.max(index, event.shiftKey ? 0 : -1) + step) % field.length] ?? null);
        return;
      }
    }
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => keyRef.current(event);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Defender (mouse) ─────────────────────────────────────────────────
  const selectAsset = (next: DefenseEntity | null) => {
    setAssetId(next?.id ?? null);
    setMode(null);
    if (next) sounds.play('select');
  };

  const chooseBuild = (typeId: string) => {
    if (mode?.type === 'build' && mode.defenseTypeId === typeId) return setMode(null);
    setAssetId(null);
    setMode({ type: 'build', defenseTypeId: typeId });
  };

  const defenderAbility = (ability: Action) => {
    if (!snapshot) return;
    if ((snapshot.cooldowns[ability.id] ?? 0) > 0)
      return notify('defender', t('ctl.rejected', { reason: t('reject.cooldown') }));
    if ((snapshot.points.defender ?? 0) < ability.cost)
      return notify('defender', t('ctl.rejected', { reason: t('reject.notEnoughPoints') }));
    if (mode?.type === 'ability' && mode.abilityId === ability.id) return setMode(null);
    const aim = abilityAim(ability);
    if (aim === 'now')
      return command({ type: 'useAbility', side: 'defender', abilityId: ability.id }, 'ability');
    setMode({ type: 'ability', abilityId: ability.id });
    notify('defender', t(`hud.aim.${aim}`));
  };

  const assetCommand = (asset: DefenseEntity, order: string) => {
    const defenseId = asset.id;
    if (order === 'upgrade') command({ type: 'upgradeDefense', side: 'defender', defenseId }, 'build');
    if (order === 'repair') command({ type: 'repairDefense', side: 'defender', defenseId }, 'build');
    if (order === 'sell') {
      command({ type: 'sellDefense', side: 'defender', defenseId });
      setAssetId(null);
    }
    if (order === 'priority') {
      const priority =
        TARGET_PRIORITIES[(TARGET_PRIORITIES.indexOf(asset.priority) + 1) % TARGET_PRIORITIES.length];
      if (priority) command({ type: 'setPriority', side: 'defender', defenseId, priority });
    }
    if (order === 'focus' || order === 'guard' || order === 'patrol') {
      setAssetId(defenseId);
      setMode({ type: order, defenseId });
    }
  };

  const tap = (pick: MapPick, button: number, screen: { x: number; y: number }) => {
    if (!level || !snapshot || ended) return;
    const entity = pick.entityId === null ? undefined : snapshot.entities.find((e) => e.id === pick.entityId);
    if (button === 2) {
      // Right click on an own asset opens its command wheel; anywhere else it cancels.
      if (entity?.kind === 'defense') {
        setAssetId(entity.id);
        setMode(null);
        return setWheel({ x: screen.x, y: screen.y, assetId: entity.id });
      }
      if (mode) setMode(null);
      else setAssetId(null);
      return;
    }
    switch (mode?.type) {
      case 'build': {
        const type = defenseTypes.find((d) => d.id === mode.defenseTypeId);
        if (pick.nodeId && freeBuildSites(level, type, defenses).some((n) => n.id === pick.nodeId)) {
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
        } else notify('defender', t('hud.notHere'));
        return;
      }
      case 'ability': {
        const ability = defenderAbilities.find((a) => a.id === mode.abilityId);
        if (!ability) return setMode(null);
        const base = { type: 'useAbility' as const, side: 'defender' as const, abilityId: ability.id };
        const aim = abilityAim(ability);
        if (aim === 'ground' && pick.ground)
          command({ ...base, x: pick.ground.x, z: pick.ground.z }, 'ability');
        else if (aim === 'group' && entity?.kind === 'group')
          command({ ...base, groupId: entity.id }, 'ability');
        else if (aim === 'route' && pick.routeId) command({ ...base, routeId: pick.routeId }, 'ability');
        else if (aim === 'node' && pick.nodeId) {
          const node = level.map.nodes.find((n) => n.id === pick.nodeId);
          if (node) command({ ...base, x: node.x, z: node.z }, 'ability');
        } else return notify('defender', t(`hud.aim.${aim}`));
        setMode(null);
        return;
      }
      case 'focus':
        if (entity?.kind === 'group') {
          command(
            { type: 'focusTarget', side: 'defender', defenseId: mode.defenseId, groupId: entity.id },
            'select',
          );
          setMode(null);
        } else notify('defender', t('hud.aim.group'));
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
        } else notify('defender', t('hud.aim.node'));
        return;
      }
      default:
        break;
    }
    if (entity?.kind === 'defense') return selectAsset(entity);
    if (pick.nodeId && defenseTypes[0]) notify('defender', t('hud.buildChoose'));
    selectAsset(null);
  };
  const tapRef = useRef(tap);
  tapRef.current = tap;

  // Marks on the map: the Defender's selection and build sites, the Attacker's group and junction cursor.
  const cursorPoint = level?.map.nodes.find((n) => n.id === cursor) ?? null;
  const overlay: MapOverlay = useMemo(() => {
    if (!level) return {};
    const result: MapOverlay = {
      selectedId: selectedAsset?.id ?? null,
      markedId: selectedGroup?.id ?? null,
      cursor: cursorPoint ? { x: cursorPoint.x, z: cursorPoint.z } : null,
    };
    if (mode?.type === 'build') {
      const type = defenseTypes.find((d) => d.id === mode.defenseTypeId);
      result.buildSites = freeBuildSites(level, type, defenses).map((n) => ({ id: n.id, x: n.x, z: n.z }));
    } else if (mode?.type === 'guard' || mode?.type === 'patrol') {
      result.buildSites = patrolNodes(level)
        .map((id) => level.map.nodes.find((n) => n.id === id))
        .filter((n) => n !== undefined)
        .map((n) => ({ id: n.id, x: n.x, z: n.z }));
    } else if (mode?.type === 'ability') {
      const ability = defenderAbilities.find((a) => a.id === mode.abilityId);
      if (ability && abilityAim(ability) === 'ground') result.areaRadius = ability.range;
    }
    if (selectedAsset)
      result.selectedRange = defenseTypes.find((d) => d.id === selectedAsset.defenseTypeId)?.range;
    return result;
  }, [level, mode, selectedAsset, selectedGroup, cursorPoint, defenses, defenseTypes, defenderAbilities]);
  useEffect(() => viewRef.current?.setOverlay(overlay), [overlay]);
  const draftRoute = wave.drafts[wave.current]?.routeId ?? null;
  const shownRoute = selectedGroup ? selectedGroup.routeId : draftRoute;
  useEffect(() => viewRef.current?.highlightRoute(shownRoute), [shownRoute]);

  const previous = useRef<MatchSnapshot | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = snapshot;
    if (before && !before.result && snapshot?.result) sounds.play('victory');
  }, [snapshot]);
  const routeKeys = (level?.routes ?? [])
    .map((_, i) => keyLabel(`route.${i + 1}`))
    .filter(Boolean)
    .join(' ');

  if (!level) return <p className="error panel level-error">{t('level.loading')}</p>;

  // ── Panels ───────────────────────────────────────────────────────────
  const help = (() => {
    if (attackerMode) return t('hot.help.pickRoute', { keys: routeKeys });
    if (!selectedGroup)
      return t('hot.help.wave', {
        add: keyLabel('wave.addGroup') ?? '',
        launch: keyLabel('wave.launch') ?? '',
      });
    if (!nodesAhead(level, selectedGroup).includes(cursor) && selectedGroup.state !== 'holding')
      return t('hot.help.moveCursor');
    return junctions.has(cursor)
      ? t('hot.help.junction', { enter: keyLabel('wave.addGroup') ?? '', keys: routeKeys })
      : t('hot.help.switch', { keys: routeKeys });
  })();
  const secondsLeft = planning?.by ? Math.max(0, Math.ceil((pauseEndsAt - now) / 1000)) : 0;
  const pauseButton = (side: Side) =>
    planning && (
      <Tooltip text={t('hot.tip.pause', { count: planning.left[side] })}>
        <button
          type="button"
          className={`hud-button planning-pause ${paused ? 'active' : ''}`}
          onClick={() => togglePause(side)}
          disabled={!paused && planning.left[side] <= 0}
          aria-pressed={paused}
          data-testid={`pause-${side}`}
        >
          {paused ? t('hot.resume') : t('hot.pause')}
          <span className="pauses-left" data-testid={`pauses-${side}`}>
            {planning.left[side]}
          </span>
          {side === 'attacker' && <KeyHint action="match.pause" />}
        </button>
      </Tooltip>
    );

  const wheelAsset = wheel ? defenses.find((d) => d.id === wheel.assetId) : undefined;
  const wheelType = wheelAsset ? defenseTypes.find((d) => d.id === wheelAsset.defenseTypeId) : undefined;
  const wheelItems: WheelItem[] =
    wheelAsset && wheelType
      ? [
          {
            id: 'upgrade',
            label:
              wheelAsset.level < wheelType.maxLevel
                ? t('hud.upgradeFor', { cost: upgradeCost(wheelType, wheelAsset.level) })
                : t('hud.maxLevel'),
            disabled: wheelAsset.level >= wheelType.maxLevel,
            onPick: () => assetCommand(wheelAsset, 'upgrade'),
          },
          {
            id: 'repair',
            label: t('ctl.repair'),
            disabled: wheelAsset.condition >= 100,
            onPick: () => assetCommand(wheelAsset, 'repair'),
          },
          {
            id: 'sell',
            label: t('hud.sellFor', { refund: Math.round(wheelAsset.spent * 0.5) }),
            onPick: () => assetCommand(wheelAsset, 'sell'),
          },
          {
            id: 'priority',
            label: `${t('ctl.priority')}: ${t(`priority.${wheelAsset.priority}`)}`,
            onPick: () => assetCommand(wheelAsset, 'priority'),
          },
          { id: 'focus', label: t('ctl.focus'), onPick: () => assetCommand(wheelAsset, 'focus') },
          ...(wheelAsset.mobile
            ? [
                { id: 'guard', label: t('ctl.guard'), onPick: () => assetCommand(wheelAsset, 'guard') },
                { id: 'patrol', label: t('ctl.patrol'), onPick: () => assetCommand(wheelAsset, 'patrol') },
              ]
            : []),
        ]
      : [];

  const defenderModeText =
    mode?.type === 'build'
      ? t('hud.buildPick')
      : mode?.type === 'focus'
        ? t('hud.aim.group')
        : mode?.type === 'guard' || mode?.type === 'patrol'
          ? t('hud.aim.node')
          : null;

  return (
    <div className="match-screen hotseat layout-desktop" data-testid="hotseat-screen">
      <canvas ref={canvasRef} className="world-canvas" data-testid="level-canvas" />
      <div ref={labelsRef} className="label-layer" aria-hidden="true" />

      <header className="hud-top hotseat-top" data-testid="hud-top">
        <button
          type="button"
          className="hud-button"
          onClick={openMenu}
          aria-label={t('pause.title')}
          data-testid="open-menu"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path fill="currentColor" d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z" />
          </svg>
          <KeyHint action="match.menu" />
        </button>
        {snapshot && (
          <div className="hot-side attacker">
            <span className="badge attacker">
              {config.names.attacker || t('seat.attacker')} · {t('hot.keyboard')}
            </span>
            <SideNumbers snapshot={snapshot} side="attacker" t={t} />
            {pauseButton('attacker')}
          </div>
        )}
        {snapshot && (
          <div className="hot-centre">
            <MatchClock snapshot={snapshot} t={t} />
            <ObjectiveBar snapshot={snapshot} side={null} t={t} />
          </div>
        )}
        {snapshot && (
          <NoKeyHints>
            <div className="hot-side defender">
              {pauseButton('defender')}
              <SideNumbers snapshot={snapshot} side="defender" t={t} />
              <span className="badge defender">
                {config.names.defender || t('seat.defender')} · {t('hot.mouse')}
              </span>
            </div>
          </NoKeyHints>
        )}
      </header>

      {joined && snapshot && !ended && (
        <>
          <aside className="hot-half attacker" aria-label={t('seat.attacker')} data-testid="attacker-half">
            <RouteSchematic
              level={level}
              groups={groups}
              cursor={cursor}
              draftRoute={selectedGroup ? selectedGroup.routeId : draftRoute}
              selectedId={selectedGroup?.id ?? null}
              help={help}
              highContrast={accessibility.highContrastRoutes}
              t={t}
              stageText={stageText}
            />
            {selectedGroup ? (
              <GroupOrders
                group={selectedGroup}
                level={level}
                units={units}
                rerouting={attackerMode?.type === 'reroute'}
                t={t}
                stageText={stageText}
                onHold={() => groupCommand(1)}
                onAdvance={() => groupCommand(2)}
                onRetreat={() => groupCommand(3)}
                onReroute={(routeId) => (routeId ? attackerRoute(routeId) : groupCommand(4))}
                onFormation={(formation) =>
                  command({ type: 'setFormation', side: 'attacker', groupId: selectedGroup.id, formation })
                }
                onClose={() => selectGroup(null)}
              />
            ) : (
              <GroupList
                units={units}
                level={level}
                groups={groups}
                selectedId={null}
                t={t}
                stageText={stageText}
                onSelect={selectGroup}
              />
            )}
            <AbilityBar
              abilities={attackerAbilities}
              side="attacker"
              snapshot={snapshot}
              aiming={attackerMode?.type === 'ability' ? attackerMode.abilityId : null}
              floating={false}
              t={t}
              stageText={stageText}
              onUse={attackerAbility}
            />
            {notices.attacker && (
              <p className="notice panel" role="status" data-testid="notice-attacker">
                {notices.attacker}
              </p>
            )}
          </aside>

          <NoKeyHints>
            <aside className="hot-half defender" aria-label={t('seat.defender')} data-testid="defender-half">
              <Minimap
                level={level}
                snapshot={snapshot}
                camera={viewRef.current?.cameraTarget ?? null}
                selectedId={selectedAsset?.id ?? null}
                highContrast={accessibility.highContrastRoutes}
                t={t}
                onFocus={(x, z) => viewRef.current?.focus(x, z)}
              />
              {selectedAsset ? (
                <AssetOrders
                  asset={selectedAsset}
                  type={defenseTypes.find((d) => d.id === selectedAsset.defenseTypeId)}
                  groups={groups}
                  supplies={snapshot.resources.defender ?? 0}
                  mode={
                    mode?.type === 'focus' || mode?.type === 'guard' || mode?.type === 'patrol'
                      ? mode.type
                      : null
                  }
                  t={t}
                  stageText={stageText}
                  onUpgrade={() => assetCommand(selectedAsset, 'upgrade')}
                  onRepair={() => assetCommand(selectedAsset, 'repair')}
                  onSell={() => assetCommand(selectedAsset, 'sell')}
                  onPriority={(priority) =>
                    command({ type: 'setPriority', side: 'defender', defenseId: selectedAsset.id, priority })
                  }
                  onFocus={() =>
                    setMode(mode?.type === 'focus' ? null : { type: 'focus', defenseId: selectedAsset.id })
                  }
                  onClearFocus={() =>
                    command({
                      type: 'focusTarget',
                      side: 'defender',
                      defenseId: selectedAsset.id,
                      groupId: null,
                    })
                  }
                  onGuard={() =>
                    setMode(mode?.type === 'guard' ? null : { type: 'guard', defenseId: selectedAsset.id })
                  }
                  onPatrol={() =>
                    setMode(mode?.type === 'patrol' ? null : { type: 'patrol', defenseId: selectedAsset.id })
                  }
                  onClose={() => selectAsset(null)}
                />
              ) : (
                <AssetList
                  types={defenseTypes}
                  assets={defenses}
                  selectedId={null}
                  t={t}
                  stageText={stageText}
                  onSelect={(asset) => {
                    selectAsset(asset);
                    viewRef.current?.focus(asset.x, asset.z);
                  }}
                />
              )}
              <AbilityBar
                abilities={defenderAbilities}
                side="defender"
                snapshot={snapshot}
                aiming={mode?.type === 'ability' ? mode.abilityId : null}
                floating={false}
                t={t}
                stageText={stageText}
                onUse={defenderAbility}
              />
              {(notices.defender || defenderModeText) && (
                <p className="notice panel" role="status" data-testid="notice-defender">
                  {notices.defender ?? defenderModeText}
                  {defenderModeText && !notices.defender && (
                    <button type="button" className="small" onClick={() => setMode(null)}>
                      {t('hud.cancel')}
                    </button>
                  )}
                </p>
              )}
            </aside>
          </NoKeyHints>

          <footer className="hot-bottom attacker">
            <WaveBuilder
              pack={pack}
              level={level}
              units={units}
              snapshot={snapshot}
              drafts={wave.drafts}
              current={wave.current}
              compact={false}
              t={t}
              stageText={stageText}
              onCurrent={wave.setCurrent}
              onChange={wave.update}
              onAdd={wave.add}
              onRemove={wave.remove}
              onLaunch={launch}
            />
          </footer>
          <NoKeyHints>
            <footer className="hot-bottom defender">
              <BuildBar
                types={defenseTypes}
                snapshot={snapshot}
                chosen={mode?.type === 'build' ? mode.defenseTypeId : null}
                compact={false}
                t={t}
                stageText={stageText}
                onChoose={chooseBuild}
              />
            </footer>
          </NoKeyHints>
        </>
      )}

      {paused && planning?.by && !ended && (
        <div className="paused-banner panel planning" role="status" data-testid="paused-banner">
          <strong>{t('hot.paused', { side: t(`seat.${planning.by}`) })}</strong>
          <span className="countdown" data-testid="pause-countdown">
            {t('hot.secondsLeft', { seconds: secondsLeft })}
          </span>
          <button type="button" className="small" onClick={() => send({ type: 'setPaused', paused: false })}>
            {t('hot.resume')}
          </button>
        </div>
      )}

      {wheel && wheelAsset && (
        <CommandWheel
          x={wheel.x}
          y={wheel.y}
          title={wheelType ? stageText(wheelType.name) : ''}
          items={wheelItems}
          t={t}
          onClose={() => setWheel(null)}
        />
      )}

      {menuOpen && !ended && (
        <PauseMenu
          canPause={false}
          t={t}
          onResume={() => setMenuOpen(false)}
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
          seat="both"
          names={config.names}
          t={t}
          onPlayAgain={startMatch}
          onBack={onQuit}
        />
      )}
    </div>
  );
}
