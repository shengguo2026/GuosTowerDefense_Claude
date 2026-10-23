# Guo's Tower Defense: Final Specification

**Status:** approved by Guo on 2026-10-13 (§2.1 added after approval) · **Date:** 2026-10-13
**Base:** `masterplan_GuosTowerDefense.md` (functional requirements) + Guo's additions and gap decisions
(`refinement/gaps_and_decisions.md`, G1–G15).
**Repository:** https://github.com/shengguo2026/GuosTowerDefense_Claude

This document is the source of truth for **what** the game does. Where it differs from the masterplan, this document
wins; the masterplan's technical chapters are guidance only (see §21). Balance numbers (costs, health, timings) are
deliberately not fixed here; they live in stage data and are tuned with the balance simulator.

---

## 1. Identity

| Item | Value |
|---|---|
| English title | Guo's Tower Defense |
| German title | Guos Tower Defense |
| Simplified Chinese title | 盛国的塔防游戏 |
| Internal id | `guos-tower-defense` |
| Languages | `en` (fallback), `de`, `zh-CN`; every player-facing text, including manual, tips and subtitles |
| Favicon / app icon | the existing `favicon.svg`, unchanged |

**Language choice (G12):** on first launch the game picks the browser language if supported, then shows a language
picker once; changeable any time in Settings.

---

## 2. Concept and tone

An asymmetric tower-defense strategy game played in the browser. The player may play either side:

- **Attacker:** builds tactical waves of groups and sends them along a route network to reach an objective.
- **Defender:** builds and commands defenses and mobile units to stop the attacker before the objective is completed.

Stage 1, "South Africa: Get the Big Five", has five levels (Lion, Leopard, Elephant, Rhinoceros, African Buffalo).
The engine stays stage-independent so future stages can bring completely different themes (masterplan §11–14 apply).

**Tone (G3): non-violent and family-friendly.**
- No animal is ever harmed, shown hurt, or captured. Animals are the scenery and the goal of the encounter.
- Attackers win by reaching an animal's zone and holding it long enough (the sighting, the photo, the "trophy shot")
  which always stays off-screen and is never shown as a kill.
- People are never killed. An attacker unit that loses is **stopped**: detained or turned back, it walks off the map
  and its deployment capacity is spent. A defense that loses is **disrupted** (temporarily out of action) or
  **dismantled** (removed).
- Defender tools are non-lethal: patrols, nets, spotlights, sirens, barriers, fences, sensors, drones, vehicles.
- The **Hunter** profile keeps its name. Its "disrupt and breakthrough" style works on equipment and barriers, never on
  people or animals.
- Wording in UI and manual follows this: "stopped", "turned back", "intercepted", "disrupted", "dismantled";
  never "killed", "destroyed people", "shot".


### 2.1 Stage independence (guaranteed by the engine)

A stage pack is data plus optional stage plugins; adding a stage never changes engine code. A stage pack defines:

- **any number of levels** (1 or more), their order and unlock rules, maps, route graphs, objectives and timers;
- **any number of profiles per side** (at least 1 each), each with its own resources, passive, abilities, units or
  assets, commands and target priorities;
- its own units, defenses, resources, status effects, achievements, art, audio, texts and difficulty tuning.

Abilities and commands are **composed from generic building blocks** (target an area/unit/route/junction; apply
slow, reveal, conceal, protect, disrupt, boost, move, spawn, block a branch, change a resource; with range, duration,
cost and cooldown), so most new abilities need data only. A mechanic the blocks cannot express (e.g. weather,
day/night, teleport gates, a moving herd) is written as a **stage plugin** inside that stage pack.

The HUD, manual pages, AI and key bindings are generated from the profile data: up to 5 ability slots
(default keys `F G H J K`) and up to 6 command slots (`X C V B N M`) per profile.

**What stays fixed in the engine:** two sides (Attacker and Defender), teams of 1–2, a route-graph map, a continuous
clock where both sides act at the same time (not turn-based) and the Attacker sends manually built waves of groups
(§6.3), and the rule that the Defender can never block every route. A future stage that breaks one of these
(e.g. three sides, free-roam movement, turn-based play) needs an engine change and a design review first.

**Proof:** from R1 on, the automated tests include a small **test stage** with a different number of levels and
profiles and abilities unlike Stage 1, which must validate, load and play headless AI-vs-AI to the end.

---

## 3. Platforms, devices and hosting

**Hosting (G4): the PC always hosts.**
- The game is installed on a Windows PC (macOS/Linux supported with `start.sh` where practical). It is not hosted on
  Vercel or any cloud service.
- Double-click `start.bat` → local game server starts → default browser opens the game.
- Every device plays through that PC: the PC's own browser, and any tablet or phone on the same Wi-Fi, also for
  single player. There is **one save, on the PC**.
- No Node.js or other install is required from the player; the package bundles its runtime.
- The launcher picks a free port (3001, then 3002, …), checks the user-data folder is writable, waits for the server,
  determines the PC's Wi-Fi address and opens the browser.

**Devices:**

| Device | Input | Modes |
|---|---|---|
| Desktop PC / laptop | mouse + keyboard (touchscreen laptops also touch) | everything, including hot-seat |
| Tablet | touch, **one player per tablet** | single player vs AI, Wi-Fi multiplayer |
| Phone | touch, one player | single player vs AI, Wi-Fi multiplayer |

- No split-screen or shared-screen two-player mode on tablets or phones.
- Tablets and phones are landscape-first; in portrait the game shows "Rotate your device for the full game experience."
- Supported browsers: current Chrome/Chromium, Edge, Firefox, Safari (iPad/iPhone).

**User data** stays separate from replaceable app files (`user-data/saves, backups, settings, screenshots, logs,
telemetry`). Copying the game folder to another PC keeps progress (portable mode).

---

## 4. Release ladder (G1)

Each release is a complete, playable game. Later releases add to it without breaking saves.

| Release | Adds |
|---|---|
| **R1: Lion** | Lion level · Explorer vs Ranger · Easy/Medium/Hard · single player vs AI (either side) · hot-seat on PC · touch play on tablet/phone via the PC · guided tutorial for each side · briefings with Chief Warden Guo · basic save (settings, level/difficulty unlocks) · EN/DE/ZH |
| **R2: All profiles + Wi-Fi** | all 6 profiles · stealth/detection, disruption, route manipulation in full · Wi-Fi 1v1 multiplayer (host/join, QR, room code, lobby, reconnect) · profile XP, scores, high scores, statistics · save backups, export/import |
| **R3: Big Five campaign** | Leopard, Elephant, Rhinoceros, Buffalo with their mechanics · Stage 1 completion · game intro movie and Stage 1 intro · gallery · result artworks · full music and ambience |
| **R4: Mastery** | 2v2 (Human+AI, Human+Human over Wi-Fi) · team pings and shared team resource · Extreme, Ultimate, Chaotic with seeds · achievements (45–60) · Big Five montage · balance and performance polish → **version 1.0** |

Developer tools (debug mode, headless simulation, AI-vs-AI) grow alongside from R1.

---

## 5. Game modes

### 5.0 All player combinations
The match is always **team vs team** (Attacker team vs Defender team), team size 1 or 2. Any slot can be a human or
the AI, and humans can be on either side.

| Format | Combination | Where it is played | Release |
|---|---|---|---|
| 1v1 | Human vs AI (human on either side) | single player, any device | R1 |
| 1v1 | Human vs Human | hot-seat on one PC | R1 |
| 1v1 | Human vs Human | Wi-Fi, two devices | R2 |
| 2v2 | Human + AI vs AI + AI | single player, any device (AI teammate) | R4 |
| 2v2 | Human + Human vs AI + AI | Wi-Fi, two devices | R4 |
| 2v2 | Human + AI vs Human + AI | Wi-Fi, two devices | R4 |
| 2v2 | Human + Human vs Human + AI | Wi-Fi, three devices | R4 |
| 2v2 | Human + Human vs Human + Human | Wi-Fi, four devices | R4 |
| 1v1 / 2v2 | AI only | developer and balance tools only | from R1 |

Hot-seat stays 1v1. In 2v2 each player controls their own profile; the team shares the team resource and pings.

### 5.1 Single player vs AI
Human plays Attacker or Defender; the AI plays the other side with the same rules, visibility, costs and cooldowns
as a human (masterplan §18). Available on every device.

### 5.2 Hot-seat (G5): two players, one PC
- PC only, 1v1 only. One player uses the **keyboard (Attacker)**, the other the **mouse (Defender)**.
- One shared screen and one shared 3D camera. The camera belongs to the mouse player.
- Screen split of the HUD: Attacker panels on the **left half**, Defender panels on the **right half**.
- The Attacker never needs the camera: their left panel contains a **route schematic** (the route graph as a clean
  2D map) where a junction cursor moves. The cursor and selected group are also highlighted in the 3D view.
- **Planning pauses:** each player may pause the match 3 times, up to 20 seconds each. Attacker key `P`,
  Defender button on their HUD. Either player can resume early.
- Both players see the whole map. Stealth and detection still apply to **targeting** (defenses cannot target
  undetected units), and undetected units are drawn with a "hidden" marker so both players understand the state.
- Both human profiles earn XP into the one PC save.

**Attacker keyboard defaults** (all rebindable in Settings → Controls; bindings use physical key positions, so
`T Z U` stays three neighbouring keys on a German QWERTZ keyboard, labelled `T Y U` on a US keyboard):

| Key | Action |
|---|---|
| `W` `A` `S` `D` | move the junction cursor on the route schematic |
| `1`–`4` | pick unit type 1–4 (each press adds one unit to the group being built; `Shift`+number removes one) |
| `T` `Z` `U` | pick route 1 / 2 / 3 for the group being built, or reroute the selected group at the cursor junction |
| `R` | cycle formation |
| `Enter` | add the group to the wave · on a field group: set hold/reroute point at the cursor junction |
| `Tab` / `Shift`+`Tab` | cycle groups (next / previous) |
| `Space` | launch the wave |
| `F` `G` `H` (`J` `K`) | profile abilities 1–3 (4–5 if the profile has them) |
| `X` `C` `V` `B` (`N` `M`) | group command slots 1–4, up to 6 (profile-specific, e.g. Hold, Retreat, Advance, Disperse) |
| `P` | planning pause |

**Defender mouse defaults:**

| Input | Action |
|---|---|
| left click | select asset / place the chosen build item |
| left drag or screen edge | pan |
| wheel | zoom |
| right drag | rotate |
| right click on own asset | command wheel (upgrade, repair, sell, target priority, patrol, focus target) |
| double click | focus camera |
| HUD buttons (right half) | build categories, abilities, planning pause |

No keyboard key is assigned to the Defender in hot-seat, so the two players never collide. In single player on a PC
the same keyboard shortcuts work for whichever side the human plays, plus mouse for everything.

### 5.3 Wi-Fi multiplayer (R2: 1v1, R4: 2v2)
PC hosts; other devices join over the same Wi-Fi. See §14.

### 5.4 Developer AI-vs-AI
Hidden developer mode and headless balance simulation only; not a normal player mode.

---

## 6. Match structure

### 6.1 Flows
Single player: Main Menu → Single Player → Stage → Level → Side → Profile → optional name → Difficulty →
Briefing → Preparation → Match → Victory/Defeat → 50/50 result → Score/XP/unlocks → Next / Replay / Menu.

Hot-seat: Main Menu → Hot-seat → Stage → Level → each player picks side and profile → Difficulty (applies to AI
helpers only, none in 1v1) → Briefing → Preparation → Match → result.

Wi-Fi: Main Menu → Wi-Fi Play → Host / Join → team size → Lobby (stage, level, difficulty by host; slots, profiles,
names, ready) → Match → team result → host save → Rematch / Lobby / Menu.

### 6.2 Pacing (G6)
- Target match length **10–15 minutes**; an anti-stalemate maximum timer (default 20 minutes, set per level)
  ends the match as a Defender win if the objective is not completed.
- **Single player:** pause at any time; speed 1× or 2×.
- **Hot-seat:** planning pauses only (§5.2); speed fixed at 1×.
- **Wi-Fi:** only the host can pause; speed fixed at 1×.

### 6.3 Phases and waves
Preparation (Defender builds, Attacker plans first wave) → Launch → Combat, with the Attacker building the next wave
while the current one is active. Minimum cooldown between launches and a limit on how many waves may overlap
(both per level data). The Defender acts continuously.

A **wave** contains one or more **groups**; each group has units, quantity, formation, route and launch delay, and
costs **deployment capacity**. The Attacker has a finite total capacity per match.

A wave ends when all its units are stopped, all survivors complete the objective, or the Attacker abandons them.
Retreat/Abort refunds part of the capacity.

### 6.4 Victory
- Attacker wins by completing the primary objective: reach the zone → hold/interact for a set time → complete.
- Defender wins by preventing that until Attacker capacity is used up or the timer runs out.
- Secondary objectives add score, XP and resource bonuses, not victory.
- The result screen always shows partial performance, also on defeat.

### 6.5 Economy
Both sides get continuous base income plus event bonuses (Attacker: checkpoints, objective progress, retreat refunds;
Defender: stopping a wave, protection milestones, efficiency). Each profile has two personal resources (§9).
In 2v2 a slower shared team resource pays for team actions; first valid activation executes, no voting.

---

## 7. Map and routes

- Routes are a **graph** of nodes (spawn, junction, checkpoint, connector, objective) and edges (length, terrain,
  capacity, movement and visibility modifiers, blocked state).
- The Attacker chooses routes per group before launch, reroutes and holds only at junctions. No free path drawing,
  no jumping between branches.
- The Defender may slow branches, create chokepoints, place temporary roadblocks, raise detection and temporarily
  close branches. **Absolute rule: the Defender can never block every legal path to the objective**; placement is
  refused if it would, and the game checks this at runtime too.
- Defender placement is hybrid: major structures on predefined build zones; light assets on legal terrain; mobile
  units by patrol, guard or response zones. Major structures can be built, upgraded, repaired, moved within limits
  and sold.

---

## 8. Combat, information and effects

- Basic actions are automatic. Defender sets target priority per asset: First, Last, Strongest, Weakest, Fastest,
  Special (profiles may add more). Manual **Focus Target** must respect range and visibility.
- Interaction categories: Direct (intercept), Area, Slow, Disruption, Detection, Control.
- Attacker options against defenses: **Avoid, Disrupt, Dismantle**. Each defender asset declares whether it is
  disruptible, dismantlable, both or neither. Dismantling never matters more than reaching the objective, also in
  scoring.
- Status effects: Slowed, Revealed, Disrupted, Pinned, Protected, Boosted; stages may add their own.
- Line of sight: environment objects are full blockers, partial cover or decoration.

**Visibility (G13):**
- Attacker unit visibility types: Normal, Concealed, Stealth. Detection states: Unknown → Detected → Identified.
- The **Defender** sees attacker units only while they are detected (sensors, posts, patrols, abilities).
  Stealth is never permanent: sensors, scouting and abilities reveal it for a time.
- The **Attacker** sees a defense once any of their units has had line of sight to it, or a scout/ability revealed
  it; once seen, its position stays known (its current state updates only while in sight).
- Minimap and all UI respect these rules; nothing hidden appears by accident.
- Hot-seat exception: see §5.2.

---

## 9. Stage 1 profiles

All six are available from the start; profile XP unlocks capabilities, not the profile. Duplicate profiles on one
2v2 team are not allowed. Every profile must be viable in solo 1v1.

| Side | Profile | Role | Resources | Passive | Abilities |
|---|---|---|---|---|---|
| Attacker | Explorer | information, mobility, route adaptation | Expedition Supplies, Recon Points | Trail Knowledge | Reconnaissance, Rapid Reroute, Field Guide |
| Attacker | Hunter | disruption, breakthrough | Field Supplies, Tactical Charges | Target Assessment | Sabotage, Breach, Coordinated Assault |
| Attacker | Photographer | concealment, objective completion | Field Kit, Focus Points | Low Profile | Concealed Approach, Perfect Position, Snapshot Window |
| Defender | Ranger | mobility, interception | Ranger Supplies, Response Points | Field Awareness | Rapid Response, Intercept, Emergency Reinforcement |
| Defender | Wildlife Protector | fortification, area control | Conservation Supplies, Protection Points | Protected Ground | Conservation Barrier, Protected Zone, Habitat Lockdown |
| Defender | Field Researcher | detection, prediction | Research Supplies, Analysis Points | Behavioral Analysis | Area Scan, Route Analysis, Deep Analysis |

Units, assets and commands per profile are as listed in masterplan §44–49, read with the tone rules of §2
(e.g. Hunter "Off-road Vehicle" and "Breach Specialist" break barriers and equipment, not people).

**R1 content** (Lion only): Explorer with Scout, Expedition Team, Reconnaissance, Rapid Reroute, formations Column and
Spread; Ranger with Ranger Patrol, Observation Post, Temporary Checkpoint, Rapid Response, Intercept.

---

## 10. Stage 1 levels

| # | Level | Routes | Unique mechanic | Learning goal | Objective |
|---|---|---|---|---|---|
| 1 | Lion | Ridge Route, Riverbed Route (+ Grassland Detour on higher difficulties) | Open Ground Exposure: open ground is faster but easier to detect; cover slower but safer | route choice, timing, visibility | Lion Waterhole Observation Zone |
| 2 | Leopard | Woodland Trail, Rocky Route, Ravine Connector | Concealment Zones (brush partial, rock wall full blocker, ledge better view, clearing exposed) | fighting for information | leopard rock lookout |
| 3 | Elephant | Dry Ridge, Mud Flats, River Crossing | Terrain Weight, Route Capacity (narrow crossings compress and slow groups) | composition and crossing control | elephant river crossing |
| 4 | Rhinoceros | Thorn Track, Dry Gully, Open Scrub | Close Contact, Ambush Zones (late detection, short engagements) | fast reaction, local positioning | rhino thicket clearing |
| 5 | African Buffalo | Northern Grass, Southern Mud, Reed Connector, Central Wetland | Herd Movement (moving objective with visible forecast, never blocks all routes), Multi-front Pressure | combined mastery | the moving buffalo herd |

Unlocks: Lion is open; winning a level once (either side, any difficulty) unlocks the next. Stage 1 is complete when
all five are won at least once; Attacker and Defender completion are tracked separately.

---

## 11. Difficulty and Chaotic

Easy, Medium, Hard are open. Per level and per side: beat Hard → Extreme; beat Extreme → Ultimate; beat Ultimate →
Chaotic (R4). Difficulty improves AI decisions, reactions, efficiency, coordination, route complexity and punishment
of mistakes, not mainly health or damage.

Chaotic (R4): strongest AI; procedurally generated valid route networks that keep the level's landmarks and identity;
always at least one valid attacker route; a deterministic seed per match with Save / Replay / Copy / Favorite seed.

---

## 12. Progression, score and records

Kept independent (masterplan §32): level progression, difficulty progression, profile XP, score, achievements.

- **Profile XP (G11):** each human-controlled profile has 5 levels. Each level unlocks one ability rank or one unit
  variant for that profile. Losing still earns some XP; AI-controlled profiles earn none. XP is stored; level is derived.
- **Score:** (base + primary performance + secondary objectives + efficiency + tactical bonuses) × difficulty
  multiplier. Attacker score is driven by objective progress, surviving capacity, efficiency and timing; Defender
  score by protection, prevented progress, efficiency and surviving key defenses.
- **High scores** per stage, level, side, difficulty and team size; Chaotic also stores the seed.
- **Statistics** as masterplan §38.
- **Achievements (R4):** 45–60 for Stage 1 in the masterplan's categories, rewarding badges, titles, gallery art and
  cosmetics, not gameplay power. Includes the hidden **"Spot Guo"** (§16).

---

## 13. Saves

One local save on the PC behind a Save Manager: versioned schema, atomic write (temp → validate → replace),
rolling backups, validation, migration of old saves, autosave after matches, XP, unlocks, seeds and setting changes,
and export/import (R2). No accounts, no cloud. No mid-match saving.

---

## 14. Wi-Fi multiplayer (R2 1v1, R4 2v2)

- The PC is the host and owns the simulation and the save. Clients only send commands and display the state.
- **Join:** QR code, 6-digit room code (shown as `247 433`, typed as six digits), manual address, automatic discovery
  where practical. A separate session token validates the connection.
- **First host on Windows (G14):** before the Windows firewall prompt appears, the game explains in one screen why it
  appears and to choose "Private networks". The lobby always shows QR code, room code and address with the actual port.
- **Lobby:** slots per side (A1/D1, or A1/A2/D1/D2), each Human or AI; players pick empty slots, the host can move
  players; Ready locks a player's choices; all humans ready to start; AI slots are ready automatically.
  Host picks stage, level, difficulty from the host's unlocks; guests may play content they have not unlocked.
- **Disconnects:** a guest who drops is replaced by AI until they reconnect; if they never return, AI finishes.
  If the host stops, the match ends. New players cannot join a running match.
- **Pings (R4):** Attack Here, Defend Here, Watch Route, Need Support, Ready, Danger, visible to teammates only.
  No voice or text chat.

---

## 15. Controls and interface

**Camera:** angled strategic 3D camera with pan, zoom, rotate, focus, jump to alert; angles limited to useful ranges.
Desktop: left drag/edge pan, wheel zoom, right drag rotate, click select, double-click focus.
Touch: one-finger pan, pinch zoom, two-finger twist rotate, tap select, double-tap focus, long-press for info.

**HUD:**
- Attacker: top = timer/objective/difficulty/team; left = waves and groups; bottom = units, formations, deployment;
  right = abilities, commands, shared resource.
- Defender: top = objective and status; left = defenses and mobile assets; bottom = build categories;
  right = abilities, targeting, route controls.
- Hot-seat rearranges both into their own half (§5.2).
- Tablet: panels become drawers and compact bars; minimap collapsible.
- Phone: compact top strip, bottom action bar, swipe-up drawer, floating ability buttons on the right,
  minimap as tap-to-open overlay; only one detailed panel open at a time.

**Onboarding (G7):** a guided ~5-minute Lion tutorial for each side, offered on first launch and replayable from the
menu. Plus the manual (Main Menu → Manual, Pause → Help), small non-blocking first-time hint popups bottom-right
(moved on touch layouts), tooltips on hover / long-press, and "Reset tutorial hints" in Settings.

**Accessibility:** UI scale, text scale, high-contrast route markers, icon + text for every status, camera-shake
toggle, reduced effects, subtitles. Never colour alone for critical state. Layouts fit longer German text and
Chinese characters.

**Settings:** language, graphics preset, audio volumes, key bindings, accessibility, reset hints, save export/import.

---

## 16. Chief Warden Guo (G8)

- Guo's photo (`GuoPhoto.jpg`) is turned by Codex into an **illustrated character, "Chief Warden Guo"**, in the
  game's art style. The raw photo itself is never shown in the game.
- Appears as the narrator portrait in mission briefings, in occasional tip popups, in short victory/defeat quips,
  and in the credits.
- **Easter egg:** in roughly 1 of 20 matches a small Guo portrait appears somewhere in the level (e.g. pinned in a
  ranger post, on a safari jeep door). Clicking/tapping it unlocks the hidden achievement **"Spot Guo"**.
- Neutral to both sides: Guo narrates for whichever side the player chose.

---

## 17. Cinematics and stage art (G9)

- **Game intro movie:** one 10-second, 16:9, **720p** clip made with easemate.ai image-to-video (80 credits) from a
  Codex-generated key image. Plays on first launch; skippable; replayable from the gallery.
- **Stage 1 intro clip:** a second clip once credits rebuild (about 8 days of check-ins).
- **Short level intros:** a still level-info picture per level with a slow camera push and subtitles, no video credits.
- **Title and all text are drawn by the game** on top of the video, in the current language, not baked into clips.
- **Stage info pictures:** one Stage 1 info picture plus one info picture per level, used on the stage/level select
  and briefing screens. Codex prompts are delivered with the implementation plan.
- Gallery (R3): Cinematics, Result Artworks, Big Five, Environment Art, Achievement Art; locked items as silhouettes.
- Result screen: Attacker always left, Defender right, 50/50 split, winner emphasised, complementary artworks per level
  (attacker win / defender win, from each side's view).

---

## 18. Audio (G10)

- Music and sound come from free **CC0** libraries (e.g. Kenney, OpenGameArt CC0, freesound CC0), plus ambience
  generated in code. Every file's source and licence is recorded in an asset list.
- Adaptive layered music: preparation calm → wave tension → breakthrough intensity → final objective climax →
  victory/defeat cue. Savanna atmosphere without cultural caricature.
- Per-level ambience (wind, insects, birds, water, reeds) that also helps orientation; information sounds for
  detection, route threatened, ability ready, wave ready, objective threatened, ping; subtle per-profile sound identity.

---

## 19. Visual style and performance (G2)

- **Stylized low-poly 3D, built in code**, at the quality of the approved sample
  `refinement/G2_lowpoly_sample_v2.png`: authored trees, rocks, grass, water, people, vehicles, structures and
  animals from procedural geometry, flat-shaded materials, warm key light + cool rim light, soft contact shadows,
  sky gradient and layered distant hills, ground route markers.
- Side colours: Attacker orange, Defender blue, always paired with shape/icon so colour is never the only cue.
- **Codex makes all 2D art:** menu and briefing backgrounds, stage/level info pictures, profile portraits, unit and
  defense icons, Chief Warden Guo, result artworks, gallery art, ground texture tiles, the intro key image.
- The threejs-game-skills graphics and QA guidance is used during building (screenshot scoring, render budgets).
- Graphics presets Low / Medium / High / Ultra; presets never hide gameplay-critical things.
- Targets: desktop 60 FPS (min ~45), tablet 45–60 (min 30), phone 30–45 (min 30); simulation independent of frame rate.

---

## 20. AI, developer tools, testing

As masterplan §86–95: AI split into perception, evaluation, decision and command generation, issuing only legal
commands; headless simulation using the same simulation, AI and content; balance matrix (no dominant, useless or
broken profile/matchup); seeded determinism; hidden developer mode and performance overlay; local-only telemetry and
match event log; testing gates per stage before release.

---

## 21. Technology (G15, guidance)

- Browser client: **Vite + React + TypeScript + Three.js** (no Next.js).
- Local server: **Node.js + WebSockets**, authoritative simulation; bundled runtime and `start.bat` / `start.sh`.
- Simulation package has no dependency on rendering, DOM, network or filesystem.
- Data-driven stage packs with schema validation; Vitest and Playwright for tests.
- Git: `main` stable, `develop` integration, `feature/*` work.

---

## 22. Out of scope for 1.0

Internet matchmaking, cloud accounts and saves, public servers, host migration, joining a running match, spectators,
stage editor and user stages, mods, auto-updater, ranked play, global leaderboards, voice and text chat,
tablet/phone split-screen, runtime-generated video.

---

## 23. Decision log

| Gap | Decision |
|---|---|
| G1 Scope | Release ladder R1–R4 |
| G2 Visuals | Stylized low-poly 3D built in code, v2 sample quality; Codex for 2D |
| G3 Tone | Non-violent, family-friendly; Hunter keeps its name |
| G4 Hosting | PC always hosts; one save on the PC |
| G5 Hot-seat | PC only, shared screen, Attacker keyboard (WASD cursor, 1–4, T/Z/U, Tab, Space; rebindable), Defender mouse; tablets one player only, no split-screen |
| G6 Pacing | 10–15 min; pause and 2× in single player; host-only pause on Wi-Fi |
| G7 Onboarding | Guided Lion tutorial per side |
| G8 Guo's photo | Chief Warden Guo narrator + "Spot Guo" easter egg |
| G9 Intro | One 720p 10s game intro now; Stage 1 clip later; text drawn by the game; plus Codex stage info pictures |
| G10 Audio | CC0 libraries + generated ambience |
| G11 Profile XP | 5 levels, each unlocks an ability rank or unit variant |
| G12 Language | Browser detect + first-launch picker |
| G13 Visibility | Defender sees detected units; Attacker remembers seen defenses |
| G14 Windows LAN | Explain firewall prompt first; lobby shows QR, code, address |
| G15 Tech | Vite + React + Three.js, Node + WebSockets |
| Team modes | All 1v1 and 2v2 human/AI combinations kept (§5.0); hot-seat 1v1 only |
| Waves | Real-time waves confirmed (continuous clock, Attacker launches manually built waves); turn-based not used |
