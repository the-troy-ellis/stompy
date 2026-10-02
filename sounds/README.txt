Stompy's sound effects.

All clips are from two packs by Kenney (www.kenney.nl), released under
Creative Commons CC0 (public domain) -- licence files alongside:
  Sci-fi Sounds 1.0  https://kenney.nl/assets/sci-fi-sounds
  Impact Sounds 1.0  https://kenney.nl/assets/impact-sounds

Converted from OGG to mono 112 kbps MP3 (every browser decodes MP3; Safari
doesn't reliably decode OGG). Mapping, source -> file:
  impactMetal_heavy_00x       step0-4       taking a hit (armour clang)
  impactPunch_heavy_00x       punch0-2      footfalls and landings (slowed), autocannon thunk
  impactPlate_heavy_00x       plate0-1      landings, armour hits
  laserLarge_00x              laser0-4      player's large lasers
  laserSmall_00x              mlaser0-4     Jackals' medium lasers
  explosionCrunch_00x         crunch0-4     explosions, cannon crack
  lowFrequency_explosion_000  boom_big      mech destroyed
  lowFrequency_explosion_001  boom_low      small explosions, landings
  thrusterFire_000 (0.9 s)    missile       LRM launch
  thrusterFire_001            jet_loop      jump jets
  spaceEngineLow_000          hum_loop      reactor hum, rises with speed
  engineCircular_000          servo_loop    torso twist servo
  forceField_000              powerdown     reactor shutdown
  doorClose_000               powerup       reactor restart
  computerNoise_000 (0.12 s)  beep          targeting / weapon select

The game layers these over its own synthesised sub-bass and uses the
synthesis alone if a sample fails to load. See loadSamples()/sfx in
../stompy.js.
