import type { Translate } from '@gtd/i18n';
import type { NetworkInfo } from '@gtd/protocol';
import { Art, useArtUrl } from '../art/Art';
import type { ServerConnection } from '../useServerConnection';

interface Props {
  t: Translate;
  connection: ServerConnection;
  /** Lion (the first level) is installed, so there is something to play. */
  playable: boolean;
  /** Hot-seat needs a keyboard and a mouse (PC only). */
  hotSeatAvailable: boolean;
  /** Who this browser is in the network: the PC that hosts the game, or a tablet or phone that joined it. */
  network: NetworkInfo | null;
  onSinglePlayer(): void;
  onTutorial(): void;
  onTwoPlayers(): void;
  onShare(): void;
  onWifi(): void;
  onManual(): void;
  onSettings(): void;
  onDemo(): void;
}

/** Main menu (spec §6.1): single player, tutorial, two players, Wi-Fi play, manual and settings over the menu picture. */
export function MainMenu({
  t,
  connection,
  playable,
  hotSeatAvailable,
  network,
  onSinglePlayer,
  onTutorial,
  onTwoPlayers,
  onShare,
  onWifi,
  onManual,
  onSettings,
  onDemo,
}: Props) {
  const background = useArtUrl('MENU-BG');
  // Only the PC that hosts the game invites tablets and phones; a tablet or phone that joined says where it plays.
  const host = network?.host === true && hotSeatAvailable;
  const guest = network?.host === false;
  const sharedAt = network?.sharing
    ? network.addresses[0]?.replace(/^http:\/\//, '').replace(/\/$/, '')
    : undefined;
  return (
    <>
      {background && <Art id="MENU-BG" alt="" className="menu-background" />}
      <main className="main-menu panel" data-testid="main-menu">
        <h1>{t('app.title')}</h1>
        <p className="tagline">{t('home.tagline')}</p>
        <nav className="menu-buttons" aria-label={t('menu.label')}>
          <button
            type="button"
            className="menu-button primary"
            onClick={onSinglePlayer}
            disabled={!playable}
            data-testid="menu-single"
          >
            <strong>{t('menu.singlePlayer')}</strong>
            <span>{t('menu.singlePlayerHint')}</span>
          </button>
          <button
            type="button"
            className="menu-button"
            onClick={onTutorial}
            disabled={!playable}
            data-testid="menu-tutorial"
          >
            <strong>{t('menu.tutorial')}</strong>
            <span>{t('menu.tutorialHint')}</span>
          </button>
          <button
            type="button"
            className="menu-button"
            onClick={onTwoPlayers}
            disabled={!playable || !hotSeatAvailable}
            data-testid="menu-two-players"
          >
            <strong>{t('menu.twoPlayers')}</strong>
            <span>{hotSeatAvailable ? t('menu.twoPlayersHint') : t('menu.twoPlayersPcOnly')}</span>
          </button>
          <button
            type="button"
            className="menu-button"
            onClick={onWifi}
            disabled={!playable}
            data-testid="menu-wifi"
          >
            <strong>{t('menu.wifi')}</strong>
            <span>{host ? t('menu.wifiHintPc') : t('menu.wifiHint')}</span>
          </button>
          {host && (
            <button type="button" className="menu-button" onClick={onShare} data-testid="menu-share">
              <strong>{t('menu.share')}</strong>
              <span>{sharedAt ? t('menu.shareOn', { address: sharedAt }) : t('menu.shareHint')}</span>
            </button>
          )}
          <div className="menu-row">
            <button type="button" className="menu-button small" onClick={onManual} data-testid="menu-manual">
              <strong>{t('menu.manual')}</strong>
            </button>
            <button
              type="button"
              className="menu-button small"
              onClick={onSettings}
              data-testid="menu-settings"
            >
              <strong>{t('settings.title')}</strong>
            </button>
            <button
              type="button"
              className="menu-button small"
              onClick={onDemo}
              disabled={!playable}
              data-testid="open-lion"
            >
              <strong>{t('menu.demo')}</strong>
            </button>
          </div>
        </nav>
        <p className="meta" data-testid="server-info">
          {connection.serverVersion && t('connection.serverVersion', { version: connection.serverVersion })}
          {connection.stages.length > 0 && ` · ${t('home.stages', { count: connection.stages.length })}`}
        </p>
        {guest && (
          <p className="meta" data-testid="guest-info">
            {t('menu.guest')}
          </p>
        )}
        {connection.error && <p className="error">{connection.error}</p>}
      </main>
    </>
  );
}
