# Guo's Tower Defense

An asymmetric, non-violent tower-defense strategy game played in the browser. Play the **Attacker**, who sends
waves of groups along a route network to reach an objective, or the **Defender**, who builds and commands
non-lethal defenses to stop them. The PC hosts the game; tablets and phones on the same Wi-Fi join through it.

- What the game does: [`docs/specification_GuosTowerDefense.md`](docs/specification_GuosTowerDefense.md)
- How it is built, milestone by milestone: [`docs/implementation_plan_GuosTowerDefense.md`](docs/implementation_plan_GuosTowerDefense.md)

## Play (packaged build)

`npm run package` makes `release/GuosTowerDefense-<version>-win-x64.zip` (add `-- --target linux-x64` or
`-- --target darwin-arm64` for other systems). The zip holds the game, its own Node.js runtime and `start.bat`: unzip it
anywhere, double-click `start.bat`, and the browser opens. Nothing needs to be installed. The launcher checks the game
files and the `user-data` folder, takes the first free port from 3000, waits until the game answers and opens the
browser. Pictures in `assets/art` are packed as they are on the PC that builds the zip.

**Tablets and phones:** main menu › **Tablet or phone** on the PC. The first time on Windows a screen explains the
firewall question ("Private networks", "Allow access"); then the PC shows a QR code and the address with the actual port.
A tablet or phone in the same Wi-Fi opens it and plays single player by touch. The game remembers the choice and shares
again at the next start; **Stop sharing** closes it. Without this, the game listens only on the PC itself.

**Wi-Fi 1v1:** main menu › **Wi-Fi play** › **Open a game** on the PC. The lobby shows a QR code, the 6-digit room code
(`247 433`) and the address with the actual port. A tablet or phone in the same Wi-Fi scans the code (it opens straight
into the lobby) or opens the address and types the room code under **Wi-Fi play**. Each player picks a profile and gets
ready; the host picks the level and how well the computer plays, can swap sides or let the computer play the open side,
and starts. Only the host can pause; the speed stays 1×. If a device drops out, the computer plays its side until it
comes back (a reload or a new tab on the same device finds its way back with the session token stored there); new
players cannot join a running match, and when the host closes the game it ends for everyone. Another PC with the game
installed joins by typing this PC's address, or finds it with **Search the network** (UDP port 41779; routers and guest
networks may block this, the address always works).

## Play (development build)

Needs [Node.js](https://nodejs.org) 20.19 or newer (LTS).

| Windows | macOS / Linux | What it does |
|---|---|---|
| `start.bat` | `./start.sh` | Installs libraries on first run, builds the client, starts the game server on the first free port from 3000, opens the browser |
| `dev.bat` | `./dev.sh` | Developer mode: game server on port 3100 with auto-restart, client with hot reload on port 5173 |

Progress and settings live in `user-data/` next to the game files, so copying the folder keeps them. The save is
written after every match and every change (`user-data/saves/save.json`); the last five versions stay in
`user-data/backups/`, and a damaged save is kept aside there while the newest readable backup is used. Settings › **Save**
exports the save to a file and imports one back (on the PC only).

**Progress:** every finished match (against the computer, two players on one PC, or Wi-Fi) gives each side a score; the
sides people play also earn profile XP, high scores and statistics, all in the one save on the PC. Each profile has five
levels; levels 2 to 5 each unlock one small improvement (an ability rank or a better unit or defense) that a person's
profile uses in every mode, while the computer always plays the starting kit. A win against the computer still unlocks
the next level. Main menu › **Progress** shows levels and unlocks, high scores and statistics.

In the current build, **Open the Lion level** shows the first level with a demo match the server plays by itself.
Camera: drag (or one finger) to move, right-drag (or two-finger twist) to rotate and tilt, wheel (or pinch) to zoom,
double-click (or double-tap) to focus. **F3**, or `?debug` in the address, shows frame rate, draw calls and triangles.
Graphics quality is in Settings; Automatic picks Low on phones, Medium on tablets and High on PCs.

## Layout

```text
apps/client/            Vite + React + TypeScript + Three.js
apps/server/            local host: HTTP, WebSocket, Save Manager, content loading
packages/sim/           deterministic simulation (no DOM, rendering, network or filesystem)
packages/content-schema stage-pack schemas, loader, validator CLI
packages/protocol/      messages and shared data shapes between client and server
packages/i18n/          EN / DE / ZH-CN texts, language detection and fallback
packages/progression/   score, XP and profile-level rules shared by server and client
packages/test-kit/      headless match runner and scripted controllers
content/stages/         stage packs (test-stage proves stage independence)
docs/                   specification, plan, masterplan, art prompts
e2e/                    Playwright browser tests
tools/                  launcher, packaging and helper scripts
```

## Checks

```sh
npm install
npm run check              # type check, lint, format, unit tests, content validation
npm run test:e2e           # browser tests at desktop 1920×1080, tablet 1180×820, phone 844×390
npm run validate:content   # validate every stage pack
npm run simulate           # headless matches of every level and profile pairing of the test stage
npm run balance            # 200 AI-vs-AI matches of Lion per difficulty (Explorer vs Ranger); add --all for all
                           # nine profile matchups, --attacker=hunter / --defender=ranger for one, --matrix for every pairing
npm run package            # player zip with bundled Node.js runtime (release/)
```

## Branches

`main` is the last approved release, `develop` is integration, and work happens on feature branches with one pull
request per milestone step.
