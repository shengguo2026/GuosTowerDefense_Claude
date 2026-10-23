import type { Action, Level, StagePack } from '@gtd/content-schema';
import type { Translate } from '@gtd/i18n';
import {
  unitWeight,
  type Formation,
  type GroupEntity,
  type MatchSnapshot,
  type WaveGroupOrder,
} from '@gtd/sim';
import { Art, initials } from '../art/Art';
import { formatSeconds } from '../level/MatchControls';
import { hasHeavyGround, narrowestCrossing, routeNotes } from '../match/ground';
import { ROUTE_COLORS } from '../world/markers';
import { extraSlots, orderKey } from './commandSlots';
import { KeyHint } from './KeyHint';
import { SlotButtons } from './SlotButtons';
import { StatusChips } from './StatusChips';
import { Tooltip } from './Tooltip';

export const FORMATIONS: Formation[] = ['column', 'spread'];
const FORMATION_ICONS: Record<Formation, string> = {
  column: 'ICON-FORMATION-COLUMN',
  spread: 'ICON-FORMATION-SPREAD',
};
/** Most groups in one wave (the simulation allows four). */
export const MAX_DRAFT_GROUPS = 4;

export function routeColor(level: Level, routeId: string): string {
  const index = Math.max(
    0,
    level.routes.findIndex((r) => r.id === routeId),
  );
  return `#${(ROUTE_COLORS[index % ROUTE_COLORS.length] as number).toString(16).padStart(6, '0')}`;
}

export function routeLabel(level: Level, stageText: Translate, routeId: string): string {
  const route = level.routes.find((r) => r.id === routeId);
  return route?.name ? stageText(route.name) : routeId;
}

interface WaveProps {
  pack: StagePack;
  level: Level;
  units: StagePack['catalog']['units'];
  snapshot: MatchSnapshot;
  drafts: WaveGroupOrder[];
  current: number;
  compact: boolean;
  t: Translate;
  stageText: Translate;
  onCurrent(index: number): void;
  onChange(index: number, patch: Partial<WaveGroupOrder>): void;
  onAdd(): void;
  onRemove(index: number): void;
  onLaunch(): void;
}

/**
 * Bottom bar of the Attacker (spec §15): the groups of the next wave with unit, size, formation and route, and the
 * launch button with what the wave costs.
 */
export function WaveBuilder({
  level,
  units,
  snapshot,
  drafts,
  current,
  compact,
  t,
  stageText,
  onCurrent,
  onChange,
  onAdd,
  onRemove,
  onLaunch,
}: WaveProps) {
  const draft = drafts[current] ?? drafts[0];
  if (!draft) return null;
  const unitOf = (id: string) => units.find((u) => u.id === id);
  const capacity = drafts.reduce((sum, d) => sum + (unitOf(d.unitTypeId)?.capacity ?? 0) * d.count, 0);
  const cost = drafts.reduce((sum, d) => sum + (unitOf(d.unitTypeId)?.cost ?? 0) * d.count, 0);
  const launchWait =
    snapshot.phase === 'preparation'
      ? snapshot.preparationRemainingTicks
      : snapshot.launchCooldownRemainingTicks;
  const supplies = snapshot.resources.attacker ?? 0;
  const problem =
    launchWait > 0
      ? t('hud.launchIn', { time: formatSeconds(launchWait) })
      : snapshot.activeWaves >= level.maxActiveWaves
        ? t('reject.tooManyWaves')
        : capacity > snapshot.capacity.remaining
          ? t('reject.notEnoughCapacity')
          : cost > supplies
            ? t('reject.notEnoughResources')
            : null;
  // Terrain Weight and Route Capacity (Elephant): what the chosen route goes through, and whether this group fits
  // its narrowest crossing.
  const weighted = hasHeavyGround(level);
  const notes = routeNotes(level, draft.routeId, t, stageText);
  const narrow = narrowestCrossing(level, draft.routeId);
  const load = (unitOf(draft.unitTypeId)?.capacity ?? 0) * draft.count;
  const squeeze =
    narrow && load > narrow.capacity
      ? t('ground.tooWide', {
          load,
          name: narrow.label ? stageText(narrow.label) : t('ground.crossingName'),
          capacity: narrow.capacity,
        })
      : null;

  return (
    <section
      className="hud-panel wave-builder"
      aria-label={t('ctl.waveBuilder')}
      data-tutorial="wave-builder"
    >
      <div className="wave-tabs" role="tablist" aria-label={t('hud.waveGroups')}>
        {drafts.map((d, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === current}
            className={`wave-tab ${i === current ? 'active' : ''}`}
            style={{ '--route': routeColor(level, d.routeId) } as React.CSSProperties}
            onClick={() => onCurrent(i)}
            data-testid="wave-row"
          >
            {d.count} × {stageText(unitOf(d.unitTypeId)?.name ?? d.unitTypeId)}
            {drafts.length > 1 && (
              <span
                role="button"
                tabIndex={0}
                className="remove"
                aria-label={t('ctl.removeGroup')}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove(i);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onRemove(i);
                }}
              >
                ×
              </span>
            )}
          </button>
        ))}
        {drafts.length < MAX_DRAFT_GROUPS && (
          <button type="button" className="wave-tab add" onClick={onAdd} data-testid="add-group">
            + {t('ctl.addGroup')}
            <KeyHint action="wave.addGroup" />
          </button>
        )}
      </div>

      <div className="wave-editor">
        <div className="unit-cards" role="radiogroup" aria-label={t('ctl.unit')}>
          {units.map((unit, i) => {
            const chosen = unit.id === draft.unitTypeId;
            return (
              <Tooltip
                key={unit.id}
                text={
                  t('hud.unitTip', {
                    name: stageText(unit.name),
                    cost: unit.cost,
                    capacity: unit.capacity,
                    speed: unit.speed,
                  }) + (weighted ? ` · ${t(`ground.weight.${unitWeight(unit)}`)}` : '')
                }
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  className={`unit-card ${chosen ? 'selected' : ''}`}
                  onClick={() => onChange(current, { unitTypeId: unit.id })}
                  data-testid={`unit-${unit.id}`}
                >
                  <Art
                    id={unit.icon}
                    alt=""
                    ratio={1}
                    tone="attacker"
                    fallback={initials(stageText(unit.name))}
                  />
                  {!compact && <span className="card-name">{stageText(unit.name)}</span>}
                  <span className="card-cost">{unit.cost}</span>
                  <KeyHint action={`unit.${i + 1}`} />
                </button>
              </Tooltip>
            );
          })}
        </div>

        <div className="counter" aria-label={t('ctl.count')}>
          <button
            type="button"
            className="step"
            aria-label={t('hud.fewer')}
            onClick={() => onChange(current, { count: Math.max(1, draft.count - 1) })}
          >
            −
          </button>
          <input
            type="number"
            min={1}
            max={99}
            value={draft.count}
            aria-label={t('ctl.count')}
            onChange={(e) =>
              onChange(current, { count: Math.min(99, Math.max(1, Math.round(Number(e.target.value) || 1))) })
            }
            data-testid="wave-count"
          />
          <button
            type="button"
            className="step"
            aria-label={t('hud.more')}
            onClick={() => onChange(current, { count: Math.min(99, draft.count + 1) })}
          >
            +
          </button>
        </div>

        <div className="formation-toggle" role="radiogroup" aria-label={t('ctl.formation')}>
          {FORMATIONS.map((formation) => (
            <Tooltip key={formation} text={t(`formation.tip.${formation}`)}>
              <button
                type="button"
                role="radio"
                aria-checked={draft.formation === formation}
                className={`formation ${draft.formation === formation ? 'selected' : ''}`}
                onClick={() => onChange(current, { formation })}
                data-testid={`formation-${formation}`}
              >
                <Art id={FORMATION_ICONS[formation]} alt="" ratio={1} tone="attacker" className="mini-icon" />
                {!compact && t(`formation.${formation}`)}
              </button>
            </Tooltip>
          ))}
          <KeyHint action="wave.formation" />
        </div>

        <div className="route-chips" role="radiogroup" aria-label={t('ctl.route')}>
          {level.routes.map((route, i) => (
            <button
              key={route.id}
              type="button"
              role="radio"
              aria-checked={draft.routeId === route.id}
              className={`route-chip ${draft.routeId === route.id ? 'selected' : ''}`}
              style={{ '--route': routeColor(level, route.id) } as React.CSSProperties}
              onClick={() => onChange(current, { routeId: route.id })}
              data-testid={`route-${route.id}`}
            >
              {routeLabel(level, stageText, route.id)}
              <KeyHint action={`route.${i + 1}`} />
            </button>
          ))}
        </div>
        {(notes.length > 0 || squeeze) && (
          <p className={`route-notes ${squeeze ? 'warn' : ''}`} data-testid="route-notes">
            {squeeze ?? notes.join(' · ')}
          </p>
        )}

        {!compact && (
          <label className="delay">
            {t('ctl.delay')}
            <input
              type="number"
              min={0}
              max={30}
              value={draft.delaySeconds}
              onChange={(e) =>
                onChange(current, { delaySeconds: Math.min(30, Math.max(0, Number(e.target.value) || 0)) })
              }
            />
          </label>
        )}
      </div>

      <div className="launch-row">
        <span className={`launch-status ${problem ? 'waiting' : 'ready'}`} data-testid="launch-status">
          {problem ?? t('hud.launchReady')}
        </span>
        <button
          type="button"
          className="action launch"
          onClick={onLaunch}
          data-testid="launch-wave"
          aria-describedby="launch-status"
        >
          {t('ctl.launch', { capacity, cost })}
          <KeyHint action="wave.launch" />
        </button>
      </div>
    </section>
  );
}

interface GroupListProps {
  units: StagePack['catalog']['units'];
  level: Level;
  groups: GroupEntity[];
  selectedId: number | null;
  t: Translate;
  stageText: Translate;
  onSelect(group: GroupEntity): void;
}

/** Left panel of the Attacker: the groups in the field. */
export function GroupList({ units, level, groups, selectedId, t, stageText, onSelect }: GroupListProps) {
  return (
    <section className="hud-panel entity-list" aria-label={t('ctl.groups')} data-tutorial="groups">
      <h3>{t('ctl.groups')}</h3>
      {groups.length === 0 && <p className="muted">{t('ctl.noGroups')}</p>}
      <ul>
        {groups.map((group) => {
          const unit = units.find((u) => u.id === group.unitTypeId);
          return (
            <li key={group.id}>
              <button
                type="button"
                className={`entity-item ${group.id === selectedId ? 'selected' : ''}`}
                aria-pressed={group.id === selectedId}
                onClick={() => onSelect(group)}
                data-testid="group-row"
              >
                <Art
                  id={unit?.icon}
                  alt=""
                  ratio={1}
                  tone="attacker"
                  className="mini-icon"
                  fallback={initials(unit ? stageText(unit.name) : '?')}
                />
                <span className="entity-text">
                  <strong>
                    {group.count} × {unit ? stageText(unit.name) : group.unitTypeId}
                  </strong>
                  <span className="muted">
                    <span
                      className="route-dot"
                      style={{ background: routeColor(level, group.routeId) }}
                      aria-hidden="true"
                    />
                    {routeLabel(level, stageText, group.routeId)} · {t(`state.${group.state}`)}
                  </span>
                  <StatusChips statuses={group.statuses} t={t} />
                </span>
                <span className={`detection ${group.detection}`} title={t(`detection.${group.detection}`)}>
                  {group.detection === 'unknown' ? '◌' : '◉'}
                  <span className="visually-hidden">{t(`detection.${group.detection}`)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface GroupOrdersProps {
  group: GroupEntity;
  level: Level;
  units: StagePack['catalog']['units'];
  rerouting: boolean;
  /** The profile's command slots (keys X C V B N M) and the snapshot for their cost and recharge. */
  slots: Action[];
  snapshot: MatchSnapshot;
  t: Translate;
  stageText: Translate;
  onSlot(action: Action): void;
  onHold(): void;
  onAdvance(): void;
  onRetreat(): void;
  onReroute(routeId?: string): void;
  onFormation(formation: Formation): void;
  onClose(): void;
}

/**
 * Orders for the selected group: the base orders every Attacker has, then the profile's own command slots. Keys follow
 * the profile's slot order (X C V B N M), so a profile that leaves an order off its keys still has the button.
 */
export function GroupOrders({
  group,
  level,
  units,
  rerouting,
  slots,
  snapshot,
  t,
  stageText,
  onSlot,
  onHold,
  onAdvance,
  onRetreat,
  onReroute,
  onFormation,
  onClose,
}: GroupOrdersProps) {
  const unit = units.find((u) => u.id === group.unitTypeId);
  const otherRoutes = level.routes.filter((r) => r.id !== group.routeId);
  const holding = group.state === 'holding';
  return (
    <section
      className="hud-panel orders"
      aria-label={t('hud.orders')}
      data-tutorial="group-orders"
      data-testid="group-orders"
    >
      <header className="orders-head">
        <strong>
          {group.count} × {unit ? stageText(unit.name) : group.unitTypeId}
        </strong>
        <span className="muted">
          {routeLabel(level, stageText, group.routeId)} · {t(`state.${group.state}`)}
          {group.holdAtJunction && !holding && ` · ${t('hud.holdingNext')}`}
        </span>
        <StatusChips statuses={group.statuses} t={t} />
        <button type="button" className="close" aria-label={t('hud.deselect')} onClick={onClose}>
          ×
        </button>
      </header>
      <div className="order-buttons">
        <Tooltip text={t('ctl.tip.hold')}>
          <button type="button" className="order" onClick={onHold} data-testid="order-hold">
            {t('ctl.hold')}
            <KeyHint action={orderKey(slots, 'hold')} />
          </button>
        </Tooltip>
        <Tooltip text={t('ctl.tip.advance')}>
          <button type="button" className="order" onClick={onAdvance} data-testid="order-advance">
            {t('ctl.advance')}
            <KeyHint action={orderKey(slots, 'advance')} />
          </button>
        </Tooltip>
        <Tooltip text={t('ctl.tip.retreat')}>
          <button type="button" className="order" onClick={onRetreat} data-testid="retreat">
            {t('ctl.retreat')}
            <KeyHint action={orderKey(slots, 'retreat')} />
          </button>
        </Tooltip>
        <Tooltip text={t('ctl.tip.reroute')}>
          <button
            type="button"
            className={`order ${rerouting ? 'active' : ''}`}
            onClick={() => onReroute()}
            disabled={otherRoutes.length === 0}
            data-testid="order-reroute"
          >
            {t('ctl.reroute')}
            <KeyHint action={orderKey(slots, 'reroute')} />
          </button>
        </Tooltip>
        <button
          type="button"
          className="order"
          onClick={() => onFormation(group.formation === 'column' ? 'spread' : 'column')}
          data-testid="order-formation"
        >
          {t(`formation.${group.formation === 'column' ? 'spread' : 'column'}`)}
          <KeyHint action={orderKey(slots, 'formation')} />
        </button>
      </div>
      <SlotButtons
        slots={slots}
        shown={extraSlots(slots, 'attacker')}
        side="attacker"
        snapshot={snapshot}
        t={t}
        stageText={stageText}
        active={(action) => action.order === 'dismantle' && group.focusDefenseId !== null}
        label={(action) =>
          action.order === 'dismantle' && group.focusDefenseId !== null ? t('hud.stopDismantling') : undefined
        }
        onUse={onSlot}
      />
      {rerouting && (
        <div className="route-chips" role="group" aria-label={t('ctl.route')}>
          {otherRoutes.map((route) => (
            <button
              key={route.id}
              type="button"
              className="route-chip"
              style={{ '--route': routeColor(level, route.id) } as React.CSSProperties}
              onClick={() => onReroute(route.id)}
            >
              {routeLabel(level, stageText, route.id)}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
