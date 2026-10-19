import type { StagePack } from '@gtd/content-schema';
import type { Side } from '@gtd/sim';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { ArtProvider } from './art/Art';
import { sounds } from './audio/sound';
import { LanguagePicker } from './components/LanguagePicker';
import { SettingsPanel } from './components/SettingsPanel';
import { KeysProvider } from './hud/KeyHint';
import { TutorialOffer } from './hud/Overlays';
import { LevelScreen } from './level/LevelScreen';
import { HotSeatScreen } from './match/HotSeatScreen';
import { MatchScreen } from './match/MatchScreen';
import type { HotSeatConfig, MatchConfig } from './match/matchConfig';
import { isPcWithMouse } from './menu/device';
import { HotSeatSetup } from './menu/HotSeatSetup';
import { MainMenu } from './menu/MainMenu';
import { ManualScreen } from './menu/ManualScreen';
import { SinglePlayerSetup } from './menu/SinglePlayerSetup';
import { WorldCanvas } from './scene/WorldCanvas';
import { useServerConnection } from './useServerConnection';
import { useSettings } from './useSettings';

/** The first stage and level: the tutorials and the demo run there. */
const LION = { stageId: 'stage-01-big-five', levelId: 'lion' };

type Screen =
  | { name: 'menu' }
  | { name: 'setup' }
  | { name: 'match'; config: MatchConfig }
  | { name: 'hotseat-setup' }
  | { name: 'hotseat'; config: HotSeatConfig }
  | { name: 'manual' }
  /** The M2/M3 level screen: the server's demo match, or the debug seat picker (`#lion-match`). */
  | { name: 'level'; mode: 'demo' | 'play' };

function initialScreen(): Screen {
  if (location.hash === '#lion') return { name: 'level', mode: 'demo' };
  if (location.hash === '#lion-match') return { name: 'level', mode: 'play' };
  return { name: 'menu' };
}

/** Tutorial match on Lion against an easy computer with the stage's first profiles. */
function tutorialConfig(pack: StagePack, side: Side): MatchConfig {
  return {
    ...LION,
    side,
    attackerProfileId: pack.manifest.profiles.attacker[0] ?? '',
    defenderProfileId: pack.manifest.profiles.defender[0] ?? '',
    difficulty: 'easy',
    tutorial: true,
    showAiReasoning: false,
  };
}

export function App() {
  const settings = useSettings();
  const { settings: current, language, suggested, needsLanguageChoice, t, update, loaded } = settings;
  const connection = useServerConnection();
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [manualOver, setManualOver] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);
  const [lastConfig, setLastConfig] = useState<MatchConfig | undefined>(undefined);
  const [lastHotSeat, setLastHotSeat] = useState<HotSeatConfig | undefined>(undefined);
  const [pack, setPack] = useState<StagePack | null>(null);
  const [touch] = useState(() => window.matchMedia('(pointer: coarse)').matches);
  const [hasMouse] = useState(() => isPcWithMouse());
  const lionAvailable = connection.stages.some((stage) => stage.id === LION.stageId);
  const matchStage = screen.name === 'match' || screen.name === 'hotseat' ? screen.config.stageId : null;

  const toMenu = useCallback(() => {
    setScreen({ name: 'menu' });
    setManualOver(false);
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  }, []);

  // The match screen needs the whole stage pack (map, catalog, texts).
  useEffect(() => {
    const stageId = matchStage ?? (offerOpen ? LION.stageId : null);
    if (!stageId || pack?.manifest.id === stageId) return;
    let cancelled = false;
    api.stage(stageId).then(
      (loadedPack) => !cancelled && setPack(loadedPack),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [matchStage, offerOpen, pack]);

  // First launch: offer a tutorial once, after the language is chosen.
  const firstLaunch = loaded && !needsLanguageChoice && !current.onboarding.tutorialOffered && lionAvailable;
  useEffect(() => {
    if (firstLaunch && screen.name === 'menu') setOfferOpen(true);
  }, [firstLaunch, screen.name]);

  const closeOffer = useCallback(() => {
    setOfferOpen(false);
    if (!current.onboarding.tutorialOffered) void update({ onboarding: { tutorialOffered: true } });
  }, [current.onboarding.tutorialOffered, update]);

  const startTutorial = useCallback(
    async (side: Side) => {
      closeOffer();
      setSettingsOpen(false);
      const lion = pack?.manifest.id === LION.stageId ? pack : await api.stage(LION.stageId);
      setPack(lion);
      setScreen({ name: 'match', config: tutorialConfig(lion, side) });
    },
    [closeOffer, pack],
  );

  // A soft click for every button, as UI feedback (spec §6.5).
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const button = (event.target as HTMLElement | null)?.closest('button');
      if (button && !button.disabled) sounds.play('click');
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  const overlayOpen = settingsOpen || manualOver;
  return (
    <ArtProvider>
      <KeysProvider bindings={settings.bindings} show={!touch}>
        <div className="app">
          {screen.name === 'level' && (
            <LevelScreen
              stageId={LION.stageId}
              levelId={LION.levelId}
              mode={screen.mode}
              language={language}
              graphics={current.graphics}
              connection={connection}
              t={t}
              onBack={toMenu}
              onSettings={() => setSettingsOpen(true)}
            />
          )}
          {screen.name === 'match' && pack?.manifest.id === screen.config.stageId && (
            <MatchScreen
              key={`${screen.config.stageId}/${screen.config.levelId}/${screen.config.side}/${screen.config.tutorial}`}
              config={screen.config}
              pack={pack}
              connection={connection}
              settings={settings}
              overlayOpen={overlayOpen}
              onQuit={toMenu}
              onManual={() => setManualOver(true)}
              onSettings={() => setSettingsOpen(true)}
            />
          )}
          {screen.name === 'hotseat' && pack?.manifest.id === screen.config.stageId && (
            <HotSeatScreen
              key={`${screen.config.stageId}/${screen.config.levelId}`}
              config={screen.config}
              pack={pack}
              connection={connection}
              settings={settings}
              overlayOpen={overlayOpen}
              onQuit={toMenu}
              onManual={() => setManualOver(true)}
              onSettings={() => setSettingsOpen(true)}
            />
          )}
          {(screen.name === 'menu' ||
            screen.name === 'setup' ||
            screen.name === 'hotseat-setup' ||
            screen.name === 'manual') && <WorldCanvas />}

          {screen.name === 'menu' && (
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
              </div>
            </header>
          )}

          {screen.name === 'menu' && (
            <MainMenu
              t={t}
              connection={connection}
              playable={lionAvailable}
              hotSeatAvailable={hasMouse}
              onSinglePlayer={() => setScreen({ name: 'setup' })}
              onTutorial={() => setOfferOpen(true)}
              onTwoPlayers={() => setScreen({ name: 'hotseat-setup' })}
              onManual={() => setScreen({ name: 'manual' })}
              onSettings={() => setSettingsOpen(true)}
              onDemo={() => setScreen({ name: 'level', mode: 'demo' })}
            />
          )}
          {screen.name === 'setup' && (
            <SinglePlayerSetup
              stages={connection.stages}
              language={language}
              t={t}
              playerName={current.playerName}
              initial={lastConfig}
              onName={(name) => void update({ playerName: name })}
              onStart={(config) => {
                setLastConfig(config);
                setScreen({ name: 'match', config });
              }}
              onBack={toMenu}
            />
          )}
          {screen.name === 'hotseat-setup' && (
            <HotSeatSetup
              stages={connection.stages}
              language={language}
              t={t}
              initial={lastHotSeat}
              onStart={(config) => {
                setLastHotSeat(config);
                setScreen({ name: 'hotseat', config });
              }}
              onBack={toMenu}
            />
          )}
          {screen.name === 'manual' && (
            <ManualScreen stageId={LION.stageId} language={language} t={t} onBack={toMenu} />
          )}
          {manualOver && (
            <div className="manual-over">
              <ManualScreen
                stageId={matchStage ?? LION.stageId}
                language={language}
                t={t}
                onBack={() => setManualOver(false)}
              />
            </div>
          )}

          {needsLanguageChoice && (
            <LanguagePicker suggested={suggested} onChoose={(choice) => void update({ language: choice })} />
          )}
          {offerOpen && !needsLanguageChoice && (
            <TutorialOffer
              t={t}
              onAttacker={() => void startTutorial('attacker')}
              onDefender={() => void startTutorial('defender')}
              onLater={closeOffer}
            />
          )}
          {settingsOpen && (
            <SettingsPanel
              settings={settings}
              onReplayTutorial={screen.name === 'menu' ? (side) => void startTutorial(side) : undefined}
              onClose={() => setSettingsOpen(false)}
            />
          )}
        </div>
      </KeysProvider>
    </ArtProvider>
  );
}
