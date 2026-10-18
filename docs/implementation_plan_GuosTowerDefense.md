# Guo's Tower Defense: Implementation Plan

**Based on:** `specification_GuosTowerDefense.md` (approved 2026-10-13) · **Date:** 2026-10-13
**Repository:** https://github.com/shengguo2026/GuosTowerDefense_Claude · **Art prompts:** `art_prompts_GuosTowerDefense.md`

The plan follows the release ladder R1–R4 (spec §4). Every milestone ends with something Guo can start with
`start.bat` and play or look at, plus automated tests. Nothing is merged to `main` until Guo has tried it.

---

## 1. How we work

- **Branches:** `main` = last approved release, `develop` = integration, `feature/<milestone>-<topic>` for work.
  Claude opens a pull request per milestone step into `develop`; when a release is done, `develop` → `main`.
- **Checks on every pull request:** type check, lint, unit tests, content validation, headless simulation tests,
  and Playwright screenshot tests (desktop 1920×1080, tablet 1180×820, phone 844×390).
- **Guo's checkpoints:** at the end of each milestone Guo gets a short note: what to try, the screenshots, and what
  to look for. Gameplay or design changes found there go back into the spec first.
- **Art hand-off:** Guo saves Codex images to `C:\AI\Claude\GuosTowerDefense\assets\art\<id>.png` using the ids from
  the prompt file. Until an image exists, the game shows a clean placeholder with the same size, so art never blocks
  code.
- **Graphics and QA guidance:** the threejs-game-skills pack (graphics builder, UI designer, QA/release, debug
  profiler) is used during building; its screenshot scorecard and render budgets are part of milestone acceptance.

---

## 2. Repository layout

```text
GuosTowerDefense_Claude/
├── apps/
│   ├── client/            Vite + React + TypeScript + Three.js (menus, HUD, 3D view, input adapters)
│   └── server/            Node.js host: authoritative match runner, WebSocket gateway, save manager, launcher API
├── packages/
│   ├── sim/               pure TypeScript simulation (no DOM, Three.js, network or filesystem)
│   ├── content-schema/    Zod schemas + validator for stage packs
│   ├── ai/                perception → evaluation → decision → commands
│   ├── protocol/          command and snapshot message types shared by client and server
│   ├── i18n/              EN / DE / ZH-CN text loading and fallback
│   └── test-kit/          headless match runner, fixtures, balance helpers
├── content/stages/
│   ├── stage-01-big-five/ levels, profiles, units, defenses, abilities, texts, plugins
│   └── test-stage/        small dummy stage proving stage independence (spec §2.1)
├── assets/                art (from Codex), audio (CC0, with licence list), video
├── tools/                 launcher packaging, content validator CLI, balance simulator
├── docs/                  specification, manual sources, art prompts, asset licence list
├── start.bat / start.sh   player entry points
└── favicon.svg
```

Key technical rules: the server runs the simulation at a fixed 20 ticks per second; clients send commands and
render interpolated snapshots; all randomness is seeded; content is loaded and validated at startup; a broken
optional stage pack is skipped with a warning instead of stopping the game.

---

## 3. R1: Lion (first playable release)

### M0 Foundation
- Monorepo with npm workspaces, TypeScript strict, Vitest, Playwright, ESLint/Prettier.
- `sim` skeleton: fixed tick loop, seeded RNG, entity store, command queue, event log.
- `content-schema` with validator CLI; `test-stage` with 2 levels and 2 profiles per side.
- Server: HTTP for the client, WebSocket channel, health check; `dev.bat` / `start.bat` (dev mode).
- Client: app shell, language picker (browser detect + first-launch choice), empty 3D scene, favicon.svg.
- Save Manager v1 (settings and unlocks; atomic write + one backup).

**Done when:** client and server start with one command; client connects; empty scene renders; headless test
match of `test-stage` runs to the end; EN/DE/ZH switch works; save survives restart; validator runs in CI.

### M1 Lion world and camera
- Lion terrain, Ridge and Riverbed routes, Acacia Junction, Rocky Ridge, Dry River Crossing, Lion Waterhole, built in
  code at the v2 sample quality (instanced grass, authored acacias, rocks, water, lions, distant hills).
- Route graph from level data, drawn as ground markers; render adapter reads simulation state only.
- Camera: desktop (drag, wheel, right-drag, edge pan, double-click focus) and touch (pan, pinch, twist, double-tap).
- Graphics presets Low/Medium/High; first performance budget per device class.

**Done when:** the Lion map renders on desktop, tablet and phone viewports at target FPS on Guo's PC; screenshot
scorecard reaches "premium stylized" in world, lighting and materials.

### M2 Core match loop (Explorer vs Ranger)
- Attacker: wave builder (units, quantity, formation Column/Spread, route, launch delay), deployment capacity,
  launch, group movement on the graph, reroute/hold at junctions, retreat with partial refund.
- Defender: build zones, Observation Post (detection), Temporary Checkpoint (slow + intercept), Ranger Patrol (mobile
  intercept), upgrade/repair/sell, target priorities, focus target.
- Explorer abilities Reconnaissance, Rapid Reroute; Ranger abilities Rapid Response, Intercept.
- Detection (Unknown/Detected/Identified), Open Ground Exposure, non-lethal "stopped/turned back" outcome.
- Objective zone with hold timer, economy (income + bonuses), match timer, victory/defeat, 50/50 result screen,
  "never block every route" rule enforced.

**Done when:** a full match can be played start to finish by two humans through debug controls; either side can
win; all rules above are covered by simulation tests.

### M3 AI for Explorer and Ranger
- AI for both sides at Easy, Medium, Hard, using only legal commands and the same visibility.
- Developer view of AI reasoning; headless AI-vs-AI runs for balance.

**Done when:** human vs AI works for either side at all three difficulties; 200 headless matches per difficulty
show no crash and no side winning more than ~70% at the same difficulty.

### M4 Menus, HUD and onboarding
- Main menu, stage/level select with stage info pictures, side/profile/difficulty pick, briefing with
  Chief Warden Guo, pause menu, settings (language, graphics, audio, controls, accessibility, reset hints).
- HUD layouts for desktop, tablet (drawers) and phone (compact strip, action bar, swipe-up drawer).
- Key binding editor; keyboard shortcuts for single player.
- Pause and 1×/2× speed in single player; 20-minute default timer.
- Guided tutorial for each side (~5 minutes on Lion); first-time hint popups; tooltips; basic manual pages.
- Sound effects from CC0 packs for UI and core events.

### M5 Hot-seat
- Hot-seat setup flow; split HUD (Attacker left half with route schematic, Defender right half).
- Attacker keyboard map (W/A/S/D cursor, 1–4, T/Z/U, R, Enter, Tab, Space, F/G/H, X/C/V/B, P) using physical key
  positions; Defender mouse map with command wheel; 3 planning pauses × 20 s per player.

**Done when:** two people can play a full hot-seat match on one PC without key or camera conflicts.

### M6 Tablets, phones and packaging
- "Play on tablet/phone" screen on the PC showing a QR code and address; a tablet/phone joins the PC and plays single
  player vs AI by touch.
- Windows firewall explainer before first network use.
- Packaged build: bundled Node runtime, `start.bat` that finds a free port, checks user-data, waits for health,
  opens the browser.

**R1 release gate:** fresh unzip on Guo's PC → `start.bat` → tutorial → win and lose a match on each side →
hot-seat match → tablet and phone single player over Wi-Fi → restart keeps settings and unlocks.

---

## 4. R2: All profiles and Wi-Fi

- **M7 Ability building blocks and all six profiles:** generic ability/command system (spec §2.1); Hunter,
  Photographer, Wildlife Protector, Field Researcher with all units, assets, passives and abilities; Concealed and
  Stealth units, sensors, reveal; disruption and dismantling; route manipulation (slow, roadblock, temporary close);
  status effects; data-generated HUD and key slots. `test-stage` profiles exercise the same system.
- **M8 AI for all profiles** at Easy/Medium/Hard; balance simulator over the 9 matchups on Lion.
- **M9 Wi-Fi 1v1:** Host/Join, QR, 6-digit room code + session token, manual address, discovery where practical,
  lobby with slots/ready, network human controller, disconnect → AI takeover → reconnect, host-only pause.
- **M10 Progression:** profile XP (5 levels, unlocks), score, high scores, statistics, autosave rules, rolling
  backups, migration framework, export/import.

**R2 release gate:** all 9 matchups playable and winnable by both sides on Lion; Wi-Fi match PC vs tablet and PC vs
phone including a forced disconnect/reconnect; saves from R1 load.

---

## 5. R3: Big Five campaign

- **M11 Leopard** (Concealment Zones, LOS types) · **M12 Elephant** (Terrain Weight, Route Capacity) ·
  **M13 Rhinoceros** (Close Contact, Ambush Zones) · **M14 Buffalo** (Herd Movement plugin, Multi-front Pressure).
  Each: map in code, mechanics, AI understanding of the map, tutorial hints, info picture, result artworks.
- **M15 Campaign and presentation:** level unlock chain, Stage 1 completion (per side), intro movie player with
  localized title overlay and subtitles, level intros, gallery, result artworks on the 50/50 screen, adaptive music
  and per-level ambience, full manual.

**R3 release gate:** Stage 1 completable on both sides; every profile can complete each objective; performance
targets on all five maps; manual and texts complete in EN/DE/ZH.

---

## 6. R4: Mastery and 1.0

- **M16 2v2:** team size 2 with every combination in spec §5.0: Human + AI vs AI + AI as single player on any
  device, and all Human + Human mixes over Wi-Fi; shared team resource and actions, pings, team HUD,
  asset ownership.
- **M17 Advanced difficulties:** Extreme and Ultimate AI; Chaotic route generator keeping landmarks, seed
  save/replay/copy/favorite; large automated seed sweep.
- **M18 Achievements and polish:** 45–60 achievements incl. "Spot Guo", achievement UI, Big Five montage, statistics
  UI, graphics preset Ultra, mobile performance pass.
- **M19 Balance, stability, release candidate:** full balance matrix, network and performance stress, save
  migration tests, feature freeze, full regression from fresh install → **Guo's Tower Defense 1.0**.

---

## 7. Art and media timeline

| Needed for | Assets (ids from the prompt file) |
|---|---|
| Now (credits) | INTRO-KEY image → easemate.ai game intro video |
| R1 (M4) | MENU-BG, STAGE-01, LEVEL-01-LION, GUO-1…4, PORTRAIT-EXPLORER, PORTRAIT-RANGER, R1 icons, TEX-GRASS, TEX-DIRT |
| R2 (M7) | remaining 4 portraits, R2 icons |
| R3 (M11–M15) | LEVEL-02…05, STAGE1-INTRO-KEY + Stage 1 video (when credits allow), result artworks |
| R4 (M18) | achievement badge art, Big Five montage art |

Audio: CC0 packs are chosen by Claude during M4/M15; each file's source and licence goes into `docs/asset-licences.md`.

---

## 8. Risks and how they are handled

| Risk | Handling |
|---|---|
| Phones too slow for the 3D scene | per-device budgets from M1, instancing, presets, Playwright FPS checks on phone viewport |
| Wi-Fi blocked by Windows firewall or router isolation | explainer screen, manual address fallback, troubleshooting page in the manual |
| AI too weak or too strong | headless balance runs in CI from M3; difficulty tuning in data |
| Stage 1 assumptions leak into the engine | `test-stage` must keep passing (spec §2.1) |
| Art arrives late | same-size placeholders; art is swapped by file name only |
