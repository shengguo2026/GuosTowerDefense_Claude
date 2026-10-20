import type { Translate } from '@gtd/i18n';
import type { NetworkInfo } from '@gtd/protocol';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { QrCode } from './QrCode';

interface Props {
  t: Translate;
  onBack(): void;
}

/** How often the screen asks how many phones and tablets are connected. */
const REFRESH_MS = 3000;

/**
 * "Play on tablet or phone" (spec §3): opens the game on this PC to phones and tablets in the same Wi-Fi and shows the
 * QR code and the address to open there. The first time on Windows, one screen explains the firewall question that
 * Windows is about to ask (G14), before the game opens to the network.
 */
export function ShareScreen({ t, onBack }: Props) {
  const [info, setInfo] = useState<NetworkInfo | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [chosen, setChosen] = useState(0);

  const refresh = useCallback(() => {
    api.network().then(
      (next) => {
        setInfo(next);
        setError(false);
      },
      () => setError(true),
    );
  }, []);
  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const setSharing = async (sharing: boolean) => {
    setBusy(true);
    try {
      setInfo(await api.setSharing(sharing));
      setExplaining(false);
      setChosen(0);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const open = () => {
    if (info?.windows && !info.firewallExplained) setExplaining(true);
    else void setSharing(true);
  };

  const address = info?.addresses[Math.min(chosen, info.addresses.length - 1)];
  const shortAddress = address?.replace(/^http:\/\//, '').replace(/\/$/, '');

  return (
    <div className="screen share-screen" data-testid="share-screen">
      <header className="screen-header">
        <button
          type="button"
          className="hud-button"
          onClick={explaining ? () => setExplaining(false) : onBack}
          data-testid="share-back"
        >
          <span aria-hidden="true">‹</span> {t('level.back')}
        </button>
        <h1>{explaining ? t('share.firewall.title') : t('share.title')}</h1>
      </header>

      {explaining ? (
        <FirewallExplainer t={t} busy={busy} onContinue={() => void setSharing(true)} />
      ) : !info ? (
        <section className="setup-section share-card">
          <p>{error ? t('share.error') : t('connection.connecting')}</p>
        </section>
      ) : !info.sharing ? (
        <section className="setup-section share-card share-intro" data-testid="share-off">
          <h2>{t('share.offTitle')}</h2>
          <p>{t('share.offText')}</p>
          <ul className="share-facts">
            <li>{t('share.fact.single')}</li>
            <li>{t('share.fact.save')}</li>
            <li>{t('share.fact.local')}</li>
          </ul>
          <button
            type="button"
            className="action launch"
            disabled={busy}
            onClick={open}
            data-testid="share-open"
          >
            {t('share.open')}
          </button>
          {error && <p className="error">{t('share.error')}</p>}
        </section>
      ) : (
        <div className="share-body" data-testid="share-on">
          <section className="setup-section share-card share-code">
            {address && shortAddress ? (
              <>
                <QrCode text={address} label={t('share.qrLabel', { address: shortAddress })} />
                <p className="share-address" data-testid="share-address">
                  {shortAddress}
                </p>
              </>
            ) : (
              <p className="warning" data-testid="share-no-network">
                {t('share.noNetwork')}
              </p>
            )}
            <p className={`share-guests ${info.guests > 0 ? 'on' : ''}`} data-testid="share-guests">
              <span className="dot" aria-hidden="true" />
              {info.guests > 0 ? t('share.guests', { count: info.guests }) : t('share.noGuests')}
            </p>
          </section>
          <section className="setup-section share-card share-steps">
            <h2>{t('share.stepsTitle')}</h2>
            <ol>
              <li>{t('share.step.wifi')}</li>
              <li>{t('share.step.scan')}</li>
              <li>{t('share.step.play')}</li>
            </ol>
            {info.failed.length > 0 && (
              <p className="warning">{t('share.failed', { addresses: info.failed.join(', ') })}</p>
            )}
            {info.addresses.length > 1 && (
              <div className="share-addresses">
                <p className="hint">{t('share.otherAddresses')}</p>
                <div className="card-row">
                  {info.addresses.map((option, index) => (
                    <button
                      key={option}
                      type="button"
                      className={`chip ${option === address ? 'selected' : ''}`}
                      aria-pressed={option === address}
                      onClick={() => setChosen(index)}
                    >
                      {option.replace(/^http:\/\//, '').replace(/\/$/, '')}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <details className="share-help">
              <summary>{t('share.help.title')}</summary>
              <ul>
                <li>{t('share.help.sameWifi')}</li>
                {info.windows && <li>{t('share.help.private')}</li>}
                {info.windows && <li>{t('share.help.firewall')}</li>}
                <li>{t('share.help.keepOpen')}</li>
              </ul>
            </details>
            <p className="hint">{info.fixed ? t('share.fixed') : t('share.remembered')}</p>
            {!info.fixed && (
              <button
                type="button"
                className="action secondary"
                disabled={busy}
                onClick={() => void setSharing(false)}
                data-testid="share-stop"
              >
                {t('share.stop')}
              </button>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

/** One screen on what Windows is about to ask and which answer lets the phones in (spec §14, G14). */
function FirewallExplainer({ t, busy, onContinue }: { t: Translate; busy: boolean; onContinue(): void }) {
  return (
    <div className="share-body" data-testid="firewall-explainer">
      <section className="setup-section share-card">
        <p>{t('share.firewall.why')}</p>
        <ol>
          <li>{t('share.firewall.step.private')}</li>
          <li>{t('share.firewall.step.public')}</li>
          <li>{t('share.firewall.step.allow')}</li>
        </ol>
        <p className="hint">{t('share.firewall.safe')}</p>
        <p className="hint">{t('share.firewall.noPrompt')}</p>
        <button
          type="button"
          className="action launch"
          disabled={busy}
          onClick={onContinue}
          data-testid="firewall-continue"
        >
          {t('share.firewall.continue')}
        </button>
      </section>
      {/* A sketch of the Windows dialog, so the player recognises it and knows where to click. */}
      <section className="firewall-mock" aria-hidden="true">
        <div className="firewall-mock-title">{t('share.firewall.mock.title')}</div>
        <div className="firewall-mock-body">
          <strong>{t('share.firewall.mock.blocked')}</strong>
          <p>{t('share.firewall.mock.allow')}</p>
          <label className="firewall-mock-option pick">
            <span className="box checked">✓</span>
            {t('share.firewall.mock.private')}
            <em>{t('share.firewall.mock.pick')}</em>
          </label>
          <label className="firewall-mock-option">
            <span className="box" />
            {t('share.firewall.mock.public')}
          </label>
          <div className="firewall-mock-buttons">
            <span className="pick">{t('share.firewall.mock.allowButton')}</span>
            <span>{t('share.firewall.mock.cancel')}</span>
          </div>
        </div>
      </section>
    </div>
  );
}
