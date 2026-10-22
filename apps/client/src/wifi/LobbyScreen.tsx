import { DIFFICULTIES } from '@gtd/ai';
import type { StagePack } from '@gtd/content-schema';
import { createTranslator, type Language, type Translate } from '@gtd/i18n';
import { formatRoomCode, joinUrl, type Progress, type RoomSlot, type StageSummary } from '@gtd/protocol';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Art, initials } from '../art/Art';
import { QrCode } from '../menu/QrCode';
import { levelUnlocked } from '../menu/SinglePlayerSetup';
import type { WifiRoom } from './useWifiRoom';

interface Props {
  t: Translate;
  language: Language;
  stages: StageSummary[];
  wifi: WifiRoom & { room: NonNullable<WifiRoom['room']> };
  onLeave(): void;
}

/** A person's name, or what to call them while they have not given one. */
export function slotName(slot: RoomSlot, t: Translate): string {
  if (slot.controller === 'ai') return t('wifi.computer');
  if (!slot.playerId) return t('wifi.open');
  return slot.name || (slot.host ? t('wifi.hostDefault') : t('wifi.guestDefault'));
}

/**
 * The Wi-Fi lobby (spec §14): Attacker and Defender slots with each person's profile and Ready, the computer for an
 * empty slot, and how to join (QR code, room code, address with the actual port). The host picks stage, level and the
 * computer's difficulty from the PC's unlocks, moves the players and starts the match once everyone is ready.
 */
export function LobbyScreen({ t, language, stages, wifi, onLeave }: Props) {
  const { room, host, playerId } = wifi;
  const [pack, setPack] = useState<StagePack | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [address, setAddress] = useState(0);
  const stageText = useMemo(() => (pack ? createTranslator(language, pack.texts) : null), [pack, language]);
  const mine = room.slots.find((slot) => slot.playerId === playerId);

  useEffect(() => {
    api.progress().then(setProgress, () => setProgress(null));
  }, []);
  useEffect(() => {
    let cancelled = false;
    api.stage(room.stageId).then(
      (loaded) => !cancelled && setPack(loaded),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [room.stageId]);

  const shown = room.addresses[Math.min(address, room.addresses.length - 1)];
  const short = (url: string) => url.replace(/^http:\/\//, '').replace(/\/$/, '');
  const waitingFor = room.slots.find(
    (slot) => slot.controller === 'human' && (!slot.playerId || (!slot.ready && !slot.host)),
  );
  const canStart = host && !waitingFor;
  const playable = stages.filter((stage) => !stage.devOnly || stage.id === room.stageId);

  const slotCard = (slot: RoomSlot) => {
    const own = slot.playerId !== null && slot.playerId === playerId;
    const editable = (own && !slot.ready) || (host && slot.controller === 'ai');
    const profiles = pack?.profiles.filter((profile) => profile.side === slot.side) ?? [];
    const current = profiles.find((profile) => profile.id === slot.profileId);
    return (
      <article
        key={slot.slotId}
        className={`lobby-slot ${slot.side} ${own ? 'own' : ''} ${slot.ready ? 'ready' : ''}`}
        data-testid={`slot-${slot.slotId}`}
      >
        <header>
          <span className={`badge ${slot.side}`}>{t(`seat.${slot.side}`)}</span>
          <strong className="lobby-name" data-testid={`slot-${slot.slotId}-name`}>
            {slotName(slot, t)}
          </strong>
          {own && <span className="lobby-you">{t('wifi.you')}</span>}
          {slot.host && <span className="lobby-tag">{t('wifi.hostTag')}</span>}
          {slot.playerId && (
            <span
              className={`lobby-dot ${slot.connected ? 'on' : ''}`}
              title={slot.connected ? t('wifi.connected') : t('wifi.away')}
              aria-label={slot.connected ? t('wifi.connected') : t('wifi.away')}
            />
          )}
          <span className={`lobby-ready ${slot.ready ? 'on' : ''}`} data-testid={`slot-${slot.slotId}-ready`}>
            {slot.controller === 'ai'
              ? t('wifi.alwaysReady')
              : slot.ready
                ? t('wifi.ready')
                : slot.playerId
                  ? slot.host
                    ? t('wifi.startsWhenReady')
                    : t('wifi.notReady')
                  : t('wifi.waitingToJoin')}
          </span>
        </header>
        {!slot.connected && slot.playerId && <p className="hint">{t('wifi.awayHint')}</p>}
        <div className="lobby-profiles" role="radiogroup" aria-label={t('setup.profile')}>
          {profiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              role="radio"
              aria-checked={profile.id === slot.profileId}
              className={`lobby-profile ${slot.side} ${profile.id === slot.profileId ? 'selected' : ''}`}
              disabled={!editable}
              onClick={() =>
                wifi.choose(own ? { profileId: profile.id } : { slotId: slot.slotId, profileId: profile.id })
              }
              data-testid={`slot-${slot.slotId}-profile-${profile.id}`}
            >
              <Art
                id={profile.portrait}
                alt=""
                ratio={1}
                tone={slot.side}
                fallback={stageText ? initials(stageText(profile.name)) : ''}
                className="portrait"
              />
              <span>{stageText?.(profile.name)}</span>
            </button>
          ))}
        </div>
        {current && stageText && (
          <p className="lobby-passive muted">
            {stageText(current.passive.name)}: {stageText(current.passive.description)}
          </p>
        )}
        {host && !slot.playerId && (
          <div className="row lobby-slot-actions">
            <button
              type="button"
              className={`chip ${slot.controller === 'human' ? 'selected' : ''}`}
              aria-pressed={slot.controller === 'human'}
              onClick={() => wifi.slotController(slot.slotId, 'human')}
              data-testid={`slot-${slot.slotId}-human`}
            >
              {t('wifi.slot.human')}
            </button>
            <button
              type="button"
              className={`chip ${slot.controller === 'ai' ? 'selected' : ''}`}
              aria-pressed={slot.controller === 'ai'}
              onClick={() => wifi.slotController(slot.slotId, 'ai')}
              data-testid={`slot-${slot.slotId}-ai`}
            >
              {t('wifi.slot.ai')}
            </button>
          </div>
        )}
        {!host && !own && slot.controller === 'human' && !slot.playerId && (
          <button type="button" className="action secondary" onClick={() => wifi.takeSlot(slot.slotId)}>
            {t('wifi.slot.take')}
          </button>
        )}
      </article>
    );
  };

  return (
    <div className="screen lobby-screen" data-testid="lobby">
      <header className="screen-header">
        <button type="button" className="hud-button" onClick={onLeave} data-testid="lobby-leave">
          <span aria-hidden="true">‹</span> {host ? t('wifi.close') : t('wifi.leave')}
        </button>
        <h1>{t('wifi.lobby')}</h1>
        <span className="lobby-code-chip" data-testid="lobby-code-chip">
          {t('wifi.roomCode')} <strong>{formatRoomCode(room.code)}</strong>
        </span>
      </header>

      <div className="lobby-body">
        <section className="setup-section lobby-slots" aria-label={t('wifi.players')}>
          <div className="lobby-slot-row">{room.slots.map(slotCard)}</div>
          {host && (
            <button type="button" className="action secondary" onClick={wifi.swap} data-testid="lobby-swap">
              ⇄ {t('wifi.swap')}
            </button>
          )}
        </section>

        {host && (
          <section className="setup-section lobby-join" data-testid="lobby-join">
            <h2>{t('wifi.joinHere')}</h2>
            {shown ? (
              <>
                <QrCode
                  text={joinUrl(shown, room.code)}
                  label={t('share.qrLabel', { address: short(shown) })}
                />
                <p className="share-address" data-testid="lobby-address">
                  {short(shown)}
                </p>
              </>
            ) : (
              <p className="warning" data-testid="lobby-no-network">
                {t('share.noNetwork')}
              </p>
            )}
            <p className="lobby-code" data-testid="lobby-code">
              <span>{t('wifi.roomCode')}</span>
              <strong>{formatRoomCode(room.code)}</strong>
            </p>
            <p className="hint">{t('wifi.joinSteps')}</p>
            {room.addresses.length > 1 && (
              <div className="card-row share-addresses">
                {room.addresses.map((option, index) => (
                  <button
                    key={option}
                    type="button"
                    className={`chip ${option === shown ? 'selected' : ''}`}
                    aria-pressed={option === shown}
                    onClick={() => setAddress(index)}
                  >
                    {short(option)}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        <section className="setup-section lobby-level" aria-labelledby="lobby-level">
          <h2 id="lobby-level">{t('setup.level')}</h2>
          {host ? (
            <>
              {playable.length > 1 && (
                <div className="card-row">
                  {playable.map((stage) => (
                    <button
                      key={stage.id}
                      type="button"
                      className={`chip ${stage.id === room.stageId ? 'selected' : ''}`}
                      aria-pressed={stage.id === room.stageId}
                      onClick={() => {
                        if (stage.id === room.stageId) return;
                        void api.stage(stage.id).then((next) => {
                          const first = next.levels.find((l) => levelUnlocked(next, l.id, progress));
                          if (first) wifi.settings(stage.id, first.id, room.difficulty);
                        });
                      }}
                    >
                      {stage.title[language]}
                    </button>
                  ))}
                </div>
              )}
              <div className="card-row lobby-levels">
                {pack?.levels.map((level, index) => (
                  <button
                    key={level.id}
                    type="button"
                    className={`pick-card level ${level.id === room.levelId ? 'selected' : ''}`}
                    aria-pressed={level.id === room.levelId}
                    disabled={!levelUnlocked(pack, level.id, progress)}
                    onClick={() => wifi.settings(room.stageId, level.id, room.difficulty)}
                    data-testid={`lobby-level-${level.id}`}
                  >
                    <strong>
                      {index + 1}. {stageText?.(level.title)}
                    </strong>
                    {!levelUnlocked(pack, level.id, progress) && (
                      <span className="lock">{t('setup.locked')}</span>
                    )}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p data-testid="lobby-level-name">
              <strong>
                {stages.find((s) => s.id === room.stageId)?.title[language]}
                {pack &&
                  stageText &&
                  ` · ${stageText(pack.levels.find((l) => l.id === room.levelId)?.title ?? '')}`}
              </strong>
            </p>
          )}
          <h3>{t('wifi.difficulty')}</h3>
          <div className="difficulty-picker" role="radiogroup" aria-label={t('wifi.difficulty')}>
            {DIFFICULTIES.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={room.difficulty === option}
                className={`difficulty ${room.difficulty === option ? 'active' : ''}`}
                disabled={!host}
                onClick={() => wifi.settings(room.stageId, room.levelId, option)}
                data-testid={`lobby-difficulty-${option}`}
              >
                {t(`difficulty.${option}`)}
              </button>
            ))}
          </div>
          <p className="hint">{t('wifi.difficultyHint')}</p>
          {!host && <p className="hint">{t('wifi.hostPicks')}</p>}
        </section>
      </div>

      <footer className="screen-footer lobby-footer">
        <p className="lobby-status" role="status" data-testid="lobby-status">
          {host
            ? waitingFor
              ? waitingFor.playerId
                ? t('wifi.status.waitReady', { name: slotName(waitingFor, t) })
                : t('wifi.status.waitJoin')
              : t('wifi.status.canStart')
            : mine?.ready
              ? t('wifi.status.waitHost')
              : t('wifi.status.getReady')}
        </p>
        {wifi.error && wifi.error !== 'closed' && (
          <p className="error" role="alert">
            {t(`wifi.error.${wifi.error}`)}
          </p>
        )}
        {host ? (
          <button
            type="button"
            className="action launch"
            disabled={!canStart}
            onClick={wifi.start}
            data-testid="lobby-start"
          >
            {t('wifi.start')}
          </button>
        ) : (
          <button
            type="button"
            className={`action ${mine?.ready ? 'secondary' : 'launch'}`}
            disabled={!mine}
            onClick={() => wifi.ready(!mine?.ready)}
            data-testid="lobby-ready"
          >
            {mine?.ready ? t('wifi.unready') : t('wifi.getReady')}
          </button>
        )}
      </footer>
    </div>
  );
}
