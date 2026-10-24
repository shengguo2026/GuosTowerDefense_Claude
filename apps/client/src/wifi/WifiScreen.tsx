import type { Translate } from '@gtd/i18n';
import type { NearbyGames, NetworkInfo } from '@gtd/protocol';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { FirewallExplainer } from '../menu/ShareScreen';
import type { WifiRoom } from './useWifiRoom';

interface Props {
  t: Translate;
  wifi: WifiRoom;
  network: NetworkInfo | null;
  /** This browser runs on the PC that hosts the game (with mouse and keyboard). */
  pc: boolean;
  /** The name the player goes by (the PC's from its settings, a tablet's or phone's own). */
  name: string;
  /** A room code from the QR code (`?join=247433`): join straight away. */
  code?: string;
  onName(name: string): void;
  onBack(): void;
}

/** `247 433`, `247-433` or `247433` → `247433`. */
export function cleanCode(text: string): string {
  return text.replace(/\D/g, '').slice(0, 6);
}

/**
 * Wi-Fi play (spec §6.1, §14): the PC hosts a game (the Windows firewall explainer comes first, once), a tablet or phone
 * joins it with the room code or the QR code. On a PC, a game on another PC is found by its address or by listening
 * for the PCs in the network that announce their games.
 */
export function WifiScreen({ t, wifi, network, pc, name, code: initialCode, onName, onBack }: Props) {
  const [code, setCode] = useState(initialCode ?? '');
  const [ownName, setOwnName] = useState(name);
  const [explaining, setExplaining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const host = network?.host === true && pc;

  // Scanned the QR code: join at once.
  const [autoJoined, setAutoJoined] = useState(false);
  useEffect(() => {
    if (autoJoined || !initialCode || initialCode.length !== 6) return;
    setAutoJoined(true);
    wifi.join(initialCode, name.trim());
  }, [autoJoined, initialCode, name, wifi]);

  const openRoom = async () => {
    setBusy(true);
    setFailed(false);
    try {
      if (!network?.sharing) await api.setSharing(true);
      onName(ownName.trim());
      wifi.hostRoom(ownName.trim());
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
      setExplaining(false);
    }
  };
  const hostGame = () => {
    if (network && !network.sharing && network.windows && !network.firewallExplained) setExplaining(true);
    else void openRoom();
  };
  const join = () => {
    onName(ownName.trim());
    wifi.join(code, ownName.trim());
  };

  return (
    <div className="screen wifi-screen" data-testid="wifi-screen">
      <header className="screen-header">
        <button
          type="button"
          className="hud-button"
          onClick={explaining ? () => setExplaining(false) : onBack}
          data-testid="wifi-back"
        >
          <span aria-hidden="true">‹</span> {t('level.back')}
        </button>
        <h1>{explaining ? t('share.firewall.title') : t('wifi.title')}</h1>
      </header>

      {explaining ? (
        <FirewallExplainer t={t} busy={busy} onContinue={() => void openRoom()} />
      ) : (
        <div className="wifi-body">
          <label className="field name-field wifi-name">
            <span>{t('wifi.yourName')}</span>
            <input
              type="text"
              value={ownName}
              maxLength={24}
              placeholder={host ? t('wifi.hostDefault') : t('wifi.guestDefault')}
              onChange={(event) => setOwnName(event.target.value)}
              data-testid="wifi-name"
            />
          </label>
          {host && (
            <section className="setup-section wifi-card" data-testid="wifi-host-card">
              <h2>{t('wifi.host.title')}</h2>
              <p>{t('wifi.host.text')}</p>
              <ul className="share-facts">
                <li>{t('wifi.host.fact.code')}</li>
                <li>{t('wifi.host.fact.save')}</li>
                <li>{t('wifi.host.fact.away')}</li>
              </ul>
              <button
                type="button"
                className="action launch"
                disabled={busy}
                onClick={hostGame}
                data-testid="wifi-host"
              >
                {t('wifi.host.button')}
              </button>
              {failed && <p className="error">{t('share.error')}</p>}
            </section>
          )}
          <section className="setup-section wifi-card" data-testid="wifi-join-card">
            <h2>{t('wifi.join.title')}</h2>
            <p>
              {host
                ? t('wifi.join.textPc')
                : network?.room
                  ? t('wifi.join.textOpen')
                  : t('wifi.join.textNone')}
            </p>
            <form
              className="wifi-code-row"
              onSubmit={(event) => {
                event.preventDefault();
                if (code.length === 6) join();
              }}
            >
              <label className="field">
                <span>{t('wifi.join.code')}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  className="code-input"
                  value={code.length > 3 ? `${code.slice(0, 3)} ${code.slice(3)}` : code}
                  placeholder="000 000"
                  maxLength={7}
                  onChange={(event) => setCode(cleanCode(event.target.value))}
                  data-testid="wifi-code"
                />
              </label>
              <button
                type="submit"
                className="action launch"
                disabled={code.length !== 6 || wifi.rejoining}
                data-testid="wifi-join"
              >
                {wifi.rejoining ? t('wifi.join.rejoining') : t('wifi.join.button')}
              </button>
            </form>
            {wifi.error && wifi.error !== 'closed' && (
              <p className="error" role="alert" data-testid="wifi-error">
                {t(`wifi.error.${wifi.error}`)}
              </p>
            )}
            {wifi.error === 'closed' && (
              <p className="warning" role="status" data-testid="wifi-closed">
                {t('wifi.error.closed')}
              </p>
            )}
            {host && <OtherPc t={t} />}
          </section>
        </div>
      )}
    </div>
  );
}

/** How often the list of games on other PCs is refreshed while it is open. */
const NEARBY_REFRESH_MS = 2500;

/** A game on another PC: its address typed in, or found among the PCs that announce their games (discovery). */
function OtherPc({ t }: { t: Translate }) {
  const [address, setAddress] = useState('');
  const [nearby, setNearby] = useState<NearbyGames | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!searching) return;
    let cancelled = false;
    const look = () =>
      api.nearby().then(
        (found) => !cancelled && setNearby(found),
        () => !cancelled && setNearby({ listening: false, games: [] }),
      );
    void look();
    const timer = window.setInterval(() => void look(), NEARBY_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [searching]);

  const go = (target: string) => {
    const withScheme = /^https?:\/\//.test(target) ? target : `http://${target}`;
    try {
      const url = new URL(withScheme);
      if (!url.port) url.port = '3001';
      url.pathname = '/';
      url.search = '?wifi=join';
      location.href = url.toString();
    } catch {
      // Not an address: nothing to open.
    }
  };

  return (
    <details className="share-help wifi-other" data-testid="wifi-other-pc">
      <summary>{t('wifi.other.title')}</summary>
      <p className="hint">{t('wifi.other.text')}</p>
      <form
        className="wifi-code-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (address.trim()) go(address.trim());
        }}
      >
        <label className="field">
          <span>{t('wifi.other.address')}</span>
          <input
            type="text"
            value={address}
            placeholder="192.168.1.20:3001"
            onChange={(event) => setAddress(event.target.value)}
            data-testid="wifi-address"
          />
        </label>
        <button type="submit" className="action secondary" disabled={!address.trim()}>
          {t('wifi.other.open')}
        </button>
      </form>
      <button
        type="button"
        className="action secondary"
        onClick={() => setSearching(true)}
        disabled={searching}
        data-testid="wifi-search"
      >
        {searching ? t('wifi.other.searching') : t('wifi.other.search')}
      </button>
      {searching && nearby && (
        <div className="wifi-nearby" data-testid="wifi-nearby">
          {!nearby.listening && <p className="hint">{t('wifi.other.cannotListen')}</p>}
          {nearby.listening && nearby.games.length === 0 && <p className="hint">{t('wifi.other.none')}</p>}
          {nearby.games.map((game) => (
            <button key={game.address} type="button" className="chip" onClick={() => go(game.address)}>
              {game.hostName ? `${game.hostName} · ` : ''}
              {game.address.replace(/^http:\/\//, '').replace(/\/$/, '')}
            </button>
          ))}
          <p className="hint">{t('wifi.other.firewall')}</p>
        </div>
      )}
    </details>
  );
}
