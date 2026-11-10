# Backlog, as issues

Ready to file, labelled `deck`. The milestone is the roadmap's. Sizes: S (an
afternoon), M (a day or two), L (a week).

## M1: played, then tuned

1. **Deck playtest 1** (M). Run the checklist on the Deck. Three words.
   Answer the seven questions in roadmap.md § M1. File what is wrong.
2. **DIRECT throttle mode** (S). A SETTINGS toggle: the left stick's position
   is the throttle. Default stays HOLD until the playtest says otherwise.
3. **Rumble tuning** (S). A SETTINGS slider for rumble strength; the per-event
   mapping (`fxThump` in app.c) tuned on the Deck: low motor from bass, high
   motor from the kick, length from the haptic column.
4. **Live FEEL tuning** (M). F3's debug page gets a FEEL tab: the rows of the
   feel table editable with the D-pad, printed to stderr to copy back into
   `data.c`. The reference's `?debug=1` panel, for the Deck.
5. **Cockpit arms** (S). Keep, shrink or drop, per the playtest. If kept,
   the barrels should point where the torso does.
6. **HUD scale and placement** (S). HUD SCALE in SETTINGS (the plumbing is
   there); the ring's corner and size per the playtest.
7. **Gyro feel** (S). The axis convention and sensitivity per the playtest;
   whether the right pad's touch is the right gate.

## M2: Act I's rest

8. **Entities** (L). Structures and vehicles as cylinders in the sim
   (`rayHit` finds them, blasts and punches reach them, footprints push mechs
   out), with meshes (a relay tower, a truck, a tank, a pad).
9. **Objectives** (M). DESTROY, ESCORT (trucks on a route, a minimum alive),
   SURVIVE (a clock, waves), EXTRACT (a pad, a clock); the HUD's objective
   line; the markers.
10. **Waves** (S). On the clock or on progress, from a bearing, with the
    `Reinforcements inbound.` line three seconds out.
11. **TOWER TOPPLER and HELPLESS LIL BUDDIES** (M). The missions as the
    reference defines them (`src/data/missions.js`), playable.
12. **The silent tutorial** (S). Mission 1's prompts: which control is up,
    when it is done.
13. **The perfect-player harness** (M). A test that wins every playable
    mission headlessly by direct damage and teleports, and fails each on its
    fail rule.

## M3: mechlab-lite

14. **Loadouts** (M). `validate`, `apply`, `stats`; saved per chassis in the
    settings file; the tests from the reference's spec 02.
15. **The FIT screen** (M). Rows that cycle with left and right, the tonnage
    bar, OVERWEIGHT, RESET, the mech's pods updating on the turntable.

## M4: atmosphere

16. **Weather particles** (M). Rain, snow, dust and fog as the reference's
    shapes, with the wind.
17. **Night and headlights** (M). The dusk-to-night ramp (already in the
    sim), a spotlight term in the shader, lamps on other mechs.
18. **Ambience** (S). The noise beds per biome and per weather kind.
19. **CC0 samples** (M). The reference's Kenney clips (steps, punches,
    plates, lasers, booms, loops) decoded from WAV and layered under the
    synthesis. Candidate library to ask the owner about: stb_vorbis (one
    public-domain file) to load the packs' OGG files directly; without it,
    WAV through SDL_LoadWAV.
20. **The cockpit voice** (M). Recorded lines (the owner's, or a flat TTS
    render they pick), one WAV per line, played by `say`. The chirp stays as
    the fallback.

## M5: the rest of the campaign

21. **The glacier and the volcanic plain** (M). Palettes are in; each needs
    its props and its missions 5 to 12 from the reference.
22. **The forest** (M). Trees as trunks to walk round, punch and burn.
23. **Entrances** (S). A wave entry that walks in with its footfalls felt
    from anywhere (PURPLE PUNCHER in mission 10).
24. **Contracts** (S). Procedural missions after twelve.

## Any time

25. **A CI job for deck/** (S). `.github/workflows/deck.yml` builds, lints
    and tests on Ubuntu with libsdl2-dev. (Included in this branch.)
26. **Split deck/ into its own repository** (S). `git subtree split -P deck`
    when the owner wants it apart from the browser version.
