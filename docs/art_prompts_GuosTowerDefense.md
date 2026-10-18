# Guo's Tower Defense: Art and Video Prompts

**For:** Codex image generation and easemate.ai image-to-video · **Date:** 2026-10-13
**Based on:** `specification_GuosTowerDefense.md` §2 (tone), §16 (Chief Warden Guo), §17 (cinematics), §19 (style)

---

## How to use this file

1. **Attach the style reference** `refinement/G2_lowpoly_sample_v2.png` to every Codex request (and for GUO-* also
   `GuoPhoto.jpg`). This keeps all art in the same look as the in-game 3D.
2. **Paste the STYLE block below at the start of every prompt**, then the asset prompt.
3. **Size:** Codex offers 1536×1024 (landscape), 1024×1536 (portrait) and 1024×1024 (square). The size is given per
   asset. "Transparent background" assets: ask for a transparent PNG.
4. **Save** each result as `C:\AI\Claude\GuosTowerDefense\assets\art\<ID>.png` (e.g. `LEVEL-01-LION.png`).
   If you make several tries, keep the best one under the exact ID; extras can go in `assets\art\_alternatives\`.
5. **Order:** do the "Now" and "R1" groups first. The rest can wait until those releases.
6. **No text in images.** The game draws all titles and labels itself, in EN/DE/ZH.

### STYLE block (paste first, every time)

```text
Style: stylized low-poly 3D diorama illustration matching the attached reference image. Flat-shaded faceted
geometry, clean readable silhouettes, soft warm golden-hour light from the left with long soft shadows, gentle cool
rim light, slight atmospheric haze in the distance. Palette: warm savanna sand and gold (#D9B56A, #C79A62), olive and
acacia greens (#6F8A3A, #86A046), dusty sky blue (#6AA7D8), earthy browns. Attacker side accent colour orange
(#E8742C); Defender side accent colour blue (#2E6FE0); use these only where the asset says so. Family-friendly and
non-violent: no weapons, no firearms, no blood, no injured or captured animals, no hunting trophies. Respectful,
non-stereotyped depiction of Southern Africa and its people. No text, no letters, no numbers, no logos, no watermark,
no UI elements.
```

---

## Group A: Intro movie (Now)

### A1 · INTRO-KEY · key image for the game intro video
**Size:** 1536×1024, then keep the middle 16:9 band (crop to 1536×864) before uploading to easemate.ai.
**Where:** first frame of the game intro video.

```text
A wide cinematic establishing shot of a South African savanna at golden hour, seen from a low drone height looking
across the land toward distant blue-violet hills and a huge warm sun near the horizon. In the middle ground a calm
waterhole reflects the sky; a male lion rests on a flat rock beside it, an elephant family drinks at the far edge,
a rhinoceros grazes in tall golden grass, a herd of African buffalo stands in the distance, and a leopard lies on the
branch of a large umbrella acacia on the right. Two dusty trails wind from the foreground toward the waterhole. On the
left trail, a small orange-accented expedition jeep with a roof rack; on the right, a wooden observation tower with a
blue-banded thatched roof. Birds in the sky. Leave the upper-middle third of the image calm (open sky) so a title can
be placed there later. Composition centred, depth from foreground grass tufts to background hills, everything sharp
and readable. All important content inside the central 16:9 band.
```

### A1-V · easemate.ai prompt for the game intro video
**Settings:** Image to Video · upload `INTRO-KEY` (16:9 crop) · Aspect 16:9 · Quality **720p** · Duration **10s** ·
80 credits.

```text
Slow, smooth cinematic camera push forward and slightly downward over the savanna toward the waterhole, steady and
continuous for the full 10 seconds, no cuts. Golden-hour light, gentle sun glow pulsing softly. Grass and acacia leaves
sway lightly in a warm breeze. A flock of birds glides across the sky from left to right. The lion slowly lifts its head
and looks toward the camera; the elephants lift their trunks; the buffalo herd walks slowly to the left; the leopard's
tail sways on the branch. A small cloud of dust rises behind the orange jeep as it rolls a few metres along its trail,
and a tiny flag waves on the blue-roofed observation tower. Water surface shimmers. Keep the stylized low-poly look,
shapes stable, no morphing, no new objects appearing, no text, no people fighting, peaceful and majestic mood. End on a
wide calm frame with open sky in the upper middle.
```

If the first try morphs the animals, run it again with "minimal motion of animals, motion mostly from camera, grass,
birds and dust" added at the end.

### A2 · STAGE1-INTRO-KEY · key image for the Stage 1 intro clip (later, R3, ~8 days of credits)
**Size:** 1536×1024 → crop to 16:9.

```text
A sweeping view across five connected savanna landscapes of South Africa at late afternoon, from left to right:
open golden grassland with a waterhole and a resting lion; a rocky wooded ridge with a leopard on a rock ledge; a wide
muddy river crossing with elephants; a dense thorn-bush gully with a rhinoceros; and a green wetland with reeds and a
large buffalo herd. A single winding dusty trail connects all five areas from foreground left to background right.
A small orange-accented expedition jeep at the start of the trail, and blue-roofed ranger observation towers along
the way. Calm, adventurous, majestic. Keep the upper area as open sky for a title. All important content in the
central 16:9 band.
```

### A2-V · easemate.ai prompt for the Stage 1 intro clip
**Settings:** Image to Video · 16:9 · 720p if 80 credits are available, else 480p · 10s.

```text
Slow lateral camera move from left to right along the winding trail, passing over the five landscapes in one
continuous motion with gentle parallax between foreground grass, middle ground animals and background hills. Each
animal makes one small calm movement as the camera passes (lion yawns, leopard tail flicks, elephant sprays water,
rhino lifts its head, buffalo walk). Warm late-afternoon light, light dust and birds. Stylized low-poly look stays
stable, no morphing, no text, peaceful adventure mood. End on the wetland and the buffalo herd.
```

---

## Group B: Stage and level info pictures (R1 for Stage 1 + Lion, R3 for the others)

All **1536×1024**, used on the stage/level select and briefing screens. The game crops slightly on phones, so keep
the main subject in the central two-thirds.

### B0 · STAGE-01 · "South Africa: Get the Big Five"
```text
A heroic overview of a South African savanna landscape at golden hour with the Big Five arranged naturally across
the scene as a group portrait: lion in front on a low rock, leopard on an acacia branch, elephant behind on the left,
rhinoceros on the right, African buffalo in the middle distance. A winding trail leads into the scene. Distant hills,
large warm sky. Majestic and inviting, like the cover of an adventure game chapter.
```

### B1 · LEVEL-01-LION
```text
Open savanna with long visibility. Foreground: an entrance with a few rocks and grass ("Savanna Entrance"). Two
clear routes lead to the goal: on the left a raised rocky ridge path, on the right a dry sandy streambed with pebbles;
they meet near a large umbrella acacia junction. In the background a waterhole where a male lion and a lioness rest.
Distant hills. Wide open grassland that feels exposed, a few scattered acacias. A wooden observation tower with a blue
roof band near the waterhole; a small orange-accented expedition group at the entrance.
```

### B2 · LEVEL-02-LEOPARD
```text
Dense woodland mixed with large granite rocks and a narrow ravine. Three routes: a shaded woodland trail through
thick brush, a rocky path along a ledge with good views, and a narrow ravine connector between rock walls. A leopard
rests on a high rock ledge in the background, half hidden in dappled shade. Patches of dense brush, small clearings
in light. Mood of hidden information and careful observation. A blue-roofed observation post on a ledge; a small
orange-accented scout group at the forest edge.
```

### B3 · LEVEL-03-ELEPHANT
```text
A wide river valley with heavy terrain. Three routes: a dry ridge on the left, broad muddy flats in the middle with
deep footprints, and a shallow river crossing on the right that narrows to a single ford. An elephant family drinks
and crosses the river in the background. Large baobab and fever trees, reeds at the water. Feeling of scale and
weight. A blue-roofed post on a hill above the crossing; an orange-accented expedition vehicle on the dry ridge.
```

### B4 · LEVEL-04-RHINOCEROS
```text
Dense thorn bush with short sight lines. Three routes: a tight thorn track winding through bushes, a dry gully
lower down, and a patch of more open scrub. A white rhinoceros stands in a small clearing in the middle distance,
partly framed by bushes. Close, tense, intimate space with many places to hide. A blue-accented ranger vehicle
partially hidden among bushes; an orange-accented small team at a gully entrance.
```

### B5 · LEVEL-05-BUFFALO
```text
A wide wetland at golden hour: wet grassland, shallow marsh pools reflecting the sky, tall reeds and muddy trails
between patches of dry ground. Four routes: northern grass, southern mud, a reed connector and the central wetland.
A large African buffalo herd moves slowly through a corridor in the middle, kicking up light spray. Grand finale
feeling, several fronts. Blue-roofed observation platforms on stilts; orange-accented groups approaching from two
directions.
```

---

## Group C: Chief Warden Guo (R1)

Attach **GuoPhoto.jpg** and the style reference. All **1024×1024, transparent background**, chest-up, facing slightly
to the right (the game shows the portrait on the left side of the briefing box).

### Base prompt (use for every GUO image, then add the line for the variant)
```text
Create an illustrated character portrait based on the person in the attached photo: keep their face shape, hairstyle,
glasses (if any) and friendly likeness recognisable, but render them as a stylized low-poly 3D game character in the
style of the attached reference, not photorealistic. The character is "Chief Warden Guo", the wise and friendly host
of a family-friendly savanna strategy game. Outfit: neutral khaki field shirt with rolled sleeves, a light scarf in
warm sand colour, a wide-brim safari hat, a small badge with a simple acacia-tree symbol (no text). Neutral to both
sides: no orange or blue team colours on the outfit. Chest-up, three-quarter view facing slightly right, soft golden
rim light, transparent background, clean edges for cut-out use.
```

| ID | Variant line to add |
|---|---|
| GUO-1-BRIEFING | Calm, confident expression, holding a folded map in one hand, as if explaining a mission. |
| GUO-2-HAPPY | Big warm smile, giving a thumbs-up, celebrating a victory. |
| GUO-3-CONCERNED | Thoughtful, slightly concerned but encouraging expression, one hand on chin, after a lost match. |
| GUO-4-TIP | Friendly, pointing upward with one finger as if sharing a useful tip, eyebrows raised. |

### C5 · GUO-EASTER · "Spot Guo" easter-egg sticker
**Size:** 1024×1024, transparent background.
```text
A small square instant-photo print of the Chief Warden Guo character (same character as the attached GUO-1 image),
smiling and waving, slightly tilted, with a tiny pin at the top, as if pinned to a wooden board. White photo border,
simple and readable even when shown very small.
```
(Attach `GUO-1-BRIEFING.png` instead of the original photo for this one.)

---

## Group D: Main menu (R1)

### D1 · MENU-BG
**Size:** 1536×1024.
```text
A calm, wide savanna panorama at dusk-turning-golden light, seen from slightly above, with a large umbrella acacia on
the left third, a waterhole in the middle distance with silhouettes of a lion and an elephant, and distant hills.
The right half is visually quiet (soft sky and grass) so menu buttons can sit on top of it. Soft vignette at the edges.
Peaceful, inviting, premium game menu background.
```

---

## Group E: Profile portraits (R1: Explorer, Ranger · R2: the other four)

All **1024×1024, transparent background**, chest-up, three-quarter view, same framing for all six so they line up.
Paste STYLE, then:

```text
A stylized low-poly 3D character portrait for a family-friendly savanna strategy game, chest-up, three-quarter view,
transparent background, soft golden rim light, clean cut-out edges. Character: <DESCRIPTION>.
```

| ID | DESCRIPTION |
|---|---|
| PORTRAIT-EXPLORER | a cheerful expedition leader in a khaki field shirt with an orange scarf and orange backpack straps, wide-brim hat, compass on a cord, rolled map in hand; curious and adventurous |
| PORTRAIT-HUNTER | a rugged, determined tracker in a dark olive jacket with orange shoulder patches, cap, binoculars around the neck and a tool belt with rope and wire cutters; no weapons; focused and bold |
| PORTRAIT-PHOTOGRAPHER | a quiet wildlife photographer in a sand-coloured vest with orange trim, bucket hat, a big camera with a long lens held ready; calm and patient |
| PORTRAIT-RANGER | a confident park ranger in an olive uniform with a blue shoulder flash and blue beret, radio on the chest; alert and protective |
| PORTRAIT-PROTECTOR | a warm, strong conservation worker in a green work shirt with a blue armband, sturdy gloves, a coil of fencing wire over one shoulder; steady and caring |
| PORTRAIT-RESEARCHER | a sharp field scientist in a light khaki shirt with a blue lanyard and tablet device, glasses, a small drone resting on the shoulder strap; thoughtful and clever |

Use a mix of genders, ages and skin tones across the six.

---

## Group F: Icons (R1 set first, R2 set later)

All **1024×1024, transparent background**; the game scales them down to 48–96 px, so the subject must read when tiny.
Paste STYLE, then:

```text
A single game icon: <SUBJECT>. Stylized low-poly 3D object, centred, filling about 80% of the frame, slight
three-quarter top view, strong simple silhouette, soft shading, thin <SIDE> coloured base disc under the object,
transparent background, readable at 48 pixels.
```
`<SIDE>` is **orange** for Attacker items and **blue** for Defender items.

**R1 icons**

| ID | Side | SUBJECT |
|---|---|---|
| ICON-UNIT-SCOUT | orange | a single explorer scout figure with binoculars |
| ICON-UNIT-EXPEDITION-TEAM | orange | a group of three explorers with backpacks |
| ICON-ABILITY-RECONNAISSANCE | orange | a pair of binoculars with a small radiating view cone |
| ICON-ABILITY-RAPID-REROUTE | orange | a forked trail sign with a curved arrow switching branches |
| ICON-FORMATION-COLUMN | orange | three small figures walking in a single line |
| ICON-FORMATION-SPREAD | orange | three small figures spread out side by side |
| ICON-UNIT-RANGER-PATROL | blue | two rangers walking with a radio |
| ICON-DEF-OBSERVATION-POST | blue | a wooden observation tower with a thatched roof |
| ICON-DEF-CHECKPOINT | blue | a red-and-white striped barrier gate with sandbags |
| ICON-ABILITY-RAPID-RESPONSE | blue | a ranger jeep with motion lines |
| ICON-ABILITY-INTERCEPT | blue | an open hand stop gesture in front of a trail |

**R2 icons**

| ID | Side | SUBJECT |
|---|---|---|
| ICON-UNIT-GUIDE | orange | an explorer guide holding a walking stick and compass |
| ICON-UNIT-EXPEDITION-VEHICLE | orange | an expedition jeep with roof rack |
| ICON-ABILITY-FIELD-GUIDE | orange | an open field guide book with a trail map |
| ICON-UNIT-TRACKER | orange | a crouching tracker reading footprints |
| ICON-UNIT-HUNTER-TEAM | orange | a team of three trackers with rope and binoculars |
| ICON-UNIT-BREACH-SPECIALIST | orange | a worker with large wire cutters next to a fence |
| ICON-UNIT-OFFROAD-VEHICLE | orange | a rugged off-road truck |
| ICON-ABILITY-SABOTAGE | orange | wire cutters snipping a fence wire |
| ICON-ABILITY-BREACH | orange | a broken barrier with a gap |
| ICON-ABILITY-COORDINATED-ASSAULT | orange | three arrows converging on one point |
| ICON-UNIT-OBSERVER | orange | a figure lying low in grass with binoculars |
| ICON-UNIT-CAMERA-TEAM | orange | two photographers with long-lens cameras |
| ICON-UNIT-SPOTTER | orange | a figure pointing ahead with a small scope |
| ICON-UNIT-UTILITY-VEHICLE | orange | a small light utility vehicle |
| ICON-ABILITY-CONCEALED-APPROACH | orange | a figure half hidden behind a bush |
| ICON-ABILITY-PERFECT-POSITION | orange | a camera on a tripod with a target frame |
| ICON-ABILITY-SNAPSHOT-WINDOW | orange | a camera shutter with a small clock |
| ICON-UNIT-TRACKER-TEAM | blue | two rangers examining footprints |
| ICON-UNIT-RESPONSE-VEHICLE | blue | a fast ranger vehicle with a light bar |
| ICON-UNIT-SENIOR-RANGER | blue | an experienced ranger with a beret and badge |
| ICON-DEF-LIGHT-BARRIER | blue | a light portable barrier |
| ICON-DEF-PATROL-BEACON | blue | a small blinking beacon post |
| ICON-ABILITY-EMERGENCY-REINFORCEMENT | blue | a ranger vehicle arriving with a plus sign shape made of light |
| ICON-DEF-PROTECTION-TOWER | blue | a sturdy protection tower with a floodlight |
| ICON-DEF-HEAVY-BARRIER | blue | a heavy log-and-stone barrier |
| ICON-DEF-CONSERVATION-POST | blue | a small conservation hut with a flag pole |
| ICON-DEF-OBSERVATION-PLATFORM | blue | a raised platform on stilts |
| ICON-DEF-SLOW-FIELD | blue | a patch of ground with wavy slow lines |
| ICON-DEF-WARNING-BARRIER | blue | a barrier with a flashing warning light |
| ICON-DEF-TEMPORARY-FENCE | blue | a short wire fence section |
| ICON-DEF-ENVIRONMENT-MARKER | blue | a marker post with a leaf symbol |
| ICON-UNIT-PROTECTION-TEAM | blue | two conservation workers with gloves |
| ICON-UNIT-MAINTENANCE-CREW | blue | a worker with a wrench and toolbox |
| ICON-UNIT-RELOCATION-UNIT | blue | a vehicle with a large padded transport crate |
| ICON-ABILITY-CONSERVATION-BARRIER | blue | a curved protective wall glowing softly |
| ICON-ABILITY-PROTECTED-ZONE | blue | a dome of light over a patch of land |
| ICON-ABILITY-HABITAT-LOCKDOWN | blue | a padlock over an acacia tree |
| ICON-DEF-SENSOR-BEACON | blue | a small sensor post with radio waves |
| ICON-DEF-OBSERVATION-STATION | blue | a research hut with an antenna |
| ICON-UNIT-RESEARCH-TEAM | blue | two researchers with a tablet |
| ICON-UNIT-DRONE | blue | a small quadcopter drone |
| ICON-ABILITY-AREA-SCAN | blue | a radar sweep over a patch of land |
| ICON-ABILITY-ROUTE-ANALYSIS | blue | a trail map with highlighted branches |
| ICON-ABILITY-DEEP-ANALYSIS | blue | a magnifying glass over footprints |

---

## Group G: Ground textures (R1)

All **1024×1024**, top-down, **seamless tileable**, no objects, no shadows from objects, even lighting.

| ID | Prompt (after STYLE) |
|---|---|
| TEX-GRASS | Seamless tileable top-down texture of dry golden savanna grass and sandy soil, subtle low-poly facets, even soft light, no objects. |
| TEX-DIRT | Seamless tileable top-down texture of a dusty trail with fine sand, small pebbles and faint tyre and foot prints, even light. |
| TEX-RIVERBED | Seamless tileable top-down texture of a dry riverbed with cracked mud and rounded pebbles, even light. (R3 also uses it) |
| TEX-MUD | Seamless tileable top-down texture of wet dark mud with shallow puddles, even light. (R3) |

---

## Group H: Result artworks (R3)

The result screen is split 50/50: Attacker art on the left half, Defender art on the right half. Each image is
**1024×1536 (portrait)**. Per level there are four images. Paste STYLE, then:

```text
A portrait-format result artwork for the <LEVEL> level of a family-friendly savanna strategy game. <SCENE>.
Mood: <MOOD>. The <ANIMAL> is visible, calm and unharmed. Strong focal subject in the middle, soft background.
```

| ID pattern | SCENE | MOOD |
|---|---|---|
| RESULT-<LEVEL>-ATT-WIN | the orange-accented attacker team at the goal zone quietly observing and photographing the animal from a respectful distance | triumphant, warm |
| RESULT-<LEVEL>-ATT-LOSE | the orange-accented attacker team turning back along the trail at dusk, looking back toward the goal | disappointed but hopeful |
| RESULT-<LEVEL>-DEF-WIN | the blue-accented defender team standing at their observation post, the animal safe and calm behind them | proud, protective |
| RESULT-<LEVEL>-DEF-LOSE | the blue-accented defender team arriving a moment too late, looking at the visitors' tracks near the animal | determined, "next time" |

| `<LEVEL>` | `<ANIMAL>` | setting reminder |
|---|---|---|
| LION | lion pride | open savanna waterhole |
| LEOPARD | leopard | rocky ledge in woodland |
| ELEPHANT | elephant family | river crossing |
| RHINO | rhinoceros | thorn-bush clearing |
| BUFFALO | buffalo herd | reed wetland |

---

## Group I: Achievements and montage (R4)

### I1 · Achievement badges
**Size:** 1024×1024, transparent background. Paste STYLE, then:
```text
A round achievement badge medallion in stylized low-poly 3D, gold-rimmed, with <EMBLEM> in the centre, a small
ribbon at the bottom without text, transparent background, readable at 64 pixels.
```
The emblem list follows the final achievement list in R4.

### I2 · BIG-FIVE-MONTAGE
**Size:** 1536×1024.
```text
A celebratory collage of the five levels' highlights arranged as five overlapping panels in a gentle arc: lion at a
waterhole, leopard on a rock ledge, elephants at a river crossing, rhinoceros in a thorn-bush clearing, buffalo herd
in a wetland. Small orange and blue teams appear in each panel, peacefully side by side. Golden light, joyful
completion mood.
```
