# Guo's Tower Defense — Master Plan

**Project repository:** `https://github.com/shengguo2026/GuosTowerDefense`

**Canonical master-plan filename:** `masterplan_GuosTowerDefense.md`

**Existing project asset:** `favicon.svg`

**Internal project ID:** `guos-tower-defense`

---

# 1. Project Identity

## 1.1 Localized titles

- English: **Guo's Tower Defense**
- German: **Guos Tower Defense**
- Simplified Chinese: **盛国的塔防游戏**

English is the canonical/fallback language.

All player-facing text must support:

- `en`
- `de`
- `zh-CN`

The internal project ID and technical identifiers must remain language-independent.

---

# 2. High-Level Game Concept

Guo's Tower Defense is a local browser-based asymmetric 3D tower-defense strategy game.

The defining feature is that the player may play either side:

- **Attacker**
- **Defender**

The game must support:

- Human vs AI
- AI vs Human
- 2v2 team play
- Human + AI teams
- Human + Human teams
- local Wi-Fi multiplayer
- headless AI-vs-AI simulation for development and balancing

The core engine must be generic enough to support future stages whose themes, units, resources, environments, objectives, and mechanics may be completely different from Stage 1.

Do not architect the engine specifically around hunters, animals, South Africa, or the Big Five.

---

# 3. Core Architectural Principle

The authoritative flow must be:

```text
UI / Rendering
      ↓
Player or AI Commands
      ↓
Authoritative Simulation
      ↓
Game State + Events
      ↓
UI / Rendering
```

React, Three.js, and browser components must never be the source of truth for match state.

The simulation must be independent of rendering.

---

# 4. Recommended Technology Stack

Use current stable compatible versions at implementation time.

Recommended stack:

```text
Next.js + TypeScript
→ menus, HUD, lobby, settings, manual, gallery, application shell

React Three Fiber + Three.js
→ 3D battlefield rendering

Node.js local server
→ authoritative simulation
→ local Wi-Fi hosting
→ AI
→ saves
→ telemetry

Socket.IO
→ LAN real-time communication

Zod or equivalent
→ runtime schema validation

Vitest or equivalent
→ automated/unit/simulation tests
```

Do not hard-code dependency versions from this document if a newer stable compatible release exists when implementation begins.

---

# 5. Repository Architecture

Recommended monorepo structure:

```text
GuosTowerDefense/
│
├── apps/
│   ├── game-client/
│   └── game-server/
│
├── packages/
│   ├── simulation/
│   ├── game-types/
│   ├── content-schema/
│   ├── stage-content/
│   ├── ai/
│   ├── networking/
│   ├── save-system/
│   ├── localization/
│   └── testing/
│
├── content/
│   ├── common/
│   └── stages/
│
├── assets/
│   ├── source/
│   └── runtime/
│
├── docs/
│   ├── MASTER_SPECIFICATION.md
│   ├── stages/
│   ├── player-manual/
│   └── templates/
│
├── tools/
│   ├── stage-validator/
│   ├── balance-simulator/
│   └── asset-pipeline/
│
├── favicon.svg
└── masterplan_GuosTowerDefense.md
```

The exact physical layout may be improved by Codex during technical review, but the separation of responsibilities must remain.

---

# 6. Existing favicon.svg

The project root already contains:

```text
favicon.svg
```

Codex must use this file as the favicon/application identity asset.

Do not generate or replace it unless explicitly requested later.

It should be integrated into the Next.js metadata/application configuration.

---

# 7. Simulation Engine

The simulation package must have no dependency on:

- React
- Next.js
- Three.js
- DOM
- Canvas
- Socket.IO
- filesystem APIs

It should define generic game concepts such as:

```text
Side
Team
PlayerSlot
Controller
Profile
Unit
Defense
Ability
Resource
Objective
StatusEffect
RouteGraph
Wave
Group
Combat
Economy
Progression
Score
Achievement events
```

Core side enum:

```text
ATTACKER
DEFENDER
```

---

# 8. Controller Architecture

Use a generic controller abstraction:

```text
Controller
├── LocalHumanController
├── NetworkHumanController
└── AIController
```

Controllers produce legal game commands.

Examples:

```text
DeployGroup
ChooseRoute
ChangeFormation
ActivateAbility
PlaceDefense
UpgradeDefense
RepairDefense
AssignPatrol
ChangeTargetPriority
FocusTarget
Ping
```

The simulation must not care whether a command originates from:

- local mouse
- touchscreen
- remote LAN player
- AI

---

# 9. Team Architecture

The conceptual model is always:

```text
Team vs Team
```

Team size may be:

```text
1
2
```

Supported 1v1:

- Human vs AI
- AI vs Human
- Human vs Human over LAN

AI vs AI is development/debug/balance only.

Supported 2v2 examples:

```text
Human + AI vs AI + AI
Human + Human vs AI + AI
Human + AI vs Human + AI
Human + Human vs Human + Human
Human + Human vs Human + AI
```

Each participant requires internal identifiers:

```text
playerId
teamId
slotId
side
controllerType
displayName
profileId
```

Display names are never persistent identity keys.

---

# 10. Player Naming

1v1 defaults:

```text
Attacker
Defender
```

2v2 defaults:

```text
Attacker 1
Attacker 2
Defender 1
Defender 2
```

Human players may edit their display names.

AI names remain fixed.

No formal player-account system exists in V1.

---

# 11. Data-Driven Stage-Pack Architecture

The engine must be stage-independent.

Each stage package may define:

```text
metadata
levels
environments
attacker profiles
defender profiles
resources
units
defenses
abilities
objectives
AI configuration
difficulty variants
achievements
artwork
audio
localization
mechanic plugins
```

Future stage addition should resemble:

```text
content/stages/
├── stage-01-big-five/
├── stage-02-.../
└── stage-03-.../
```

Avoid core code such as:

```text
if profile === "Explorer"
```

or:

```text
if stage === "SouthAfrica"
```

unless contained inside the appropriate stage mechanic/data layer.

---

# 12. Generic Resource Model

Resources must be data-driven.

A resource definition may include:

```text
id
owner scope
initial amount
maximum amount
regeneration
icon
localized name
usage rules
```

Resource concepts:

1. Personal Profile Resource
2. Shared Team Tactical Resource
3. Match/base income layer

Personal resources cannot normally be freely transferred between teammates.

---

# 13. Generic Objective Model

Objectives should be composed from reusable mechanics such as:

```text
ReachZone
HoldZone
InteractWithTarget
ProtectTarget
CaptureTarget
DestroyTarget
CollectItems
SurviveDuration
EscortUnit
```

Future stages should compose these rather than requiring completely new core code whenever possible.

---

# 14. Optional Stage Mechanic Plugins

Static data will not cover every future mechanic.

Support optional mechanic plugins such as:

```text
BuffaloHerdMovementPlugin
ElephantWaterCrossingPlugin
LeopardConcealmentPlugin
WeatherPlugin
DayNightPlugin
MovingTargetPlugin
TeleportGatePlugin
```

Use plugins only when ordinary configuration is insufficient.

---

# 15. Content Validation

Provide automated schema validation for:

- missing localization keys
- invalid profile references
- invalid units
- invalid abilities
- invalid resources
- invalid objectives
- missing objective zones
- invalid paths
- unreachable objectives
- invalid Chaotic constraints
- missing assets
- invalid achievement triggers

Broken optional stage packs should not necessarily prevent the entire game from launching.

---

# 16. Match Lifecycle — Single Player

```text
Main Menu
→ Single Player
→ Select Stage
→ Select Level
→ Choose Side
→ Choose Profile
→ Optional display-name edit
→ Difficulty
→ Mission Briefing
→ Preparation
→ Match
→ Victory / Defeat
→ 50/50 Result Presentation
→ Score / XP / Achievements / Unlocks
→ Next Level / Replay / Menu
```

---

# 17. Match Lifecycle — Team / LAN

```text
Local Multiplayer
→ Host / Join
→ Team Size
→ Lobby
→ Stage
→ Level
→ Side/Slot Assignment
→ Profile Selection
→ Optional Names
→ Ready
→ Match
→ Team Result
→ Host Progression Save
→ Rematch / Lobby / Menu
```

---

# 18. Difficulty System

Difficulty progression:

```text
Easy
Medium
Hard
→ Extreme
→ Ultimate
→ Chaotic
```

Easy, Medium, and Hard are initially available.

Unlock per level and per side:

```text
Beat Hard
→ unlock Extreme

Beat Extreme
→ unlock Ultimate

Beat Ultimate
→ unlock Chaotic
```

Difficulty should primarily improve:

- AI decision quality
- reaction quality
- resource efficiency
- tactical coordination
- route complexity
- punishment for mistakes

Do not create difficulty mainly through arbitrary health/damage inflation.

AI must follow the same:

- visibility
- cooldown
- resource
- placement
- path
- ability

rules as human players.

---

# 19. Chaotic Mode

Chaotic is a special replayability/endgame mode.

It should include:

- strongest heuristic AI
- procedurally generated valid route networks
- randomized branches
- connectors
- chokepoints
- build zones
- minor obstacles
- stage-specific terrain variation
- preserved major landmarks
- retained level identity

Every match receives a deterministic seed.

Support:

```text
Save Seed
Replay Seed
Copy Seed
Favorite Seed
```

Same seed + same relevant generation configuration should reproduce the same map.

AI must analyze the generated graph dynamically.

The generator must guarantee at least one valid attacker route.

---

# 20. Route Network

Gameplay routes are graph structures, not merely visual splines.

```text
RouteGraph
├── Nodes
└── Edges
```

Node examples:

```text
Spawn
Junction
Checkpoint
Connector
Objective
```

Edge properties may include:

```text
length
terrain
capacity
movement modifier
visibility modifier
blocked state
```

Attacker can:

- choose route before deployment
- assign different routes to different groups
- reroute at valid junctions
- hold at junctions where allowed

No arbitrary freeform path drawing.

No teleporting between branches.

---

# 21. Route Manipulation Rule

Defender may:

- slow branches
- create chokepoints
- deploy temporary roadblocks
- increase detection
- temporarily close branches
- influence route pressure

Absolute rule:

> Defender must never be able to block every legal path to the objective.

Validation and runtime logic must enforce this.

---

# 22. Hybrid Tactical Wave System

Do not use classic fixed automatic waves.

The attacker manually constructs tactical waves.

Flow:

```text
Preparation
→ Defender prepares
→ Attacker prepares wave
→ Launch
→ Combat
→ Attacker prepares next wave while current wave is active
```

There is:

- minimum preparation/cooldown
- limited wave overlap
- continuous defender actions

An attacker wave can contain multiple groups.

Each group can define:

```text
units
quantity
formation
route
launch delay
```

Groups consume deployment capacity rather than simply a fixed unit count.

---

# 23. Attacker Group Commands

Possible commands:

```text
Reroute
Hold
Advance
Retreat
Abort
Disperse
Regroup
Formation Change
Ability Use
```

Exact commands depend on profile.

Retreat/abort may provide partial refunds.

A wave ends when:

- all units are defeated
- all survivors complete the objective
- attacker abandons remaining units

Wave result does not necessarily equal match result.

---

# 24. Defender Placement

Hybrid placement system.

Major structures:

```text
predefined strategic build zones
```

Light tactical assets:

```text
freer placement in legal terrain
```

Mobile units:

```text
patrol / response / guard zones
```

Major structures may support:

```text
build
upgrade
repair
restricted relocation
dismantle/sell
```

---

# 25. Combat System

Use hybrid automated combat.

Basic attacks are automatic.

Defender can configure target priorities:

```text
FIRST
LAST
STRONGEST
WEAKEST
FASTEST
SPECIAL
```

Profiles may add custom priorities.

Limited manual:

```text
Focus Target
```

must respect range and visibility.

---

# 26. Interaction Categories

Combat/interaction categories:

```text
DIRECT
AREA
SLOW
DISRUPTION
DETECTION
CONTROL
```

Attacker interaction with defenses:

```text
1. Avoid
2. Disrupt
3. Destroy
```

Every defender asset declares:

```text
disruptible
destructible
both
neither
```

Destroying defender structures must remain secondary to completing the main attacker objective.

---

# 27. Stealth and Detection

Detection states:

```text
Unknown
Detected
Identified
```

Attacker visibility types:

```text
Normal
Concealed
Stealth
```

Stealth must never mean permanently untargetable.

Sensors, scouting, or abilities may reveal stealth for a period.

---

# 28. LOS and Terrain

Environment objects may be:

```text
LOS blocker
Partial cover
Decoration only
```

Simplified but meaningful LOS must be used.

---

# 29. Status Effects

Core status set:

```text
SLOWED
REVEALED
DISRUPTED
PINNED
PROTECTED
BOOSTED
```

Stages may add data-driven effects where appropriate.

---

# 30. Victory Conditions

Primary objective determines match victory.

Defender objective is the inverse:

```text
prevent attacker from completing primary objective
before attacker capacity/time expires
```

Secondary objectives affect:

- score
- XP
- achievements
- resource bonuses

but normally not primary victory.

Attacker has finite overall assault/deployment capacity.

Anti-stalemate maximum match timer exists.

Final objective interaction is normally not instant.

Example:

```text
Reach Zone
→ Hold / Interact
→ Complete
→ Victory
```

Defeat screens should still display partial performance.

---

# 31. Economy

Use hybrid economy.

Both sides receive:

```text
continuous base income
+
event/performance bonuses
```

Attacker examples:

- passive supply
- checkpoint bonuses
- objective-related bonuses
- retreat refunds

Defender examples:

- passive supply
- stopping-wave bonuses
- protection milestones
- efficiency bonuses

Shared team tactical resource is slower and supports coordinated major actions.

---

# 32. Progression Separation

Keep these systems independent:

```text
Stage/Level progression
→ unlock content

Difficulty progression
→ unlock Extreme / Ultimate / Chaotic

Profile XP
→ profile gameplay progression

Score
→ match-performance records

Achievements
→ prestige / recognition / cosmetic rewards
```

Do not turn achievements into the primary gameplay-unlock mechanism.

---

# 33. Local Save

No mandatory player accounts.

There is one main local progression save for the installation/portable game folder.

Persistent data:

```text
metadata
stage progression
difficulty progression
profile XP
profile unlocks
achievements
high scores
statistics
Chaotic seeds
tutorial/help state
settings
stage-specific persistent data
schema version
game version
```

Display names do not create separate progression saves.

---

# 34. Save Architecture

Use:

```text
Game Systems
→ Save Manager API
→ filesystem
```

No other game system should write save JSON directly.

Save system must provide:

```text
versioned schema
atomic writes
rolling backups
validation
migration
autosave
export/import
```

Do not overwrite the main save non-atomically.

Suggested flow:

```text
write temporary save
→ validate
→ atomic replace
→ retain backups
```

---

# 35. Save Versioning

Track separately:

```text
gameVersion
contentVersion
saveSchemaVersion
balanceVersion
```

Old saves should receive migration paths whenever practical.

Do not knowingly break existing saves without migration support.

---

# 36. Autosave

Autosave after:

- match completion
- XP change
- achievement unlock
- level unlock
- difficulty unlock
- seed save
- settings change

Full mid-match saving is not required for V1.

---

# 37. High Scores

High-score scope:

```text
stage
level
side
difficulty
team size
```

Chaotic records also store the seed.

Team score records may include:

```text
display names
profiles
controller types
score
difficulty
date
```

Display name remains non-persistent identity.

---

# 38. Local Statistics

Track useful data from the beginning.

Examples:

```text
matches played
wins
losses
attacker wins
defender wins
1v1 matches
2v2 matches
profile usage
waves launched
reroutes
defenses disrupted
defenses destroyed
attackers stopped
patrol interceptions
detections
Chaotic matches
unique seeds played
```

Statistics may power achievements and the Statistics UI.

---

# 39. Achievements

Achievement data:

```text
achievementId
unlocked
unlockedAt
progress
```

Categories:

```text
Stage Progression
Difficulty/Mastery
Attacker Profiles
Defender Profiles
Level-Specific
Team Play
Chaotic
Hidden
```

Target roughly 45–60 Stage 1 achievements.

Achievement rewards should emphasize:

- badge/icon
- gallery artwork
- cosmetic
- title
- prestige

not major gameplay power.

---

# 40. Important Stage Achievements

Examples:

```text
FIRST ENCOUNTER
THE LION
THE LEOPARD
THE ELEPHANT
THE RHINOCEROS
THE BUFFALO
THE BIG FIVE
BIG FIVE ATTACKER
BIG FIVE DEFENDER
DUAL MASTERY
```

Difficulty examples:

```text
HARDENED
EXTREME SAVANNA
ULTIMATE BIG FIVE
MASTER OF CHAOS
```

Chaotic example:

```text
SEED BREAKER
→ lose a seed, replay same seed, then win
```

---

# 41. Player Manual and Contextual Help

Provide a player manual containing:

```text
Quick Start
Core Rules
Profiles
Units & Defenses
Difficulty
Team Play
Progression
Stage Guide
```

Manual content must live separately from UI implementation.

Main Menu:

```text
Manual
```

Pause Menu:

```text
Help
```

First-time contextual explanations use small non-blocking lower-right popups.

Touch layouts may reposition them to avoid covering controls.

Desktop:

```text
hover → tooltip
```

Touch:

```text
long press / info affordance → tooltip
```

Setting:

```text
Reset Tutorial Hints
```

---

# 42. Stage 1 — South Africa: Get the Big Five

Five levels:

```text
1. Lion
2. Leopard
3. Elephant
4. Rhinoceros
5. African Buffalo
```

Narrative possibilities:

Attackers may be:

- explorers
- photographers
- illegal hunters

Defenders may be:

- rangers
- conservation teams
- researchers

Core engine terminology remains:

```text
Attacker
Defender
```

---

# 43. Stage 1 Progression

Initially unlocked:

```text
Lion
```

Progression:

```text
Lion
→ Leopard
→ Elephant
→ Rhinoceros
→ African Buffalo
```

Win previous level once:

- either side
- any available difficulty

to unlock the next level.

Both sides are playable immediately.

All six Stage 1 profiles are available immediately.

Profile progression unlocks profile capabilities, not profile existence.

---

# 44. Stage 1 Attacker Profiles

## 44.1 Explorer

Identity:

```text
information
mobility
route adaptation
safe objective access
```

Resources:

```text
Expedition Supplies
Recon Points
```

Passive:

```text
Trail Knowledge
```

Abilities:

```text
Reconnaissance
Rapid Reroute
Field Guide
```

Units:

```text
Scout
Guide
Expedition Team
Expedition Vehicle
```

Commands:

```text
Reroute
Hold at Junction
Scout Ahead
Advance
Retreat
Disperse
Regroup
```

Interaction:

```text
Avoid      excellent
Disrupt    limited
Destroy    weak
```

Summary:

> Explorer wins through information, mobility, and route adaptation rather than firepower.

---

# 45. Hunter

Identity:

```text
disruption
assault
breakthrough
```

Resources:

```text
Field Supplies
Tactical Charges
```

Passive:

```text
Target Assessment
```

Abilities:

```text
Sabotage
Breach
Coordinated Assault
```

Units:

```text
Tracker
Hunter Team
Breach Specialist
Off-road Vehicle
```

Commands:

```text
Advance
Rush
Focus Defense
Breach
Hold
Retreat
Disperse
Regroup
```

Interaction:

```text
Avoid      average
Disrupt    excellent
Destroy    good against eligible assets
```

Summary:

> Hunter wins through pressure, sabotage, and breakthrough power rather than superior information.

---

# 46. Photographer

Identity:

```text
stealth
positioning
objective completion
```

Resources:

```text
Field Kit
Focus Points
```

Passive:

```text
Low Profile
```

Abilities:

```text
Concealed Approach
Perfect Position
Snapshot Window
```

Units:

```text
Observer
Camera Team
Spotter
Light Utility Vehicle
```

Commands:

```text
Advance
Hold
Stay Low
Move to Cover
Reroute
Retreat
Set Observation Position
Regroup
```

Interaction:

```text
Avoid      very good
Disrupt    limited
Destroy    almost none
```

Summary:

> Photographer wins through concealment, positioning, timing, and fast objective completion.

---

# 47. Stage 1 Defender Profiles

## 47.1 Ranger

Identity:

```text
mobility
interception
rapid response
```

Resources:

```text
Ranger Supplies
Response Points
```

Passive:

```text
Field Awareness
```

Abilities:

```text
Rapid Response
Intercept
Emergency Reinforcement
```

Mobile assets:

```text
Ranger Patrol
Tracker Team
Rapid Response Vehicle
Senior Ranger Unit
```

Static support:

```text
Observation Post
Temporary Checkpoint
Light Barrier
Patrol Beacon
```

Commands:

```text
Patrol
Intercept
Guard
Respond
Fall Back
Reposition
Focus Target
Escort
```

Summary:

> Ranger wins by being in the right place before the attacker can exploit an opening.

---

# 48. Wildlife Protector

Identity:

```text
static defense
area control
route shaping
```

Resources:

```text
Conservation Supplies
Protection Points
```

Passive:

```text
Protected Ground
```

Abilities:

```text
Conservation Barrier
Protected Zone
Habitat Lockdown
```

Major defenses:

```text
Protection Tower
Heavy Barrier
Conservation Post
Protected Observation Platform
```

Light/environment:

```text
Slow Field
Warning Barrier
Temporary Fence
Environmental Marker
```

Mobile/support:

```text
Protection Team
Maintenance Crew
Animal Relocation Unit
```

Summary:

> Wildlife Protector wins by making every meter more difficult, expensive, and predictable for the attacker.

---

# 49. Field Researcher

Identity:

```text
detection
intelligence
prediction
support
```

Resources:

```text
Research Supplies
Analysis Points
```

Passive:

```text
Behavioral Analysis
```

Abilities:

```text
Area Scan
Route Analysis
Deep Analysis
```

Assets:

```text
Sensor Beacon
Observation Station
Research Team
Surveillance Drone
```

Commands:

```text
Scan
Observe
Track
Mark
Relocate Sensor
Analyze Route
Deploy Drone
Investigate
```

Summary:

> Field Researcher wins by turning uncertainty into actionable information.

---

# 50. Stage 1 Profile Roles

Attacker:

```text
Explorer
→ information / mobility

Hunter
→ disruption / breakthrough

Photographer
→ concealment / objective completion
```

Defender:

```text
Ranger
→ mobility / interception

Wildlife Protector
→ control / fortification

Field Researcher
→ detection / prediction
```

Duplicate profiles on the same 2v2 team are initially not allowed.

Every profile must remain viable in solo 1v1.

---

# 51. Level 1 — Lion

Identity:

```text
open savanna
long visibility
branch pressure
```

Environment:

```text
open grassland
acacia
rocks
dry streambed
waterhole
distant hills
```

Landmarks:

```text
Savanna Entrance
Dry River Crossing
Acacia Junction
Rocky Ridge
Lion Waterhole
```

Main routes:

```text
Ridge Route
Riverbed Route
```

Higher difficulty:

```text
Grassland Detour
connectors
additional junctions
```

Unique mechanic:

```text
Open Ground Exposure
```

Open ground:

- faster
- easier to detect
- more vulnerable to long-range defense

Cover:

- slower
- safer

Primary target:

```text
Lion Waterhole Observation Zone
```

Learning goal:

> Route choice, timing, visibility, and positioning.

---

# 52. Level 2 — Leopard

Identity:

```text
dense woodland
rock
information
detection
chokepoints
```

Routes:

```text
Woodland Trail
Rocky Route
Ravine Connector
```

Unique mechanic:

```text
Concealment Zones
```

LOS:

```text
dense brush = partial
rock wall   = full blocker
ledge       = improved visibility
clearing    = exposed
```

Learning goal:

> Fighting for information in limited visibility.

---

# 53. Level 3 — Elephant

Identity:

```text
large-scale route management
water crossings
heavy terrain
multiple wide branches
```

Routes:

```text
Dry Ridge
Mud Flats
River Crossing
```

Unique mechanics:

```text
Terrain Weight
Route Capacity
```

Narrow crossings cause:

- compression
- slowdown
- reduced reroute flexibility
- increased area-effect vulnerability

Learning goal:

> Terrain-aware composition, route distribution, and crossing control.

---

# 54. Level 4 — Rhinoceros

Identity:

```text
dense bush
short engagements
rapid reactions
close chokepoints
```

Routes:

```text
Thorn Track
Dry Gully
Open Scrub
```

Unique mechanics:

```text
Close Contact
Ambush Zones
```

Characteristics:

- later detection
- less warning time
- mobile defenders more important
- long-range defense less dominant

Learning goal:

> Fast reaction and local positioning.

---

# 55. Level 5 — African Buffalo

Stage 1 finale.

Environment:

```text
wet grassland
shallow marsh
pools
reeds
mud trails
dry ground
herd corridors
```

Routes:

```text
Northern Grass
Southern Mud
Reed Connector
Central Wetland
```

Unique mechanics:

```text
Herd Movement
Multi-front Pressure
```

The buffalo herd:

- moves between predefined target zones/corridors
- is not allowed to teleport unfairly
- has a visible/estimated movement forecast
- may temporarily affect routes
- may never eliminate all legal routes

Learning goal:

> Combined systems, moving objective, multi-front pressure.

---

# 56. Stage 1 Learning Arc

```text
Lion
→ route choice / visibility

Leopard
→ concealment / detection

Elephant
→ terrain / crossings / capacity

Rhinoceros
→ close reaction / local control

Buffalo
→ moving objective / multi-front combined mastery
```

---

# 57. Stage Completion

Stage 1 Complete:

```text
Win all 5 levels at least once
either side
any available difficulty
```

Completion triggers:

```text
Stage completion artwork
Big Five montage
Achievement
Statistics
Future Stage 2 unlock when available
```

Completion is different from mastery.

Possible prestige:

```text
Big Five Complete
Big Five Veteran
Big Five Extreme
Big Five Master
Master of Chaos
```

Track Attacker and Defender completion separately.

Completing all five on both sides can award:

```text
Dual Mastery
```

---

# 58. Score

Score concept:

```text
(
Base Result
+ Primary Performance
+ Secondary Objectives
+ Efficiency
+ Tactical Bonuses
)
× Difficulty Multiplier
```

Difficulty multipliers are data-driven and must be tuned through testing.

Attacker score emphasizes:

- objective progress/completion
- surviving troop value
- resource efficiency
- timing
- secondary objectives

Defender score emphasizes:

- objective protection
- prevented progress
- resource efficiency
- surviving important defenses
- secondary objectives

Defense destruction should not dominate attacker scoring.

---

# 59. XP

XP is separate from score.

Concept:

```text
Completion XP
+ Victory Bonus
+ Difficulty Bonus
+ Secondary XP
+ capped profile-action XP
```

Loss still grants some progression XP.

AI-controlled profiles receive no persistent XP.

Human-controlled profiles receive XP.

XP is stored as source of truth; level may be derived from current progression thresholds.

---

# 60. LAN Multiplayer

One device hosts the authoritative server.

Host device:

```text
runs local server
owns authoritative simulation
owns persistent campaign save
accepts LAN clients
may also play
```

Clients:

```text
browser UI
send commands
receive authoritative state
```

---

# 61. LAN Join Methods

Support:

```text
automatic LAN discovery where practical
QR code
manual host address
6-digit numeric room code
```

Room code format:

```text
000000–999999
```

Example:

```text
247433
```

May display visually as:

```text
247 433
```

but input/storage remains six digits.

Room code identifies the session after reaching the host.

A separate internal session token should provide actual session validation.

---

# 62. Lobby

1v1:

```text
ATTACKER        DEFENDER
A1              D1
Human / AI      Human / AI
```

2v2:

```text
ATTACKERS       DEFENDERS
A1              D1
A2              D2
```

Slot state:

```text
slotId
side
controllerType
connectionId
displayName
profileId
readyState
```

Players may select empty slots.

Host may assign/move players.

Ready state locks a player's current lobby configuration until they unready.

All human players must be ready before match start.

AI slots are automatically ready.

---

# 63. LAN Content Selection

Host selects:

```text
Stage
Level
Difficulty
```

Host progression determines unlocked content.

Guest may participate in host-unlocked content even if it is not unlocked on the guest's own installation.

---

# 64. LAN Disconnect

If non-host human disconnects:

```text
disconnect
→ temporary AI takeover
→ reconnection window
→ human resumes if reconnected
```

If not reconnected:

```text
AI remains until match end
```

Host migration is not required in V1.

If host server disappears:

```text
match ends
```

Existing disconnected players may reconnect.

Completely new players may not join an active match in V1.

---

# 65. Team Pings

Support simple team pings:

```text
Attack Here
Defend Here
Watch Route
Need Support
Ready
Danger
```

Pings are visible only to teammates.

No voice/text chat required for V1.

---

# 66. Shared Team Actions

Players normally control only their own profile assets/groups.

Shared team resources and shared tactical actions are exceptions.

For a shared action:

```text
first valid activation
→ action executes
→ shared resource/cooldown updates for team
```

No voting system required.

---

# 67. Camera

Use a strategic angled 3D camera.

Core actions:

```text
Pan
Zoom
Rotate
Focus
Jump to Ping/Alert
```

Desktop:

```text
left drag / edge drag → pan
mouse wheel           → zoom
right drag            → rotate
click                 → select
double-click          → focus
```

Touch:

```text
one-finger drag       → pan
pinch                  → zoom
two-finger twist      → rotate
tap                    → select
double tap             → focus
```

Camera angles must be constrained to useful ranges.

---

# 68. HUD

Attacker desktop concept:

```text
Top
→ timer / objective / difficulty / team status

Left
→ waves / groups

Bottom
→ units / formations / deployment

Right
→ abilities / tactical commands / shared resource
```

Defender:

```text
Top
→ objective / match status

Left
→ defenses / mobile assets

Bottom
→ build categories

Right
→ abilities / targeting / route controls
```

Mobile/tablet converts persistent panels into drawers and compact action bars.

---

# 69. Mobile UX

Landscape-first.

Preferred:

```text
phone/tablet landscape
```

Portrait may show:

```text
Rotate device for the full game experience.
```

Phone:

```text
top compact status strip
bottom action bar
swipe-up drawer
right floating ability controls
```

Only one detailed panel should normally be open at a time.

---

# 70. Minimap

Show:

- routes
- junctions
- objective
- friendly assets
- known enemy assets
- team pings
- Buffalo herd where appropriate

Respect fog/information rules.

Hidden/undetected entities must not appear magically.

Desktop:

```text
persistent
```

Tablet:

```text
collapsible
```

Phone:

```text
tap-to-open overlay
```

---

# 71. Accessibility

Provide:

```text
UI scale
text scale
high-contrast route indicators
icon + text status
camera-shake toggle
reduced-effects mode
subtitles
```

Do not communicate critical state using color alone.

Localization layout must accommodate German expansion and Chinese text.

---

# 72. Input Architecture

Map device inputs to generic commands.

Examples:

```text
SELECT
PAN_CAMERA
ZOOM_CAMERA
ROTATE_CAMERA
PLACE_DEFENSE
DEPLOY_GROUP
CHOOSE_ROUTE
ACTIVATE_ABILITY
PING
OPEN_DETAILS
```

Mouse and touch should be adapters into the same interaction system.

---

# 73. Music

Use adaptive layered music:

```text
Preparation
→ calm

Active Wave
→ tension

Major Breakthrough
→ increased intensity

Final Objective
→ climax

Result
→ victory/defeat cue
```

Stage 1 should have a coherent savanna/South African cinematic atmosphere without relying on stereotypical cultural caricature.

---

# 74. Environmental Audio

Each level should have its own ambience:

- wind
- insects
- birds
- water
- reeds
- brush
- distant animals
- environmental movement

Audio should also assist spatial orientation.

---

# 75. SFX Categories

```text
Gameplay
Information
UI
World
```

Information SFX should indicate events such as:

```text
unit detected
route threatened
ability ready
wave ready
objective threatened
team ping
```

---

# 76. Profile Audio Identity

Subtle distinctions:

```text
Explorer
→ scouting/navigation

Hunter
→ stronger tactical cues

Photographer
→ quiet precision

Ranger
→ response/radio

Wildlife Protector
→ fortification/environment

Field Researcher
→ scanning/analysis
```

---

# 77. Cinematics

Three presentation layers:

```text
Game Intro
Stage Intro
Short Level Intro
```

All cinematics:

- skippable
- replayable
- subtitled
- localized

OpenMontage may be used during development to create pre-rendered cinematics.

Runtime generative video is not required.

---

# 78. Gallery

Main menu:

```text
Gallery
├── Cinematics
├── Result Artworks
├── Big Five
├── Environment Art
└── Achievement Art
```

Locked items may appear as silhouettes.

---

# 79. Result Presentation

Always:

```text
Attacker = left
Defender = right
50/50 split
```

Winner side receives stronger visual emphasis.

Use complementary attacker/defender artworks.

Initial per-level artwork variants may include:

```text
attackerVictory-attackerView
attackerVictory-defenderView
defenderVictory-attackerView
defenderVictory-defenderView
```

Subtle animation/parallax/VFX may make still artwork feel alive.

---

# 80. Graphics Presets

Provide:

```text
Low
Medium
High
Ultra
```

Presets may affect:

- resolution scale
- shadows
- vegetation density
- texture resolution
- particles
- water
- post-processing
- AA
- LOD distance

Never hide gameplay-critical elements due to graphics quality.

---

# 81. Performance Targets

Initial targets:

```text
Desktop
target 60 FPS
minimum acceptable ~45 FPS

Tablet
target 45–60 FPS
minimum 30 FPS

Phone
target 30–45 FPS
minimum 30 FPS
```

Simulation must be frame-rate independent.

---

# 82. Performance Techniques

Use appropriately:

```text
LOD
instancing
texture reuse
texture atlases
pooled particles
simplified mobile effects
limited dynamic shadows
scalable water shaders
stage-based loading
pre-match warm-up
client interpolation
```

Suggested provisional stress target:

```text
normal active units: 50–80
heavy: 100–150
stress: 200+
```

These are engineering targets to benchmark, not permanent gameplay limits.

---

# 83. Rendering and Simulation Separation

Correct:

```text
Simulation State
→ Rendering Adapter
→ Three.js visualization
```

Incorrect:

```text
Move Three.js mesh
→ simulation assumes that is authoritative position
```

---

# 84. Networking

Use HTTP for application/assets and Socket.IO/WebSocket communication for real-time session/gameplay state.

Client sends commands, not arbitrary world-state mutations.

Correct:

```text
DEPLOY_GROUP
```

Incorrect:

```text
client says:
unit health = 90
unit position = ...
```

Server validates commands and calculates authoritative results.

---

# 85. State Synchronization

Concept:

```text
Server simulation
~20–30 ticks/sec initially

↓ authoritative events/snapshots

Client rendering
up to 60 FPS

↓ interpolation
```

Exact rates remain performance-tuning parameters.

---

# 86. AI Architecture

AI should separate:

```text
Perception
Evaluation
Decision
Command Generation
```

Difficulty modifies quality and parameters.

AI still emits ordinary legal player commands.

Provide developer introspection for AI reasoning.

---

# 87. Headless Simulation

The full simulation must be runnable without:

- browser
- rendering
- audio
- UI

It must use exactly the same:

```text
simulation
AI
stage content
```

as the real game.

Uses:

- balance simulations
- regression testing
- difficulty testing
- profile viability
- Chaotic validation
- stress testing

---

# 88. Balance Matrix

Stage 1 1v1 has:

```text
3 attacker profiles
×
3 defender profiles
=
9 matchups
```

Across:

```text
5 levels
×
6 difficulties
```

the test space becomes large.

Automated simulations should measure:

```text
win rate
match duration
objective progress
resources
route usage
ability usage
unit survival
defense efficiency
```

Do not require exact 50/50 outcomes.

Goal:

```text
no obviously dominant profile
no useless profile
no broken matchup
```

---

# 89. AI-vs-AI Developer Mode

AI-vs-AI may exist as:

```text
developer/debug
balance simulation
demo
```

but not as a primary normal player mode.

---

# 90. Deterministic Testing

Use seeded randomness where practical:

```text
mapSeed
aiSeed
simulationSeed
```

Same configuration and seeds should reproduce results as closely as practical.

---

# 91. Developer Debug Tools

Provide a hidden developer mode with functions such as:

```text
add resources
unlock content
spawn group
spawn defense
reveal map
show route graph
show LOS
show detection
show navigation nodes
show AI decision weights
simulation speed ×2 / ×5 / ×10
force win
force loss
finish objective
```

---

# 92. Developer Performance Overlay

Display optionally:

```text
FPS
frame time
active units
active defenses
draw calls
triangles
memory estimate
network latency
server tick time
```

---

# 93. Local Telemetry

Developer telemetry is local only.

Potential path:

```text
user-data/telemetry/
```

Store data such as:

```text
match duration
winner
profiles
difficulty
level
seed
routes
waves
resources
defenses
abilities
objective progress
detections
reroutes
```

Normal user gameplay should not require cloud analytics.

---

# 94. Match Event Log

Record important authoritative events.

Example:

```text
MATCH_START
BUILD_DEFENSE
DEPLOY_GROUP
ROUTE_CHANGE
ABILITY_USED
UNIT_DEFEATED
OBJECTIVE_PROGRESS
MATCH_END
```

This improves reproducibility and debugging.

---

# 95. Testing Gates

A stage is not implementation-complete until:

```text
✓ schema validation passes
✓ fixed routes valid
✓ large Chaotic sample valid
✓ all profiles can complete objectives
✓ AI functions at all difficulties
✓ no obvious broken matchup
✓ performance targets reasonably met
✓ LAN tests pass
✓ localization complete
✓ manual/help complete
✓ no critical simulation errors
```

---

# 96. Packaging

Final local distribution should be self-contained.

Players should not need to understand:

- npm
- Node installation
- Next.js
- ports
- local-server configuration

Recommended user experience:

```text
download/extract
→ start.bat
→ browser opens
→ play
```

macOS/Linux:

```text
start.sh
```

---

# 97. Packaged Runtime

Production package should bundle whatever runtime is required.

Do not require end users to install Node.js separately.

Development may still use the normal Node/npm toolchain.

---

# 98. Launcher

Launcher should:

```text
verify required files
verify writable user-data directory
find available port
start server
wait for health check
determine LAN address
open default browser
```

Default:

```text
localhost:3001
```

If port 3001 is occupied:

```text
try 3002
then 3003
etc.
```

LAN and QR join information must use the actual chosen port.

---

# 99. User Data

Keep persistent data separate from replaceable application files.

Recommended concept:

```text
GuosTowerDefense/
├── app/
├── content/
├── assets/
└── user-data/
    ├── saves/
    ├── backups/
    ├── settings/
    ├── screenshots/
    ├── telemetry/
    └── logs/
```

Portable-folder mode is desirable.

Copying the game folder to another PC should ideally preserve local progression.

---

# 100. Browser Strategy

Use the user's normal browser initially.

Prioritize modern:

```text
Chrome / Chromium
Edge
Firefox
Safari where appropriate
```

Do not introduce Electron or bundled Chromium unless there is a clear future requirement.

---

# 101. Git Workflow

Repository:

```text
https://github.com/shengguo2026/GuosTowerDefense
```

Branches:

```text
main
→ stable full game

develop
→ integration

feature/*
→ individual feature work
```

Feature workflow:

```text
feature/*
→ develop
→ main
```

Do not build directly on `main` for normal feature development.

---

# 102. Development Commands

Codex should aim to provide simple workflows such as:

```text
dev.bat
dev.sh

test.bat
test.sh

build.bat
build.sh

start.bat
start.sh
```

Possible package commands:

```text
npm run test
npm run validate:content
npm run simulate
npm run simulate:balance
npm run test:chaotic
npm run test:network
npm run test:performance
```

Exact package manager/tooling may be recommended by Codex during review.

---

# 103. Environment Asset Pipeline

The approved specification is the source of truth.

For each level, Codex should derive:

```text
environment design summary
asset checklist
layout plan
art-generation prompt set
placeholder plan
integration plan
```

Distinguish:

```text
1. Concept artwork
2. Production game assets
3. Scene assembly
```

Do not vaguely instruct an image generator to invent the entire environment without respecting the approved level design.

---

# 104. Asset Classification

Each asset should be classified as:

```text
gameplay-critical
visual landmark
repeated environment prop
background-only
cinematic-only
```

This determines performance and LOD priorities.

---

# 105. Stage Pack Contents

A stage package may contain:

```text
definitions
levels
profiles
units
defenses
resources
abilities
objectives
environments
localization
audio
artwork
cinematics
optional mechanic plugins
```

---

# 106. Future Stage Design Template

Before implementing any future stage, complete a dedicated stage-design document containing at least:

```text
1. Stage Identity
2. Stage Goals
3. Stage-Specific Mechanics
4. Levels
5. Difficulty Design
6. Attacker Profiles
7. Defender Profiles
8. Attacker Units
9. Defender Assets
10. Resources/Economy
11. Wave Rules
12. Combat
13. Stealth/Detection
14. Team Play
15. AI
16. Match Lifecycle
17. Victory Conditions
18. Secondary Objectives
19. Score
20. Achievements
21. Progression
22. Result Artworks
23. Intro/Cinematics
24. Visual Assets
25. Audio
26. Localization
27. Player Manual
28. Contextual Help
29. Save Data
30. Chaotic Seed/Replay
31. Performance Requirements
32. Input
33. Technical Extensions
34. Schema Validation
35. Test Plan
36. Implementation Readiness Checklist
```

A future stage must not move to full implementation until its readiness checklist is complete.

---

# 107. Implementation Milestones

## M0 — Foundation

Build:

```text
monorepo
Next.js client
local server
simulation package
R3F scene shell
Socket.IO foundation
controller interfaces
schemas
save skeleton
localization
testing
developer configuration
favicon.svg integration
```

Acceptance:

```text
✓ client runs
✓ server runs
✓ client/server connection works
✓ empty 3D scene renders
✓ headless simulation test works
✓ save read/write works
✓ EN/DE/ZH-CN switch works
✓ validator runs
```

---

# 108. M1 — Lion Vertical Slice

Scope:

```text
Stage 1
Lion
Explorer
Ranger
Easy
1v1
```

Required gameplay:

```text
briefing
preparation
wave construction
route choice
defense placement
combat
objective
result
```

Minimal Explorer content:

```text
Scout
Expedition Team
Reconnaissance
Rapid Reroute
Column
Spread
```

Minimal Ranger content:

```text
Ranger Patrol
Observation Post
Temporary Checkpoint
Rapid Response
Intercept
```

Acceptance:

```text
✓ full match start-to-finish
✓ either side playable by human
✓ opposite side can be AI
✓ either side can win
✓ route graph works
✓ objective works
✓ result works
✓ simulation independent of rendering
```

---

# 109. M2 — Complete Core 1v1

Add all six profiles.

Add:

```text
stealth/detection
disruption/destruction
mobile defenders
target priorities
status effects
route manipulation
profile resources
Easy/Medium/Hard
```

Still centered on Lion.

Acceptance:

```text
✓ all 9 profile matchups playable
✓ all six profiles viable solo
✓ AI supports all profiles
✓ Easy/Medium/Hard work
```

---

# 110. M3 — Full Stage 1 Campaign

Add:

```text
Leopard
Elephant
Rhinoceros
African Buffalo
```

Implement their unique mechanics.

Focus remains:

```text
1v1
Easy
Medium
Hard
```

Acceptance:

```text
✓ all five levels playable
✓ campaign progression works
✓ six profiles work across all levels
✓ AI understands all fixed maps
✓ Stage 1 can be completed
```

---

# 111. M4 — Persistent Progression

Add:

```text
profile XP
profile levels
profile unlocks
level progression
difficulty progression
scores
statistics
achievements
high scores
tutorial state
atomic saves
backups
migration
export/import
```

Acceptance:

```text
✓ progress survives restart
✓ AI earns no persistent XP
✓ human profiles earn XP
✓ side-specific unlocks work
✓ corrupted-save recovery tested
✓ export/import works
```

---

# 112. M5 — 2v2

Add:

```text
team size 2
Human + AI
Human + Human
AI + AI developer mode
shared team resources
team abilities
pings
team HUD
profile ownership
```

Acceptance:

```text
✓ stable 2v2 simulation
✓ asset ownership enforced
✓ shared resource works
✓ profile pairings work
✓ AI teammate cooperation works
```

---

# 113. M6 — Local Wi-Fi Multiplayer

Add:

```text
Host Game
Join Game
LAN discovery
manual address
QR join
6-digit room code
lobby
ready system
network human controller
disconnect/reconnect
temporary AI takeover
```

Acceptance:

```text
✓ desktop host
✓ phone/tablet join
✓ 6-digit room code works
✓ QR works
✓ state synchronizes
✓ reconnect works
✓ host save remains authoritative
```

---

# 114. M7 — Advanced Difficulties

Add:

```text
Extreme
Ultimate
Chaotic
```

Implement procedural route generation and seeds.

Acceptance:

```text
✓ large automated seed sweep
✓ no invalid/unreachable maps
✓ same seed reproduces map
✓ AI handles procedural graphs
```

---

# 115. M8 — Player Experience

Add/finalize:

```text
Manual
Contextual Help
Achievements UI
Statistics
Gallery
full localization
music
SFX
cinematics
result presentation
Big Five montage
```

---

# 116. M9 — Art and Performance

Finalize:

```text
all five environments
models
defenses
animations
VFX
LODs
instancing
optimized textures
graphics presets
mobile performance
```

---

# 117. M10 — Balance and Stability

Run:

```text
all 1v1 matchups
all 2v2 profile combinations
all levels
all difficulties
network stress
performance stress
save migration
Chaotic generation tests
```

No obvious dominant/broken/nonviable profile should remain.

---

# 118. M11 — Stage 1 Release Candidate

Freeze new gameplay features.

Focus on:

```text
bugs
balance
performance
localization
UX
network reliability
save compatibility
asset polish
```

Perform full regression from fresh install to Stage 1 completion and LAN multiplayer.

Then prepare:

```text
Guo's Tower Defense 1.0
```

---

# 119. Explicitly Out of Scope for V1

Do not implement initially:

```text
internet matchmaking
cloud accounts
cloud saves
public servers
host migration
new-player mid-match joining
full spectator system
user-created stages
stage editor
mod marketplace
automatic updater
ranked matchmaking
global leaderboard
voice chat
text chat
```

Architecture may leave sensible extension points, but do not implement these features.

---

# 120. Codex Working Rule

Codex must not begin by implementing the entire master plan.

Required sequence:

```text
1. Read masterplan completely.
2. Inspect existing repository.
3. Inspect favicon.svg.
4. Identify architecture risks or contradictions.
5. Recommend improvements.
6. Produce proposed repository architecture.
7. Produce milestone-by-milestone implementation plan.
8. Identify assumptions and dependencies.
9. Present findings to the user.
10. Wait for approval before major implementation.
```

Small harmless setup changes should also wait until the initial technical review is complete unless explicitly requested.

---

# 121. Source of Truth

This document is the functional and architectural source of truth:

```text
masterplan_GuosTowerDefense.md
```

If implementation decisions conflict with this document:

1. identify the conflict,
2. explain the technical reason,
3. recommend a resolution,
4. do not silently change the intended game design.

Technical improvements are encouraged, but gameplay/design changes require user approval.

---

# 122. Guiding Principles

Throughout implementation:

```text
Data-driven over hard-coded
Simulation over rendering authority
Commands over state mutation
Server authority over clients
Composition over stage-specific engine hacks
Testability from the beginning
Human and AI use the same legal actions
Gameplay clarity over visual excess
Mobile scalability without gameplay compromise
Persistent data must be safe
Future stages must not require core-engine rewrites
```

---

# 123. Final Product Vision

Guo's Tower Defense should ultimately feel like a polished local strategy game rather than a website.

The desired experience is:

```text
double-click start.bat
→ browser opens
→ choose language
→ enter Guo's Tower Defense
→ play Attacker or Defender
→ progress through the Big Five
→ master profiles and difficulties
→ play 2v2
→ invite phones/tablets over local Wi-Fi
→ experiment with Chaotic seeds
→ unlock achievements, artwork and mastery
```

while underneath the game remains:

```text
modular
data-driven
testable
server-authoritative
stage-extensible
AI-simulatable
LAN-capable
portable
```

This architecture should make Stage 1 a complete game while leaving a strong foundation for future stages.