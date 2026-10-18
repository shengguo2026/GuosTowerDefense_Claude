import type { Level, StagePack } from '@gtd/content-schema';
import type { Translate } from '@gtd/i18n';
import { seatControls, type MatchCommand, type Seat } from '@gtd/protocol';
import {
  TARGET_PRIORITIES,
  TICK_MS,
  type DefenseEntity,
  type Formation,
  type GroupEntity,
  type MatchSnapshot,
  type Side,
  type TargetPriority,
  type WaveGroupOrder,
} from '@gtd/sim';
import { useState } from 'react';

interface Props {
  pack: StagePack;
  level: Level;
  snapshot: MatchSnapshot;
  seat: Seat;
  attackerProfileId: string;
  defenderProfileId: string;
  t: Translate;
  stageText: Translate;
  send(command: MatchCommand): void;
}

export function formatSeconds(ticks: number): string {
  const seconds = Math.max(0, Math.ceil((ticks * TICK_MS) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Node ids read as names in the debug controls ("junction-hill" → "Junction hill"). */
export function nodeName(id: string): string {
  const words = id.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const FORMATIONS: Formation[] = ['column', 'spread'];

/**
 * Debug controls for people playing a match before the real HUD exists (M4): every command of both sides as plain
 * form controls. A seat for both sides gets a tab per side.
 */
export function MatchControls(props: Props) {
  const { seat, t } = props;
  const sides: Side[] = (['attacker', 'defender'] as const).filter((side) => seatControls(seat, side));
  const [tab, setTab] = useState<Side>(sides[0] ?? 'attacker');
  if (sides.length === 0) return null;
  const active = sides.includes(tab) ? tab : (sides[0] as Side);
  return (
    <div className="match-controls" data-testid="match-controls">
      {sides.length > 1 && (
        <div className="side-tabs" role="tablist">
          {sides.map((side) => (
            <button
              key={side}
              type="button"
              role="tab"
              aria-selected={active === side}
              className={`side-tab ${side} ${active === side ? 'active' : ''}`}
              onClick={() => setTab(side)}
              data-testid={`tab-${side}`}
            >
              {t(`seat.${side}`)}
            </button>
          ))}
        </div>
      )}
      {active === 'attacker' ? <AttackerControls {...props} /> : <DefenderControls {...props} />}
    </div>
  );
}

function SideSummary({ snapshot, side, t }: { snapshot: MatchSnapshot; side: Side; t: Translate }) {
  return (
    <div className="side-summary">
      <span>
        {t('hud.supplies')}{' '}
        <strong data-testid={`${side}-supplies`}>{Math.floor(snapshot.resources[side] ?? 0)}</strong>
      </span>
      <span>
        {t('hud.points')} <strong>{Math.floor(snapshot.points[side] ?? 0)}</strong>
      </span>
      {side === 'attacker' && (
        <span>
          {t('hud.capacity')}{' '}
          <strong data-testid="capacity">
            {snapshot.capacity.remaining}/{snapshot.capacity.total}
          </strong>
        </span>
      )}
    </div>
  );
}

function AttackerControls({ pack, level, snapshot, attackerProfileId, t, stageText, send }: Props) {
  const profile = pack.profiles.find((p) => p.id === attackerProfileId);
  const units = pack.catalog.units.filter((u) => profile?.units.includes(u.id));
  const abilities = pack.catalog.abilities.filter((a) => profile?.abilities.includes(a.id));
  const firstUnit = units[0]?.id ?? '';
  const firstRoute = level.routes[0]?.id ?? '';
  const [orders, setOrders] = useState<WaveGroupOrder[]>([
    { unitTypeId: firstUnit, count: 6, formation: 'column', routeId: firstRoute, delaySeconds: 0 },
  ]);
  const groups = snapshot.entities.filter((e): e is GroupEntity => e.kind === 'group');
  const capacity = orders.reduce(
    (sum, o) => sum + (units.find((u) => u.id === o.unitTypeId)?.capacity ?? 0) * o.count,
    0,
  );
  const cost = orders.reduce(
    (sum, o) => sum + (units.find((u) => u.id === o.unitTypeId)?.cost ?? 0) * o.count,
    0,
  );
  const update = (index: number, patch: Partial<WaveGroupOrder>) =>
    setOrders((list) => list.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  const routeName = (id: string) => {
    const route = level.routes.find((r) => r.id === id);
    return route?.name ? stageText(route.name) : nodeName(id);
  };
  const launchWait =
    snapshot.phase === 'preparation'
      ? snapshot.preparationRemainingTicks
      : snapshot.launchCooldownRemainingTicks;

  return (
    <section className="side-panel attacker" aria-label={t('seat.attacker')}>
      <SideSummary snapshot={snapshot} side="attacker" t={t} />

      <h3>{t('ctl.waveBuilder')}</h3>
      {orders.map((order, index) => (
        <div className="wave-row" key={index} data-testid="wave-row">
          <label>
            {t('ctl.unit')}
            <select value={order.unitTypeId} onChange={(e) => update(index, { unitTypeId: e.target.value })}>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {stageText(u.name)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('ctl.count')}
            <input
              type="number"
              min={1}
              max={99}
              value={order.count}
              onChange={(e) => update(index, { count: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
              data-testid="wave-count"
            />
          </label>
          <label>
            {t('ctl.formation')}
            <select
              value={order.formation}
              onChange={(e) => update(index, { formation: e.target.value as Formation })}
            >
              {FORMATIONS.map((f) => (
                <option key={f} value={f}>
                  {t(`formation.${f}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('ctl.route')}
            <select
              value={order.routeId}
              onChange={(e) => update(index, { routeId: e.target.value })}
              data-testid="wave-route"
            >
              {level.routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {routeName(r.id)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('ctl.delay')}
            <input
              type="number"
              min={0}
              max={30}
              value={order.delaySeconds}
              onChange={(e) =>
                update(index, { delaySeconds: Math.min(30, Math.max(0, Number(e.target.value) || 0)) })
              }
            />
          </label>
          {orders.length > 1 && (
            <button
              type="button"
              className="small"
              onClick={() => setOrders((list) => list.filter((_, i) => i !== index))}
              aria-label={t('ctl.removeGroup')}
              title={t('ctl.removeGroup')}
            >
              ×
            </button>
          )}
        </div>
      ))}
      <div className="row">
        {orders.length < 4 && (
          <button
            type="button"
            className="small"
            onClick={() => setOrders((list) => [...list, { ...(list[list.length - 1] as WaveGroupOrder) }])}
          >
            + {t('ctl.addGroup')}
          </button>
        )}
        <span className="muted">
          {launchWait > 0 ? t('hud.launchIn', { time: formatSeconds(launchWait) }) : t('hud.launchReady')} ·{' '}
          {t('hud.waves', { active: snapshot.activeWaves, max: level.maxActiveWaves })}
        </span>
      </div>
      <button
        type="button"
        className="action launch"
        data-testid="launch-wave"
        onClick={() => send({ type: 'launchWave', side: 'attacker', groups: orders })}
      >
        {t('ctl.launch', { capacity, cost })}
      </button>

      <h3>{t('ctl.groups')}</h3>
      {groups.length === 0 && <p className="muted">{t('ctl.noGroups')}</p>}
      {groups.map((group) => (
        <GroupRow key={group.id} group={group} {...{ pack, level, t, stageText, send, routeName }} />
      ))}

      <h3>{t('ctl.abilities')}</h3>
      {abilities.map((ability) => (
        <AbilityRow
          key={ability.id}
          ability={ability}
          side="attacker"
          {...{ level, snapshot, t, stageText, send, routeName }}
        />
      ))}
    </section>
  );
}

function GroupRow({
  group,
  pack,
  level,
  t,
  stageText,
  send,
  routeName,
}: {
  group: GroupEntity;
  pack: StagePack;
  level: Level;
  t: Translate;
  stageText: Translate;
  send(command: MatchCommand): void;
  routeName(id: string): string;
}) {
  const unit = pack.catalog.units.find((u) => u.id === group.unitTypeId);
  const otherRoutes = level.routes.filter((r) => r.id !== group.routeId);
  const [reroute, setReroute] = useState(otherRoutes[0]?.id ?? '');
  const groupId = group.id;
  return (
    <div className="entity-row" data-testid="group-row">
      <div>
        <strong>
          {group.count} × {unit ? stageText(unit.name) : group.unitTypeId}
        </strong>{' '}
        <span className="muted">
          {routeName(group.routeId)} · {t(`state.${group.state}`)} · {t(`detection.${group.detection}`)}
        </span>
      </div>
      <div className="row">
        <button
          type="button"
          className="small"
          onClick={() => send({ type: 'holdGroup', side: 'attacker', groupId })}
        >
          {t('ctl.hold')}
        </button>
        <button
          type="button"
          className="small"
          onClick={() => send({ type: 'advanceGroup', side: 'attacker', groupId })}
        >
          {t('ctl.advance')}
        </button>
        <button
          type="button"
          className="small"
          onClick={() => send({ type: 'retreatGroup', side: 'attacker', groupId })}
          data-testid="retreat"
        >
          {t('ctl.retreat')}
        </button>
        <select
          value={group.formation}
          aria-label={t('ctl.formation')}
          onChange={(e) =>
            send({ type: 'setFormation', side: 'attacker', groupId, formation: e.target.value as Formation })
          }
        >
          {FORMATIONS.map((f) => (
            <option key={f} value={f}>
              {t(`formation.${f}`)}
            </option>
          ))}
        </select>
        {otherRoutes.length > 0 && (
          <>
            <select value={reroute} aria-label={t('ctl.route')} onChange={(e) => setReroute(e.target.value)}>
              {otherRoutes.map((r) => (
                <option key={r.id} value={r.id}>
                  {routeName(r.id)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="small"
              onClick={() => send({ type: 'rerouteGroup', side: 'attacker', groupId, routeId: reroute })}
            >
              {t('ctl.reroute')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function AbilityRow({
  ability,
  side,
  level,
  snapshot,
  t,
  stageText,
  send,
  routeName,
}: {
  ability: StagePack['catalog']['abilities'][number];
  side: Side;
  level: Level;
  snapshot: MatchSnapshot;
  t: Translate;
  stageText: Translate;
  send(command: MatchCommand): void;
  routeName(id: string): string;
}) {
  const places = level.map.nodes;
  const groups = snapshot.entities.filter(
    (e): e is GroupEntity => e.kind === 'group' && e.state !== 'waiting',
  );
  const [place, setPlace] = useState(places[0]?.id ?? '');
  const [groupId, setGroupId] = useState<number | null>(null);
  const [routeId, setRouteId] = useState(level.routes[0]?.id ?? '');
  const cooldown = snapshot.cooldowns[ability.id] ?? 0;
  const chosenGroup = groups.some((g) => g.id === groupId) ? groupId : (groups[0]?.id ?? null);
  const use = () => {
    const node = places.find((n) => n.id === place);
    const command: MatchCommand = { type: 'useAbility', side, abilityId: ability.id };
    if (ability.target === 'area' && node) Object.assign(command, { x: node.x, z: node.z });
    if (ability.target === 'unit' || ability.target === 'route') {
      if (chosenGroup !== null) Object.assign(command, { groupId: chosenGroup });
    }
    if (ability.target === 'route') Object.assign(command, { routeId });
    send(command);
  };
  return (
    <div className="entity-row" data-testid={`ability-${ability.id}`}>
      <div>
        <strong>{stageText(ability.name)}</strong>{' '}
        <span className="muted">
          {t('ctl.cost', { cost: ability.cost })} · {cooldown > 0 ? formatSeconds(cooldown) : t('ctl.ready')}
        </span>
      </div>
      <div className="row">
        {ability.target === 'area' && (
          <select value={place} aria-label={t('ctl.targetPlace')} onChange={(e) => setPlace(e.target.value)}>
            {places.map((n) => (
              <option key={n.id} value={n.id}>
                {nodeName(n.id)}
              </option>
            ))}
          </select>
        )}
        {(ability.target === 'unit' || ability.target === 'route') && (
          <select
            value={chosenGroup ?? ''}
            aria-label={t('ctl.targetGroup')}
            onChange={(e) => setGroupId(Number(e.target.value))}
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                #{g.id} {g.count > 0 ? `× ${g.count}` : t('ctl.hiddenGroup')}
              </option>
            ))}
          </select>
        )}
        {ability.target === 'route' && (
          <select value={routeId} aria-label={t('ctl.route')} onChange={(e) => setRouteId(e.target.value)}>
            {level.routes.map((r) => (
              <option key={r.id} value={r.id}>
                {routeName(r.id)}
              </option>
            ))}
          </select>
        )}
        <button type="button" className="small primary-small" onClick={use} disabled={cooldown > 0}>
          {t('ctl.use')}
        </button>
      </div>
    </div>
  );
}

function DefenderControls({ pack, level, snapshot, defenderProfileId, t, stageText, send }: Props) {
  const profile = pack.profiles.find((p) => p.id === defenderProfileId);
  const types = pack.catalog.defenses.filter((d) => profile?.defenses.includes(d.id));
  const abilities = pack.catalog.abilities.filter((a) => profile?.abilities.includes(a.id));
  const [typeId, setTypeId] = useState(types[0]?.id ?? '');
  const type = types.find((d) => d.id === typeId);
  const routeNodes = new Set(level.routes.flatMap((r) => r.nodes));
  const spawns = new Set(level.routes.map((r) => r.nodes[0]));
  const places = level.map.nodes.filter((n) => {
    if (!type) return false;
    const onRoute = routeNodes.has(n.id) && !spawns.has(n.id);
    if (type.mobile) return onRoute;
    const routeOk = onRoute && n.id !== level.objective.nodeId;
    if (type.placement === 'buildZone') return n.buildable === true;
    if (type.placement === 'routeNode') return routeOk;
    return n.buildable === true || routeOk;
  });
  const [place, setPlace] = useState('');
  const chosenPlace = places.some((n) => n.id === place) ? place : (places[0]?.id ?? '');
  const assets = snapshot.entities.filter((e): e is DefenseEntity => e.kind === 'defense');
  const visibleGroups = snapshot.entities.filter((e): e is GroupEntity => e.kind === 'group');
  const routeName = (id: string) => {
    const route = level.routes.find((r) => r.id === id);
    return route?.name ? stageText(route.name) : nodeName(id);
  };

  return (
    <section className="side-panel defender" aria-label={t('seat.defender')}>
      <SideSummary snapshot={snapshot} side="defender" t={t} />

      <h3>{t('ctl.build')}</h3>
      <div className="row">
        <select
          value={typeId}
          aria-label={t('ctl.build')}
          onChange={(e) => setTypeId(e.target.value)}
          data-testid="build-type"
        >
          {types.map((d) => (
            <option key={d.id} value={d.id}>
              {stageText(d.name)} ({d.cost})
            </option>
          ))}
        </select>
        <select
          value={chosenPlace}
          aria-label={t('ctl.place')}
          onChange={(e) => setPlace(e.target.value)}
          data-testid="build-place"
        >
          {places.map((n) => (
            <option key={n.id} value={n.id}>
              {nodeName(n.id)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="small primary-small"
          data-testid="build"
          onClick={() =>
            send({ type: 'placeDefense', side: 'defender', defenseTypeId: typeId, nodeId: chosenPlace })
          }
        >
          {t('ctl.build')}
        </button>
      </div>

      <h3>{t('ctl.assets')}</h3>
      {assets.length === 0 && <p className="muted">{t('ctl.noAssets')}</p>}
      {assets.map((asset) => (
        <AssetRow
          key={asset.id}
          asset={asset}
          {...{ pack, level, t, stageText, send }}
          groups={visibleGroups}
          routeNodes={[...routeNodes].filter((id) => !spawns.has(id))}
        />
      ))}

      <h3>{t('ctl.abilities')}</h3>
      {abilities.map((ability) => (
        <AbilityRow
          key={ability.id}
          ability={ability}
          side="defender"
          {...{ level, snapshot, t, stageText, send, routeName }}
        />
      ))}
    </section>
  );
}

function AssetRow({
  asset,
  pack,
  t,
  stageText,
  send,
  groups,
  routeNodes,
}: {
  asset: DefenseEntity;
  pack: StagePack;
  level: Level;
  t: Translate;
  stageText: Translate;
  send(command: MatchCommand): void;
  groups: GroupEntity[];
  routeNodes: string[];
}) {
  const type = pack.catalog.defenses.find((d) => d.id === asset.defenseTypeId);
  const defenseId = asset.id;
  const [target, setTarget] = useState(routeNodes[0] ?? '');
  return (
    <div className="entity-row" data-testid="asset-row">
      <div>
        <strong>{type ? stageText(type.name) : asset.defenseTypeId}</strong>{' '}
        <span className="muted">
          {nodeName(asset.nodeId)} · {t('ctl.level', { level: asset.level })} ·{' '}
          {asset.condition <= 0
            ? t('ctl.disrupted')
            : t('ctl.condition', { condition: Math.round(asset.condition) })}
          {asset.blocking && ` · ${t('ctl.blocking')}`}
        </span>
      </div>
      <div className="row">
        <button
          type="button"
          className="small"
          onClick={() => send({ type: 'upgradeDefense', side: 'defender', defenseId })}
        >
          {t('ctl.upgrade')}
        </button>
        <button
          type="button"
          className="small"
          onClick={() => send({ type: 'repairDefense', side: 'defender', defenseId })}
        >
          {t('ctl.repair')}
        </button>
        <button
          type="button"
          className="small"
          onClick={() => send({ type: 'sellDefense', side: 'defender', defenseId })}
        >
          {t('ctl.sell')}
        </button>
        <select
          value={asset.priority}
          aria-label={t('ctl.priority')}
          onChange={(e) =>
            send({
              type: 'setPriority',
              side: 'defender',
              defenseId,
              priority: e.target.value as TargetPriority,
            })
          }
        >
          {TARGET_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {t(`priority.${p}`)}
            </option>
          ))}
        </select>
        <select
          value={asset.focusGroupId ?? ''}
          aria-label={t('ctl.focus')}
          onChange={(e) =>
            send({
              type: 'focusTarget',
              side: 'defender',
              defenseId,
              groupId: e.target.value === '' ? null : Number(e.target.value),
            })
          }
        >
          <option value="">
            {t('ctl.focus')}: {t('ctl.none')}
          </option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              #{g.id} {g.count > 0 ? `× ${g.count}` : t('ctl.hiddenGroup')}
            </option>
          ))}
        </select>
      </div>
      {asset.mobile && (
        <div className="row">
          <select value={target} aria-label={t('ctl.place')} onChange={(e) => setTarget(e.target.value)}>
            {routeNodes.map((id) => (
              <option key={id} value={id}>
                {nodeName(id)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="small"
            onClick={() =>
              send({
                type: 'orderDefense',
                side: 'defender',
                defenseId,
                order: { type: 'guard', nodeId: target },
              })
            }
          >
            {t('ctl.guard')}
          </button>
          <button
            type="button"
            className="small"
            onClick={() =>
              send({
                type: 'orderDefense',
                side: 'defender',
                defenseId,
                order: { type: 'patrol', nodeIds: [asset.nodeId, target] },
              })
            }
          >
            {t('ctl.patrol')}
          </button>
        </div>
      )}
    </div>
  );
}
