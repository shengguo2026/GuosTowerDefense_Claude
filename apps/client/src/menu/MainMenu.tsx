import type { Translate } from '@gtd/i18n';
import { Art, useArtUrl } from '../art/Art';
import type { ServerConnection } from '../useServerConnection';

interface Props {
  t: Translate;
  connection: ServerConnection;
  /** Lion (the first level) is installed, so there is something to play. */
  playable: boolean;
  onSinglePlayer(): void;
  onTutorial(): void;
  onTwoPlayers(): void;
  onManual(): void;
  onSettings(): void;
  onDemo(): void;
}

/** Main menu (spec §6.1): single player, tutorial, two players, manual and settings over the menu picture. */
export function MainMenu({
  t,
  connection,
  playable,
  onSinglePlayer,
  onTutorial,
  onTwoPlayers,
  onManual,
  onSettings,
  onDemo,
}: Props) {
  const background = useArtUrl('MENU-BG');
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
            disabled={!playable}
            data-testid="menu-two-players"
          >
            <strong>{t('menu.twoPlayers')}</strong>
            <span>{t('menu.twoPlayersHint')}</span>
          </button>
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
        {connection.error && <p className="error">{connection.error}</p>}
      </main>
    </>
  );
}
