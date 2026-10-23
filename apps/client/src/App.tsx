import type { Difficulty } from '@gtd/ai';
import type { StagePack } from '@gtd/content-schema';
import type { NetworkInfo } from '@gtd/protocol';
import type { Side } from '@gtd/sim';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { RotateHint } from './menu/RotateHint';
import { ShareScreen } from './menu/ShareScreen';
import { SinglePlayerSetup } from './menu/SinglePlayerSetup';
import { ProgressScreen } from './progress/ProgressScreen';
import { WorldCanvas } from './scene/WorldCanvas';
import { useServerConnection } from './useServerConnection';
import { useSettings } from './useSettings';
import { LobbyScreen, slotName } from './wifi/LobbyScreen';
import { readGuestName, useWifiRoom, writeGuestName } from './wifi/useWifiRoom';
import { cleanCode, WifiScreen } from './wifi/WifiScreen';

/** The first stage and level: the tutorials and the demo run there. */
const LION = { stageId: 'stage-01-big-five', levelId: 'lion' };
/** Levels the developer hashes can open (spec: Big Five). */
const STAGE_ONE_LEVELS = ['lion', 'leopard', 'elephant', 'rhinoceros', 'buffalo'];

type Screen =
  | { name: 'menu' }
  | { name: 'setup' }
  | { name: 'match'; config: MatchConfig }
  | { name: 'hotseat-setup' }
  | { name: 'hotseat'; config: HotSeatConfig }
  | { name: 'manual' }
  | { name: 'progress' }
  | { name: 'share' }
  /** Wi-Fi play: host or join; `code` came with the QR code. */
  | { name: 'wifi'; code?: string }
  /**
   * The M2/M3 level screen: the server's demo match, or the debug seat picker (`#lion-match`). `#leopard` and
   * `#leopard-match` open another level of Stage 1 the same way.
   */
  | { name: 'level'; mode: 'demo' | 'play'; levelId?: string };

function initialScreen(): Screen {
  // The QR code of a Wi-Fi lobby opens `/?join=247433`; another PC's "Join" opens `/?wifi=join`.
  const params = new URLSearchParams(location.search);
  const join = cleanCode(params.get('join') ?? '');
  if (join.length === 6 || params.get('wifi') === 'join') {
    history.replaceState(null, '', location.pathname + location.hash);
    return join.length === 6 ? { name: 'wifi', code: join } : { name: 'wifi' };
  }
  const level = /^#([a-z]+)(-match)?$/.exec(location.hash);
  if (level?.[1] && level[1] !== 'lion' && STAGE_ONE_LEVELS.includes(level[1]))
    return { name: 'level', mode: level[2] ? 'play' : 'demo', levelId: level[1] };
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
  const wifi = useWifiRoom(connection);
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [manualOver, setManualOver] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);
  const [lastConfig, setLastConfig] = useState<MatchConfig | undefined>(undefined);
  const [lastHotSeat, setLastHotSeat] = useState<HotSeatConfig | undefined>(undefined);
  const [pack, setPack] = useState<StagePack | null>(null);
  const [touch] = useState(() => window.matchMedia('(pointer: coarse)').matches);
  const [hasMouse] = useState(() => isPcWithMouse());
  const [network, setNetwork] = useState<NetworkInfo | null>(null);
  const lionAvailable = connection.stages.some((stage) => stage.id === LION.stageId);
  const room = wifi.room;
  const wifiMatch = room && room.phase !== 'lobby' && room.matchId ? room : null;
  const matchStage = wifiMatch
    ? wifiMatch.stageId
    : screen.name === 'match' || screen.name === 'hotseat'
      ? screen.config.stageId
      : null;
  const pcBrowser = network?.host === true && hasMouse;
  const [guestName, setGuestName] = useState(readGuestName);
  const wifiName = pcBrowser ? current.playerName : guestName;

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

  // Whether this browser is the PC or a tablet or phone that joined it, and where the game is shared (menu line).
  useEffect(() => {
    if (screen.name !== 'menu') return;
    let cancelled = false;
    api.network().then(
      (info) => !cancelled && setNetwork(info),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [screen.name]);

  // Network info also on the Wi-Fi screen (is the PC sharing, is a game open).
  useEffect(() => {
    if (screen.name !== 'wifi') return;
    let cancelled = false;
    api.network().then(
      (info) => !cancelled && setNetwork(info),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [screen.name, room]);

  // The host closed the room: say so on the Wi-Fi screen.
  useEffect(() => {
    if (wifi.error === 'closed') setScreen({ name: 'wifi' });
  }, [wifi.error]);

  const leaveRoom = useCallback(() => {
    wifi.leave();
    setScreen({ name: 'wifi' });
  }, [wifi]);

  // First launch: offer a tutorial once, after the language is chosen.
  const firstLaunch = loaded && !needsLanguageChoice && !current.onboarding.tutorialOffered && lionAvailable;
  useEffect(() => {
    if (firstLaunch && screen.name === 'menu' && !wifi.room && !wifi.rejoining) setOfferOpen(true);
  }, [firstLaunch, screen.name, wifi.room, wifi.rejoining]);

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
  const mySlot = wifiMatch?.slots.find((slot) => slot.playerId === wifi.playerId);
  // Every room update is a new object: keep the match's config the same object while its content stays the same.
  const wifiKey =
    wifiMatch && mySlot
      ? [
          wifiMatch.stageId,
          wifiMatch.levelId,
          mySlot.side,
          wifiMatch.slots.find((s) => s.side === 'attacker')?.profileId ?? '',
          wifiMatch.slots.find((s) => s.side === 'defender')?.profileId ?? '',
          wifiMatch.difficulty,
        ].join('|')
      : null;
  const wifiConfig: MatchConfig | null = useMemo(() => {
    if (!wifiKey) return null;
    const [stageId = '', levelId = '', side, attackerProfileId = '', defenderProfileId = '', difficulty] =
      wifiKey.split('|');
    return {
      stageId,
      levelId,
      side: side as Side,
      attackerProfileId,
      defenderProfileId,
      difficulty: difficulty as Difficulty,
      tutorial: false,
      showAiReasoning: false,
    };
  }, [wifiKey]);
  const sideName = (side: Side) => {
    const slot = wifiMatch?.slots.find((s) => s.side === side);
    return slot ? (slot.playerId ? slotName(slot, t) : t('wifi.computer')) : '';
  };
  // After a reload in a Wi-Fi game: go straight back without building the menu's 3D scene first.
  const returning = wifi.rejoining && !room && screen.name === 'menu';
  const inRoom = room !== null || returning;
  return (
    <ArtProvider>
      <KeysProvider bindings={settings.bindings} show={!touch}>
        <div className="app">
          {wifiMatch && wifiConfig && pack?.manifest.id === wifiConfig.stageId && (
            <MatchScreen
              key={`wifi/${wifiMatch.matchId}`}
              config={wifiConfig}
              pack={pack}
              connection={connection}
              settings={settings}
              overlayOpen={overlayOpen}
              onQuit={leaveRoom}
              onManual={() => setManualOver(true)}
              onSettings={() => setSettingsOpen(true)}
              wifi={{
                host: wifi.host,
                names: { attacker: sideName('attacker'), defender: sideName('defender') },
                away: wifiMatch.slots
                  .filter((slot) => slot.playerId && !slot.connected)
                  .map((slot) => slot.side),
                resync: wifi.resync,
                onRematch: wifi.start,
                onLobby: wifi.toLobby,
              }}
            />
          )}
          {returning && (
            <main className="main-menu panel" data-testid="wifi-returning">
              <h1>{t('app.title')}</h1>
              <p className="tagline">{t('wifi.returning')}</p>
              <button type="button" className="action secondary" onClick={leaveRoom}>
                {t('wifi.leave')}
              </button>
            </main>
          )}
          {room?.phase === 'lobby' && (
            <>
              <WorldCanvas />
              <LobbyScreen
                t={t}
                language={language}
                stages={connection.stages}
                wifi={{ ...wifi, room }}
                onLeave={leaveRoom}
              />
            </>
          )}
          {!inRoom && screen.name === 'level' && (
            <LevelScreen
              stageId={LION.stageId}
              levelId={screen.levelId ?? LION.levelId}
              mode={screen.mode}
              language={language}
              graphics={current.graphics}
              connection={connection}
              t={t}
              onBack={toMenu}
              onSettings={() => setSettingsOpen(true)}
            />
          )}
          {!inRoom && screen.name === 'match' && pack?.manifest.id === screen.config.stageId && (
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
          {!inRoom && screen.name === 'hotseat' && pack?.manifest.id === screen.config.stageId && (
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
          {!inRoom &&
            (screen.name === 'menu' ||
              screen.name === 'setup' ||
              screen.name === 'hotseat-setup' ||
              screen.name === 'share' ||
              screen.name === 'wifi' ||
              screen.name === 'manual' ||
              screen.name === 'progress') && <WorldCanvas />}

          {!inRoom && screen.name === 'menu' && (
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

          {!inRoom && screen.name === 'menu' && (
            <MainMenu
              t={t}
              connection={connection}
              playable={lionAvailable}
              hotSeatAvailable={hasMouse}
              network={network}
              onSinglePlayer={() => setScreen({ name: 'setup' })}
              onTutorial={() => setOfferOpen(true)}
              onTwoPlayers={() => setScreen({ name: 'hotseat-setup' })}
              onShare={() => setScreen({ name: 'share' })}
              onWifi={() => setScreen({ name: 'wifi' })}
              onManual={() => setScreen({ name: 'manual' })}
              onProgress={() => setScreen({ name: 'progress' })}
              onSettings={() => setSettingsOpen(true)}
              onDemo={() => setScreen({ name: 'level', mode: 'demo' })}
            />
          )}
          {!inRoom && screen.name === 'setup' && (
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
          {!inRoom && screen.name === 'hotseat-setup' && (
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
          {!inRoom && screen.name === 'share' && <ShareScreen t={t} onBack={toMenu} />}
          {!inRoom && screen.name === 'wifi' && (
            <WifiScreen
              t={t}
              wifi={wifi}
              network={network}
              pc={hasMouse}
              name={wifiName}
              {...(screen.code ? { code: screen.code } : {})}
              onName={(name) => {
                if (pcBrowser) {
                  if (name !== current.playerName) void update({ playerName: name });
                } else {
                  setGuestName(name);
                  writeGuestName(name);
                }
              }}
              onBack={() => {
                wifi.clearError();
                toMenu();
              }}
            />
          )}
          {!inRoom && screen.name === 'manual' && (
            <ManualScreen stageId={LION.stageId} language={language} t={t} onBack={toMenu} />
          )}
          {!inRoom && screen.name === 'progress' && (
            <ProgressScreen stageId={LION.stageId} language={language} t={t} onBack={toMenu} />
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

          {touch && <RotateHint t={t} />}
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
