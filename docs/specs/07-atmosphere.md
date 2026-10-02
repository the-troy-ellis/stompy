# Atmosphere: time of day, weather, props, explosions

| | |
|---|---|
| Status | ready |
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

**Headlights.** At night the player's mech (and in the arena every mech) has
two headlights: one spotlight term in the main shader (`uSpotPos`, `uSpotDir`,
`uSpotCone`, `uSpotCol`), evaluated per fragment, from the torso frame. Only
the local player's lights illuminate (one spot uniform set); other mechs get
emissive lamp quads so they are visible as lights, which the AI's `sight`
also uses: at night sight is 250 m, or 600 m toward a mech with lights on.
A key (L) and touch button (LIGHTS, in the top cluster) toggle them; off is
stealth, on is seeing. The IR missile camera is unchanged at night (that is
its moment).

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

**Wind** moves smoke and missile trails (`particle` velocities get `wind × dt`)
and leans rain/snow. Dust storms push the mech by 0.5 m/s laterally when
airborne (jets), nothing on the ground.

Weather particles live in a box around the camera (60 m × 30 m × 60 m),
recycled when they leave it. They are drawn with the instanced particle path
below, 1500 for rain, 800 for snow, 2500 for dust at intensity 1, scaled by a
`particles` setting (LOW / MED / HIGH, default MED on touch, HIGH on desktop).

Weather affects the AI (`sight` × radar factor) and the HUD (radar ring
shrinks; the target box drops at 1.2× the visible range).

### Props

`src/mesh/props.js` builds a small library with the `Builder`, all under 120
triangles each: storage tank (cylinder of 8), tower (today's), bunker (low
tapered cube), pipe run (a line of cylinders), wall segment, antenna mast
with dish, truck (the escort vehicle), launcher (mission 9 turret), relay
(mission 2), crate stacks, dead tree (ice), lava vent (volcanic: emissive
glow), ice spire.

`src/world/props.js` places them by biome rules from the seed: clusters near
the existing outposts, lines of pylons across the map, scattered singles.
Props become `game.entities` of kind `structure` with `hp: Infinity` unless a
mission marks them destructible. Mission placements override.

Props are drawn in one pass with a frustum test (sphere vs the view
frustum's planes from `VP`) and a distance cull at `fog[1]`.

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
