import type { StagePack } from '@gtd/content-schema';
import type { Translate } from '@gtd/i18n';
import {
  TARGET_PRIORITIES,
  type DefenseEntity,
  type GroupEntity,
  type MatchSnapshot,
  type TargetPriority,
} from '@gtd/sim';
import { Art, initials } from '../art/Art';
import { nodeName } from '../level/MatchControls';
import { repairCost, upgradeCost } from './hudState';
import { KeyHint } from './KeyHint';
import { Tooltip } from './Tooltip';

type DefenseType = StagePack['catalog']['defenses'][number];

interface BuildBarProps {
  types: DefenseType[];
  snapshot: MatchSnapshot;
  chosen: string | null;
  compact: boolean;
  t: Translate;
  stageText: Translate;
  onChoose(typeId: string): void;
}

/** Bottom bar of the Defender (spec §15): what can be built, with cost and how many are allowed. */
export function BuildBar({ types, snapshot, chosen, compact, t, stageText, onChoose }: BuildBarProps) {
  const supplies = snapshot.resources.defender ?? 0;
  const own = snapshot.entities.filter((e): e is DefenseEntity => e.kind === 'defense');
  return (
    <section className="hud-panel build-bar" aria-label={t('ctl.build')} data-tutorial="build-bar">
      <div className="build-cards" role="radiogroup" aria-label={t('ctl.build')}>
        {types.map((type, i) => {
          const count = own.filter((d) => d.defenseTypeId === type.id).length;
          const full = type.maxCount !== undefined && count >= type.maxCount;
          const short = supplies < type.cost;
          return (
            <Tooltip
              key={type.id}
              text={t(type.mobile ? 'hud.patrolTip' : type.blocksNode ? 'hud.blockTip' : 'hud.structureTip', {
                name: stageText(type.name),
                cost: type.cost,
                range: type.range,
              })}
            >
              <button
                type="button"
                role="radio"
                aria-checked={chosen === type.id}
                className={`unit-card build-card ${chosen === type.id ? 'selected' : ''} ${short || full ? 'unaffordable' : ''}`}
                onClick={() => onChoose(type.id)}
                data-testid={`build-${type.id}`}
              >
                <Art
                  id={type.icon}
                  alt=""
                  ratio={1}
                  tone="defender"
                  fallback={initials(stageText(type.name))}
                />
                {!compact && <span className="card-name">{stageText(type.name)}</span>}
                <span className="card-cost">{type.cost}</span>
                {type.maxCount !== undefined && (
                  <span className="card-count">
                    {count}/{type.maxCount}
                  </span>
                )}
                <KeyHint action={`build.${i + 1}`} />
              </button>
            </Tooltip>
          );
        })}
      </div>
      {!compact && <p className="hint build-hint">{chosen ? t('hud.buildPick') : t('hud.buildChoose')}</p>}
    </section>
  );
}

interface AssetListProps {
  types: DefenseType[];
  assets: DefenseEntity[];
  selectedId: number | null;
  t: Translate;
  stageText: Translate;
  onSelect(asset: DefenseEntity): void;
}

export function AssetList({ types, assets, selectedId, t, stageText, onSelect }: AssetListProps) {
  return (
    <section className="hud-panel entity-list" aria-label={t('ctl.assets')} data-tutorial="assets">
      <h3>{t('ctl.assets')}</h3>
      {assets.length === 0 && <p className="muted">{t('ctl.noAssets')}</p>}
      <ul>
        {assets.map((asset) => {
          const type = types.find((d) => d.id === asset.defenseTypeId);
          return (
            <li key={asset.id}>
              <button
                type="button"
                className={`entity-item ${asset.id === selectedId ? 'selected' : ''}`}
                aria-pressed={asset.id === selectedId}
                onClick={() => onSelect(asset)}
                data-testid="asset-row"
              >
                <Art
                  id={type?.icon}
                  alt=""
                  ratio={1}
                  tone="defender"
                  className="mini-icon"
                  fallback={initials(type ? stageText(type.name) : '?')}
                />
                <span className="entity-text">
                  <strong>{type ? stageText(type.name) : asset.defenseTypeId}</strong>
                  <span className="muted">
                    {nodeName(asset.nodeId)} · {t('ctl.level', { level: asset.level })}
                    {asset.condition <= 0
                      ? ` · ${t('ctl.disrupted')}`
                      : asset.condition < 100
                        ? ` · ${Math.round(asset.condition)}%`
                        : ''}
                  </span>
                </span>
                {asset.condition < 100 && (
                  <span
                    className="condition"
                    role="meter"
                    aria-valuenow={Math.round(asset.condition)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={t('hud.condition')}
                  >
                    <span style={{ width: `${Math.max(0, asset.condition)}%` }} />
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface AssetOrdersProps {
  asset: DefenseEntity;
  type: DefenseType | undefined;
  groups: GroupEntity[];
  supplies: number;
  mode: 'focus' | 'guard' | 'patrol' | null;
  t: Translate;
  stageText: Translate;
  onUpgrade(): void;
  onRepair(): void;
  onSell(): void;
  onPriority(priority: TargetPriority): void;
  onFocus(): void;
  onClearFocus(): void;
  onGuard(): void;
  onPatrol(): void;
  onClose(): void;
}

/** Orders for the selected asset: upgrade, repair, sell, targeting and, for patrols, where to go. */
export function AssetOrders({
  asset,
  type,
  groups,
  supplies,
  mode,
  t,
  stageText,
  onUpgrade,
  onRepair,
  onSell,
  onPriority,
  onFocus,
  onClearFocus,
  onGuard,
  onPatrol,
  onClose,
}: AssetOrdersProps) {
  const canUpgrade = type !== undefined && asset.level < type.maxLevel;
  const upgrade = type ? upgradeCost(type, asset.level) : 0;
  const repair = type ? repairCost(type, asset.condition) : 0;
  const focused = groups.find((g) => g.id === asset.focusGroupId);
  return (
    <section
      className="hud-panel orders"
      aria-label={t('hud.orders')}
      data-tutorial="asset-orders"
      data-testid="asset-orders"
    >
      <header className="orders-head">
        <strong>{type ? stageText(type.name) : asset.defenseTypeId}</strong>
        <span className="muted">
          {nodeName(asset.nodeId)} · {t('ctl.level', { level: asset.level })} ·{' '}
          {asset.condition <= 0
            ? t('ctl.disrupted')
            : t('ctl.condition', { condition: Math.round(asset.condition) })}
          {asset.blocking && ` · ${t('ctl.blocking')}`}
        </span>
        <button type="button" className="close" aria-label={t('hud.deselect')} onClick={onClose}>
          ×
        </button>
      </header>
      <div className="order-buttons">
        <Tooltip text={t('ctl.tip.upgrade')}>
          <button
            type="button"
            className="order"
            onClick={onUpgrade}
            disabled={!canUpgrade}
            aria-disabled={!canUpgrade || supplies < upgrade}
            data-testid="order-upgrade"
          >
            {canUpgrade ? t('hud.upgradeFor', { cost: upgrade }) : t('hud.maxLevel')}
            <KeyHint action="command.1" />
          </button>
        </Tooltip>
        <Tooltip text={t('ctl.tip.repair')}>
          <button
            type="button"
            className="order"
            onClick={onRepair}
            disabled={asset.condition >= 100}
            data-testid="order-repair"
          >
            {asset.condition >= 100 ? t('ctl.repair') : t('hud.repairFor', { cost: repair })}
            <KeyHint action="command.2" />
          </button>
        </Tooltip>
        <Tooltip text={t('ctl.tip.sell')}>
          <button type="button" className="order" onClick={onSell} data-testid="order-sell">
            {t('hud.sellFor', { refund: Math.round(asset.spent * 0.5) })}
            <KeyHint action="command.3" />
          </button>
        </Tooltip>
      </div>
      <div className="order-buttons">
        <label className="priority">
          {t('ctl.priority')}
          <select
            value={asset.priority}
            onChange={(e) => onPriority(e.target.value as TargetPriority)}
            data-testid="order-priority"
          >
            {TARGET_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {t(`priority.${p}`)}
              </option>
            ))}
          </select>
          <KeyHint action="command.4" />
        </label>
        {focused ? (
          <button type="button" className="order" onClick={onClearFocus}>
            {t('hud.unfocus', { id: focused.id })}
          </button>
        ) : (
          <Tooltip text={t('ctl.tip.focus')}>
            <button
              type="button"
              className={`order ${mode === 'focus' ? 'active' : ''}`}
              onClick={onFocus}
              data-testid="order-focus"
            >
              {t('ctl.focus')}
              <KeyHint action="command.5" />
            </button>
          </Tooltip>
        )}
      </div>
      {asset.mobile && (
        <div className="order-buttons">
          <Tooltip text={t('ctl.tip.guard')}>
            <button
              type="button"
              className={`order ${mode === 'guard' ? 'active' : ''}`}
              onClick={onGuard}
              data-testid="order-guard"
            >
              {t('ctl.guard')}
              <KeyHint action="command.6" />
            </button>
          </Tooltip>
          <Tooltip text={t('ctl.tip.patrol')}>
            <button
              type="button"
              className={`order ${mode === 'patrol' ? 'active' : ''}`}
              onClick={onPatrol}
              data-testid="order-patrol"
            >
              {t('ctl.patrol')}
            </button>
          </Tooltip>
        </div>
      )}
    </section>
  );
}
