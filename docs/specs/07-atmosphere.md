# Atmosphere: time of day, weather, props, explosions

| | |
|---|---|
| Status | in progress (#155 time of day, #156 headlights, #157 weather state, #158 rain and lightning, #159 snow and fog, #160 dust storm, #161 prop library, #162 prop placement, #163 explosions, #164 ambient audio shipped) |
| Milestone | M4 |
| Size | L (split: night + headlights; weather; props; explosions + particles) |
| Depends on | M0; structures from [03-objectives.md](03-objectives.md) share the prop meshes |
| Touch parity | no controls; a weather toggle in Free Play |

## Summary

Make the three biomes feel like twelve places without new art styles: night
variants with headlights, four weather types that change visibility and the
radar, a prop library the generator scatters per biome, and explosions and
debris worth watching. All flat-shaded, all within the frame budget.

## Design

### Time of day

Each palette gets `night` and `dawn` variants (`PALS.dusk.night` …) with their
own `zen`, `hor`, `low/mid/high`, `fog` and `light`. A mission sets `time:
'day' | 'dusk' | 'night' | 'dawn'` or `ramp: ['dusk', 'night', 180]` to blend
over 180 s (uniforms are already per frame; blend the palette fields).

As shipped (#155): a variant carries its own `zen`, `hor`, `fog` and `light`
and, instead of its own ground colours, a `shade` that multiplies everything
lit (emissive things keep their glow; the IR camera ignores it). The ground
colours are baked into the terrain mesh, so this keeps a ramp to a per-frame
blend of a few numbers (`blendPal`) with no mesh rebuild. `day` and `dusk`
are each biome's own light (the desert and the volcanic plain are at dusk,
the glacier by day). Mission 4 ramps dusk to night over 240 s; missions 8
and 12 and night contracts are at night.

**Headlights.** At night the player's mech (and in the arena every mech) has
two headlights: one spotlight term in the main shader (`uSpotPos`, `uSpotDir`,
`uSpotCone`, `uSpotCol`), evaluated per fragment, from the torso frame. Only
the local player's lights illuminate (one spot uniform set); other mechs get
emissive lamp quads so they are visible as lights, which the AI's `sight`
also uses: at night sight is 250 m, or 600 m toward a mech with lights on.
A key (L) and touch button (LIGHTS, in the top cluster) toggle them; off is
stealth, on is seeing. The IR missile camera is unchanged at night (that is
its moment).

As shipped (#156): the spot is evaluated per fragment in the shared fragment
shader (per-part, skinned and terrain draws; effects are not lit by it),
from the cockpit along the aim and dipped 0.16, with a 0.24 rad full cone
fading out by 0.42 and brightness `1 - (d / 230 m)^2`, scaled by how dark it
is (`darkness(pal)`, from the time-of-day shade, so a ramp brings it on
gradually). Headlights default on for every mech and go dark with a
shut-down reactor; other mechs show two glowing lamps read off their torso's
front face. Night sight blends the same way: `min(day sight, 250 or 600 m)`.
The LIGHTS button shows only where night falls. `lt` rides in the state
message (PROTOCOL 7).

### Weather

`game.weather = { kind, intensity, wind: [x, z] }`. Kinds:

| Kind | Visual | Fog near/far × | Radar range × | Sound | Biome |
|---|---|---|---|---|---|
| clear | none | 1 | 1 | ambient bed | all |
| rain | streaks falling with wind, darker palette, wet-sheen boost on `high` colour | 0.7 | 0.9 | rain loop, distant thunder | dusk |
| snow | flakes, slow, drifting; palette whitened | 0.5 | 0.8 | wind loop | ice |
| dust | horizontal grains, orange fog, strong wind on smoke | 0.35 | 0.5 | wind howl | dusk, volcanic |
| fog | no particles, fog near pulled in hard | 0.3 | 0.6 | muffled bed | ice, volcanic |

**Lightning** (rain, night rain especially): every 8–20 s a 120 ms flash:
`light` colour jumps to white, sky brightens, a thunder sample 0.5–3 s later
scaled by a random distance. In the arena, lightning is seeded from
`game.time` so everyone sees the same flashes.

As shipped (#158): rain is 1,500 thin streaks (a new `streak` effect shape;
900 on touch until the PARTICLES setting, #165) in a 60 x 30 x 60 m box round
the camera (`render/weatherBox.js`, render-side and unseeded: it is only
looks), falling at 22 m/s with the wind, none within 6 m of the cockpit, one
instanced draw. Rain dims the light to 80%. Lightning: `strikeAt(seed, k)`
gives every strike's time (8-20 s apart) and distance from the seed alone;
`sim/weather.js` flashes the shading and the sky toward white for 120 ms and
rolls `sfx.thunder` (a slowed boom and a low rumble, quieter when far) 0.5-3
s later. The perf harness has a `rain` scene (free-start in a downpour).

As shipped (#159): snow is 800 small octahedra (480 on touch) in the same box,
falling at 1.6 m/s with the wind, turning and swaying, none within 5 m of the
cockpit; snow whitens the sky and fog colour by 35%. Fog has no particles: its
fog distances (x0.3) and a haze that greys the zenith into the horizon (80%;
dust gets 60%) do it. The perf harness has a `snow` scene; rain and snow
each cost one draw over free-start and no more garbage.

As shipped (#160): dust is 2,500 small flat grains (1,500 on touch) streaming
sideways at 1.4x the 9 m/s wind, with an orange-tinted horizon and fog
(halfway to `tint`) on top of its haze. A mech in the air is pushed 0.5 m/s
with the wind; on the ground nothing. Mission 10's PURPLE PUNCHER now walks
in out of the dust at about 350 m, which is the set piece spec 04 asked for.
The perf harness has a `dust` scene.

**Wind** moves smoke and missile trails (`particle` velocities get `wind × dt`)
and leans rain/snow. Dust storms push the mech by 0.5 m/s laterally when
airborne (jets), nothing on the ground.

Weather particles live in a box around the camera (60 m × 30 m × 60 m),
recycled when they leave it. They are drawn with the instanced particle path
below, 1500 for rain, 800 for snow, 2500 for dust at intensity 1, scaled by a
`particles` setting (LOW / MED / HIGH, default MED on touch, HIGH on desktop).

Weather affects the AI (`sight` × radar factor) and the HUD (radar ring
shrinks; the target box drops at 1.2× the visible range).

As shipped (#157): `src/data/weather.js` holds the table above (plus a wind
per kind: clear is calm, rain 4 m/s, snow 2.5, dust 9, fog 0.5) and
`G.weather = { kind, intensity, wind }` comes from a mission's `weather` (the
wind's direction fixed by the seed). The renderer takes `fogOf(G)` for its
fog and cull distances; the radar ring reads `800 m × radarOf(G)`; the AI's
sight is multiplied by the same radar factor (after night's cut); the target
brackets and enemy chevrons drop past 1.2× the fogged far distance; smoke,
and so missile trails, drifts toward the wind. Free Play has WEATHER (CLEAR,
RANDOM: one that suits the map, clear half the time, or any kind by name)
and TIME (NORMAL, DAWN, NIGHT) pickers, two columns on a phone. Particles
and sounds for each kind are their own issues (#158–#160, #164); the arena
stays clear until `welcome` carries `wx` and `tm`.

### Props

`src/mesh/props.js` builds a small library with the `Builder`, all under 120
triangles each: storage tank (cylinder of 8), tower (today's), bunker (low
tapered cube), pipe run (a line of cylinders), wall segment, antenna mast
with dish, truck (the escort vehicle), launcher (mission 9 turret), relay
(mission 2), crate stacks, dead tree (ice), lava vent (volcanic: emissive
glow), ice spire.

As shipped (#161): bunker, pipe run, wall segment, antenna mast, crate stack,
dead tree, lava vent and ice spire join the mission props, 46 to 116
triangles each (`props.test.js`). Each is built in the same unit space (1
across the footprint radius, 1 tall), so a long one (pipe run, wall) is a
strip along z in a round footprint: #162 should chain short segments rather
than place one long one. The mast is built for a height about seven times
its radius. The vent's lava is a second mesh, `ventGlow`, drawn glowing, so
it shows at night. `node scripts/shootProps.mjs` shoots the sheet.

`src/world/props.js` places them by biome rules from the seed: clusters near
the existing outposts, lines of pylons across the map, scattered singles.
Props become `game.entities` of kind `structure` with `hp: Infinity` unless a
mission marks them destructible. Mission placements override.

Props are drawn in one pass with a frustum test (sphere vs the view
frustum's planes from `VP`) and a distance cull at `fog[1]`.

As shipped (#162): `scatterProps(seed, biome, ter, { avoid, paths })` gives
90 to 120 props a map, about 2 ms:
- **Outposts:** `outposts(seed)` lays out the four outposts' abandoned
  blocks and towers, which `terrainMesh.js` bakes into the ground mesh as
  before. Round each go a bunker, two crate stacks, a tank, a three-segment
  pipe run and a four-segment wall, clear of the blocks.
- **Pylons:** two lines of masts cross the map every 150 m.
- **Singles:** dusk adds crates, bunkers, tanks and wall stubs; ice adds 30
  dead trees and 14 spires; volcanic adds 12 lava vents.
- **Clear ground:** nothing lands within 140 m of the start, on a mission's
  flat pads or structures, within 30 m of a convoy's road, on a steep slope,
  or on another prop. A mission with `props: false` and a flat test map get
  none.

They are `structure` entities with `hp: Infinity`, but they live in
`G.scenery`, apart from `G.entities`, with a 64 m grid listing each prop in
every cell its footprint touches. Pushing a mech out, a punch's target and a
shot's ray (a 2D walk along the cells it crosses) look only in the cells
concerned. Walking the whole list from code that runs a few times a frame
made 50–150 KB of garbage a frame. Mission entities are placed first, so the
scatter keeps clear of them; a mission that wants a destructible prop lists
it among its entities, as missions already do.

Drawing (`render/propBatch.js` and `R.drawProps`): one instanced draw per
prop mesh with anything in view, lit, fogged, headlit and IR-shaded by the
main fragment shader. A toppling prop is drawn on its own. Without the
instancing extension, each instance is an `R.draw`. The perf scenes gain 1
to 4 draws and 1–3k triangles, with no more garbage. Acceptance 4 is a
headless test: facing away from an outpost issues none of its props, and
they count as culled in `?debug=1`.

### Explosions and debris

- **Shockwave**: a flat expanding ring quad on the terrain, 0.4 s, for
  missiles and deaths.
- **Debris**: armour plates (thin tapered cubes in the mech's colour) and
  bright fragments; the existing bounce stays; plates persist 20 s then sink.
- **Scorch**: a dark flat quad on the terrain at each blast and wreck,
  capped at 64, oldest removed, drawn with a small polygon offset.
- **Secondaries**: after a mech dies, 2–4 small pops over 3 s from the wreck
  with smoke bursts; ammo-carrying wrecks (AC, LRM, SRM, gauss) get one big
  delayed pop at 1–2 s.
- **Burning wrecks**: the smoke column already exists; add a flickering
  emissive glow on the wreck's torso part for 30 s.

As shipped (#163):
- **Shockwave:** a new particle kind, `shock`. It is a ring, eight segments
  with the outer edge raised a little so it shows edge-on from a cockpit. It
  lies on the ground under any blast within 10 m of it, never tumbles, grows
  to 26 m (big) or 9 m across in 0.4 s, and dithers out (`DITHER_KINDS`).
- **Debris:** landed debris sinks into the ground over its last 2 of 20 s
  instead of shrinking.
- **Scorches:** `G.scorches`, at most 64, oldest first out. A blast where a
  scorch at least as big already covers the spot adds none. The yaw comes
  from the place, so the RNG is untouched. The renderer keeps one buffer with
  a slot per scorch (id mod 64) and rewrites only a new one's slot, so a
  missile volley makes no garbage. It is one draw with a polygon offset.
- **Secondaries:** `makeWreck` sets 2 to 4 pop times in the first 3 s, each
  pop with a burst of smoke. A mech still carrying ammunition (any weapon
  with `ammo` left: autocannon, missiles, gauss, machine gun) also gets one
  big pop between 1 and 2 s. They are all show, with no damage.
- **Burning wrecks:** a shell over the torso, 4% larger, drawn after the
  skinned pass. It flickers from ember orange back to the wreck's grey, and
  its glow dies down over 30 s, when the smoke stops too.
- **Cost:** one draw per burning wreck plus the scorch draw.

### Particle system rework

One `instancedArrays` draw per particle kind (ANGLE_instanced_arrays is
universal on WebGL1): a per-instance buffer of `pos(3) size(1) col(3)
emis(1) heat(1)` updated each frame from `game.parts`. Falls back to today's
per-particle draws if the extension is missing. Hard cap 4000 gameplay
particles plus the weather pool; spawn requests beyond the cap replace the
oldest smoke first.

### Ambient audio

A per-biome bed (synthesised: filtered noise with slow LFOs, no new clips)
and a per-weather layer, mixed on the existing `loops` path. Volume follows
the SFX setting.

As shipped (#164): the table is `data/ambience.js`, and `audio/ambience.js`
builds it.
- **Layers:** each layer is the shared white-noise buffer, looping from its
  own offset, through one filter, with an LFO on the filter frequency and
  another on the level.
- **Beds:** dusk is a warm low wind with some air on top; ice is a thin cold
  wind over a low hush; volcanic is a ground rumble with a high sputter.
- **Weather:** rain is a hiss and a patter, snow a whistling gusty wind, and
  dust a resonant howl with grit. Fog has no layer of its own: it closes a
  500 Hz lowpass over the bed.
- **Mixing:** everything goes through the loop bus, so impacts duck it like
  the hum. A change of biome or weather fades the old layers out over 1.5 s
  and stops them. Pause, the menu and a hidden tab fade it all down.
- **Sound off or no gesture:** there's no context, so nothing is built.
  There is no volume slider, so "follows the SFX setting" means the sound
  on/off pref.
- **Levels** (rendered offline in Chromium, after the fade-in): the beds are
  −43 to −45 dBFS RMS, rain −33, dust −36, snow −40, and fog −44 to −51. All
  sit well under the reactor hum, and each weather is 4–12 dB over its bed.

## Code touchpoints

- `src/data/palettes.js`: variants; `src/data/weather.js` (new).
- `src/render/gl.js`: spotlight uniforms, instancing extension, instanced
  draw; `scene.js`: weather box, props pass with culling, shockwaves,
  scorches, lightning flash.
- `src/sim/update.js`: weather tick (wind on particles, lightning timer),
  headlight state on the mech (`m.lights`), time ramp.
- `src/sim/ai/perception.js`: weather and night factors.
- `src/render/hud.js`: radar range, LIGHTS button, target box range.
- `src/world/props.js`, `src/mesh/props.js`.
- `src/audio/sfx.js`: thunder, beds.
- `src/net/protocol.js`: `lt` (lights) bit in the state message; weather and
  time in `welcome`/`newround` (`wx`, `tm`).
- `src/ui/menu.js`: Free Play WEATHER and TIME pickers; `particles` setting.

## Acceptance criteria

1. Night volcanic with headlights: the player can see a JACKAL at 150 m in
   the beam and not outside it (screenshot); radar unchanged.
2. Each weather kind renders on both platforms (screenshots) and sets fog and
   radar factors per the table (test on `game.weather` application).
3. Lightning in the arena is simultaneous on two clients (same seed, same
   `game.time` → same flash times; test the schedule function).
4. Props are culled: with the camera facing away from an outpost, its draws
   are not issued (debug counter).
5. Explosion of a WARDEN produces a shockwave, plates that persist, a scorch,
   and at least one secondary (visual check and a test on `game.parts` kinds).
6. Frame budget: night, dust storm, six mechs, volcanic: ≤ 16.6 ms median on
   the reference phone at MED particles.

## Tests

`weather.test.js` (factors, lightning schedule determinism, wind applied to
smoke), `props.test.js` (placement determinism; no prop inside the flat start
zone; counts per biome within bounds), `explosions.test.js` (secondaries and
caps), `frustum.test.js` (sphere-vs-frustum against known cases).

## Performance

The instanced path is the enabler: weather alone would be 2500 draws without
it. The props pass must batch by mesh. Budget per the table in
[../architecture.md](../architecture.md).

## Open questions

- Headlights on by default at night? Default: on, with the AI sight bonus as
  the cost, so turning them off is a tactic.
- A `particles` LOW setting that disables weather particles entirely for old
  phones. Default: yes.
