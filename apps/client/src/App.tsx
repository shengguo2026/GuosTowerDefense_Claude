import { useState } from 'react';
import { LanguagePicker } from './components/LanguagePicker';
import { SettingsPanel } from './components/SettingsPanel';
import { WorldCanvas } from './scene/WorldCanvas';
import { useServerConnection } from './useServerConnection';
import { useSettings } from './useSettings';

export function App() {
  const { language, suggested, needsLanguageChoice, t, update } = useSettings();
  const connection = useServerConnection();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="app">
      <WorldCanvas />

      <header className="top-bar">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={32} height={32} />
          <span data-testid="app-title">{t('app.title')}</span>
        </div>
        <div className="top-actions">
          <span className={`connection ${connection.status}`} data-testid="connection" role="status">
            <span className="dot" aria-hidden="true" />
            {t(`connection.${connection.status}`)}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label={t('settings.title')}
            title={t('settings.title')}
            onClick={() => setSettingsOpen(true)}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path
                fill="currentColor"
                d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.4-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.7a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.4L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.4 2.5-1c.5.4 1.1.7 1.7 1l.4 2.7h4l.4-2.7c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"
                transform="translate(-1 0)"
              />
            </svg>
          </button>
        </div>
      </header>

      <main className="home-card panel">
        <h1>{t('app.title')}</h1>
        <p className="tagline">{t('home.tagline')}</p>
        <p className="hint">{t('home.foundation')}</p>
        <p className="meta" data-testid="server-info">
          {connection.serverVersion && t('connection.serverVersion', { version: connection.serverVersion })}
          {connection.stages.length > 0 && ` · ${t('home.stages', { count: connection.stages.length })}`}
        </p>
        {connection.error && <p className="error">{connection.error}</p>}
      </main>

      {needsLanguageChoice && (
        <LanguagePicker suggested={suggested} onChoose={(choice) => void update({ language: choice })} />
      )}
      {settingsOpen && (
        <SettingsPanel
          language={language}
          t={t}
          onLanguage={(choice) => void update({ language: choice })}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
