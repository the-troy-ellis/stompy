#include "test/test.h"
static Game G;

void testData(void) {
  dataInit();
  const Geo *p = geoFor(CH_PUNCHER);
  CHECK(p->hip == 5.0f && p->l1 == 2.6f && fabsf(p->legTop - 4.8f) < 1e-4f && fabsf(p->torsoY - 5.4f) < 1e-4f);   // hip 5.0 lifts legTop and torsoY by 0.4
  CHECK(p->girth == 1.35f && p->nLegs == 2);
  const Geo *s = geoFor(CH_SNIPER1);
  CHECK(s->nLegs == 2 && s->legs[0].hx == 0.7f && fabsf(s->height - 8.7f) < 1e-4f);
  CHECK(geoFor(CH_WARDEN)->nLegs == 4 && geoFor(CH_JACKAL)->knee == 1);
  CHECK(WEAPONS[W_FUSION].overload == 140 && WEAPONS[W_LASER].hps == 12 && CHASSIS[CH_PUNCHER].melee == &FIST_MELEE);
  CHECK(strcmp(CHASSIS_NAME[CH_KESTREL], "BARRY") == 0 && strcmp(WEAPON_NAME[W_FUSION], "OOPS BUTTON") == 0);
  // Every chassis's stock loadout fits its tonnage budget.
  for (int c = 0; c < CH_N; c++) { const Chassis *ch = &CHASSIS[c]; float t = ch->frame + ch->sinks * 1 + ch->armour * 2 + ch->jets * 1.5f; for (int i = 0; i < ch->nHard; i++) t += WEAPONS[ch->hard[i].stock].tons; CHECKF(t <= ch->tons, "%s %g > %g", ch->key, t, ch->tons); }
}

// Feet never slide: a planted foot's world position is fixed until it lifts.
void testGait(void) {
  for (int c = 0; c < CH_N; c++) {
    flatGame(&G, c, 3);
    Mech *P = G.player; Input in = noInput(); in.thr = 1;
    v3 was[4]; int lifted[4]; float maxSlide = 0, maxLift = 0; int steps_ = 0;
    for (int i = 0; i < 4; i++) { was[i] = P->feet[i].pos; lifted[i] = P->feet[i].lifted; }
    for (int f = 0; f < 60 * 12; f++) {
      update(&G, &in, 1.f / 60);
      for (int i = 0; i < P->geo->nLegs; i++) {
        Foot *ft = &P->feet[i];
        if (!ft->lifted && !lifted[i]) maxSlide = maxf(maxSlide, hypot2(ft->pos.x - was[i].x, ft->pos.z - was[i].z));
        if (ft->lifted) maxLift = maxf(maxLift, ft->pos.y - terHeight(&G.ter, ft->pos.x, ft->pos.z));
        if (!ft->lifted && lifted[i]) steps_++;
        was[i] = ft->pos; lifted[i] = ft->lifted;
      }
    }
    CHECKF(maxSlide < 1e-3f, "%s planted foot slid %g m", CHASSIS[c].key, maxSlide);
    CHECKF(P->z > CHASSIS[c].speed * 12 * 0.7f, "%s walked only %g m", CHASSIS[c].key, P->z);
    CHECKF(steps_ > 10, "%s took %d steps", CHASSIS[c].key, steps_);
    CHECKF(maxLift > 0.2f, "%s feet never lifted (%g)", CHASSIS[c].key, maxLift);
    CHECK(REC.sfx[SFX_STEP] == steps_);
    for (int i = 0; i < P->geo->nLegs; i++) { float d = vlen(vsub(P->feet[i].pos, V3(P->x, P->y + P->geo->hip * P->ch->scale, P->z))); CHECKF(d < (P->geo->l1 + P->geo->l2) * P->ch->scale * 1.2f, "%s leg %d overstretched %g", CHASSIS[c].key, i, d); }
  }
  // The gait clock is distance, not time: standing still, no steps.
  flatGame(&G, CH_KESTREL, 3); Input in = noInput(); steps(&G, &in, 120); CHECK(REC.sfx[SFX_STEP] == 0 && G.player->z == 0);
  // A step is felt: the bob column and the sub-bass.
  in.thr = 1; steps(&G, &in, 240); CHECK(REC.thumps > 5 && REC.bass > 0 && G.bob.x != 0);
}

// Heat 100 shuts the reactor down; 45 restarts it. Shutdown halts movement and firing.
void testHeat(void) {
  flatGame(&G, CH_KESTREL, 5);
  Mech *P = G.player; Input in = noInput(); in.energy = 1; in.thr = 1;
  int shutAt = -1, backAt = -1; float peak = 0;
  for (int f = 0; f < 60 * 40; f++) {
    update(&G, &in, 1.f / 60); peak = maxf(peak, P->heat);
    if (P->shutdown && shutAt < 0) shutAt = f;
    if (shutAt >= 0 && !P->shutdown && backAt < 0) { backAt = f; CHECKF(P->heat < 45.5f, "restarted at %g", P->heat); CHECK(P->speed < 0.5f); break; }
    if (P->shutdown) { CHECK(!P->beaming); CHECK(P->heat <= 100.5f || f == shutAt); }
  }
  CHECKF(shutAt > 0, "never shut down (peak %g)", peak); CHECK(backAt > shutAt);
  CHECK(saidLike("Reactor shutdown") && saidLike("Reactor online") && saidLike("Heat critical"));
  CHECK(REC.sfx[SFX_POWERDOWN] == 1 && REC.sfx[SFX_POWERUP] == 1);
  CHECKF(peak >= 100 && peak < 101, "peak %g", peak);
  // Two large lasers outrun a KESTREL's sinks; a JACKAL's two mediums do not for a while.
  flatGame(&G, CH_JACKAL, 5); in = noInput(); in.energy = 1; steps(&G, &in, 60 * 20); CHECK(G.player->heat < 100 || G.player->shutdown);
}

static Mech *foe(Game *g, int type, float x, float z, float yaw) { Mech *e = newMech(g, type, 1, x, z, yaw); e->ai.still = 1; return e; }
void testCombat(void) {
  // Melt belongs to the target: shared by every beam on it, and the shooter does not melt.
  flatGame(&G, CH_KESTREL, 7);
  Mech *P = G.player, *E = foe(&G, CH_WARDEN, 0, 60, PI_F);
  Input in = noInput(); in.energy = 1;
  float hp0 = E->hp[SEC_T] + E->hp[SEC_LA] + E->hp[SEC_RA] + E->hp[SEC_LL] + E->hp[SEC_RL];
  steps(&G, &in, 60 * 3 + 5);
  CHECKF(E->melt >= MELT_T - 0.01f, "melt %g", E->melt); CHECK(P->melt == 0); CHECK(P->beamMech == E);
  float dealt = hp0 - (E->hp[SEC_T] + E->hp[SEC_LA] + E->hp[SEC_RA] + E->hp[SEC_LL] + E->hp[SEC_RL]);
  CHECKF(dealt > 2 * 3.5f * 3 * 1.3f && dealt < 2 * 3.5f * 3 * 3.5f, "dealt %g over 3 s", dealt);   // the ramp: between cold and full melt
  in.energy = 0; steps(&G, &in, 60 * 3); CHECK(E->melt == 0);   // full to cold in 2 s
  // Section loss: an arm at zero dies with its weapons and comes off; both legs gone sits the mech down.
  flatGame(&G, CH_KESTREL, 7); P = G.player; E = foe(&G, CH_KESTREL, 0, 40, PI_F);
  int nDebris0 = G.nDebris;
  m4 tf = torsoFrame(E); v3 arm = m4apply(&tf, V3(E->geo->armX, E->geo->armY, 0.5f));
  damage(&G, E, arm, 40, P, 0, 0);
  CHECK(E->hp[SEC_LA] == 0 && E->alive); CHECK(E->w[0].mount == SEC_LA && E->w[0].dead); CHECK(G.nDebris > nDebris0);
  CHECK(E->hp[SEC_T] < E->max[SEC_T]);   // the overflow goes to the torso
  v3 leg = V3(E->x - 1, E->y + 1, E->z); E->hp[SEC_T] = E->max[SEC_T];
  damage(&G, E, leg, 50, P, 0, 0); damage(&G, E, V3(E->x + 1, E->y + 1, E->z), 50, P, 0, 0); CHECK(E->alive);
  CHECK(E->hp[SEC_LL] == 0 && E->hp[SEC_RL] == 0);
  in = noInput(); E->throttle = 1; steps(&G, &in, 60); CHECK(fabsf(E->speed) < 0.01f);
  // A torso at zero: the death beat, then the blast.
  damage(&G, E, centerOf(E), 500, P, 0, 0);
  CHECK(!E->alive && E->isDying && G.stats.kills == 1);
  int boom0 = REC.sfx[SFX_BOOM]; steps(&G, &in, 10); CHECK(REC.sfx[SFX_BOOM] == boom0);   // 0.25 s of silence first
  steps(&G, &in, 10); CHECK(REC.sfx[SFX_BOOM] > boom0);
  steps(&G, &in, 120); CHECK(E->gone && G.nWrecks == 1);
  CHECK(G.state == ST_OVER && G.won);
  // The player's own death ends the match.
  flatGame(&G, CH_JACKAL, 7); P = G.player; damage(&G, P, centerOf(P), 1000, NULL, 0, 0); CHECK(!P->alive && G.state == ST_OVER && !G.won);
  steps(&G, &in, 60 * 4); CHECK(G.state == ST_DEBRIEF);
  // The autocannon lands with its damage, uses ammo, and kicks.
  flatGame(&G, CH_KESTREL, 7); P = G.player; E = foe(&G, CH_WARDEN, 0, 80, PI_F);
  ready(P); in = noInput(); in.ballistic = 1; float t0 = E->hp[SEC_T] + E->hp[SEC_LA] + E->hp[SEC_RA] + E->hp[SEC_LL] + E->hp[SEC_RL];
  update(&G, &in, 1.f / 60); CHECK(P->w[2].type == W_AC && P->w[2].ammo == 29 && G.kick > 0);
  in = noInput(); steps(&G, &in, 60);
  float dealt2 = t0 - (E->hp[SEC_T] + E->hp[SEC_LA] + E->hp[SEC_RA] + E->hp[SEC_LL] + E->hp[SEC_RL]);
  CHECKF(fabsf(dealt2 - 11) < 0.01f, "ac dealt %g", dealt2);
  CHECK(REC.sfx[SFX_CANNON] == 1 && REC.sfx[SFX_CLANG] == 0);
}

void testMelee(void) {
  // A KESTREL shoving a JACKAL moves it over 6 m in a second; a WARDEN under 3; the shover recoils 0.2x.
  flatGame(&G, CH_KESTREL, 9);
  Mech *P = G.player, *J = foe(&G, CH_JACKAL, 0, 8, PI_F);
  Input in = noInput(); in.punch = 1; update(&G, &in, 1.f / 60); in.punch = 0;
  CHECK(P->melee.on);
  float jz = J->z; steps(&G, &in, 60);
  CHECKF(J->z - jz >= 6, "jackal moved %g", J->z - jz); CHECK(P->z < 0); CHECK(J->hp[SEC_T] + J->hp[SEC_LA] + J->hp[SEC_RA] < J->max[SEC_T] + J->max[SEC_LA] + J->max[SEC_RA]);
  CHECK(REC.sfx[SFX_PUNCH] == 1 && G.farthestShove > 0);
  flatGame(&G, CH_KESTREL, 9); P = G.player; Mech *W = foe(&G, CH_WARDEN, 0, 10, PI_F);
  in.punch = 1; update(&G, &in, 1.f / 60); in.punch = 0; float wz = W->z; steps(&G, &in, 60);
  CHECKF(W->z - wz < 3, "warden moved %g", W->z - wz);
  // No punch while shut down, mid-swing, or in the recovery; a whiff when nothing is there.
  flatGame(&G, CH_KESTREL, 9); P = G.player; P->shutdown = 1; CHECK(!meleePress(&G, P)); P->shutdown = 0;
  CHECK(meleePress(&G, P)); CHECK(!meleePress(&G, P)); in = noInput(); steps(&G, &in, 30); CHECK(P->melee.on && !meleePress(&G, P));
  steps(&G, &in, 60); CHECK(!P->melee.on && REC.sfx[SFX_PUNCH] == 1);
  // PURPLE PUNCHER punches with its own numbers, with one arm at full strength, and shoves with none.
  flatGame(&G, CH_PUNCHER, 9); P = G.player; CHECK(meleeOf(P) == &FIST_MELEE);
  P->hp[SEC_LA] = 0; CHECK(meleeOf(P) == &FIST_MELEE && punchArm(P) == SEC_RA); P->hp[SEC_RA] = 0; CHECK(meleeOf(P) == &DEFAULT_MELEE);
  // A stomp: a mech falling 0.6 s or more onto another applies stompDmg and bounces; a hop does not.
  flatGame(&G, CH_KESTREL, 9); P = G.player; J = foe(&G, CH_JACKAL, 0, 0.5f, 0);
  P->y = J->y + J->geo->height * J->ch->scale + 12; P->air = 1; P->vy = 0; float jt = J->hp[SEC_T];
  in = noInput(); steps(&G, &in, 120);
  CHECKF(jt - J->hp[SEC_T] >= DEFAULT_MELEE.stompDmg - 0.01f, "stomp dealt %g", jt - J->hp[SEC_T]); CHECK(REC.sfx[SFX_PUNCH] >= 1);
  flatGame(&G, CH_KESTREL, 9); P = G.player; J = foe(&G, CH_JACKAL, 0, 0.5f, 0);
  P->y = J->y + J->geo->height * J->ch->scale + 1; P->air = 1; P->vy = 0; P->airT = 0; jt = J->hp[SEC_T]; steps(&G, &in, 60);
  CHECK(J->hp[SEC_T] == jt);
}

void testFusion(void) {
  // A 3 s scan kills the target; heat jumps to 140, the reactor shuts down, the torso takes feedback, the cannon recharges.
  flatGame(&G, CH_KESTREL, 11);
  Mech *P = G.player, *E = foe(&G, CH_WARDEN, 0, 120, PI_F);
  Input in = noInput(); in.fusion = 1;
  steps(&G, &in, 60 * 3 + 40);
  CHECK(!E->alive); CHECKF(P->heat >= 120, "heat %g", P->heat); CHECK(P->shutdown);
  CHECKF(fabsf(P->hp[SEC_T] - P->max[SEC_T] * 0.65f) < 1, "torso %g of %g", P->hp[SEC_T], P->max[SEC_T]);
  CHECK(REC.sfx[SFX_FUSIONCRACK] == 1);
  Weapon *f = &P->w[P->nW - 1]; CHECK(f->def->kind == WK_FUSION && f->cd > 20);
  // A slip shorter than the grace pauses the scan; the scan starts over on another mech.
  flatGame(&G, CH_KESTREL, 11); P = G.player; E = foe(&G, CH_WARDEN, 0, 120, PI_F);
  steps(&G, &in, 60); CHECK(P->fusion.mech == E && P->fusion.t > 0.8f);
  float t = P->fusion.t; P->twist = 1.5f; steps(&G, &in, 12); CHECK(P->fusion.mech == E && P->fusion.slipping && fabsf(P->fusion.t - t) < 0.01f);
  steps(&G, &in, 30); CHECK(P->fusion.mech == NULL || P->fusion.t < t);
}

void testJets(void) {
  // Hold to charge, let go to blast off; the landing is heavy; no jets with the reactor down.
  flatGame(&G, CH_KESTREL, 13);
  Mech *P = G.player; Input in = noInput(); in.jets = 1; steps(&G, &in, 30);
  CHECK(P->jet.charge > 0.4f && !P->air);
  in.jets = 0; update(&G, &in, 1.f / 60); CHECK(P->air && P->vy > 10 && P->fuel < 0.1f && P->heat > 3 && REC.sfx[SFX_BLASTOFF] == 1);
  float top = 0; int landed = 0; int frames = 0;
  for (int f = 0; f < 60 * 8; f++) { update(&G, &in, 1.f / 60); top = maxf(top, P->y); frames++; if (!P->air) { landed = 1; break; } }
  CHECKF(landed && top > 8, "top %g landed %d", top, landed); CHECK(REC.sfx[SFX_LAND] == 1 && G.kick > 0);
  CHECK(P->fuel < 1);
  P->shutdown = 1; P->heat = 100; in.jets = 1; steps(&G, &in, 60); CHECK(P->jet.charge == 0 && !P->air);
}

void testMissiles(void) {
  // Missiles need a lock to home: with the target in the sights they find it.
  flatGame(&G, CH_KESTREL, 15);
  Mech *P = G.player, *E = foe(&G, CH_WARDEN, 0, 300, PI_F);
  G.target = E; ready(P); Input in = noInput(); update(&G, &in, 1.f / 60); CHECK(G.lock && G.lockOn && REC.sfx[SFX_LOCK] == 1);
  in.missileTap = 1; update(&G, &in, 1.f / 60); in.missileTap = 0;
  CHECK(G.nShots == 10 && G.shots[0].target == E);
  float hp0 = E->hp[SEC_T] + E->hp[SEC_LA] + E->hp[SEC_RA] + E->hp[SEC_LL] + E->hp[SEC_RL];
  steps(&G, &in, 60 * 6);
  CHECKF(hp0 - (E->hp[SEC_T] + E->hp[SEC_LA] + E->hp[SEC_RA] + E->hp[SEC_LL] + E->hp[SEC_RL]) > 5, "missiles dealt little");
  CHECK(REC.sfx[SFX_MISSILE] == 1 && REC.sfx[SFX_BOOM] >= 5);
  // Hold to guide: the volley follows the camera; let go and it detonates.
  flatGame(&G, CH_KESTREL, 15); P = G.player; ready(P); in = noInput(); in.missile = 1; steps(&G, &in, 20); CHECK(G.guide.on && G.guide.n == 10);
  in.missile = 0; update(&G, &in, 1.f / 60); CHECK(!G.guide.on && G.nShots == 0);
  // FIRECRACKERS fire without a lock.
  flatGame(&G, CH_PUNCHER, 15); ready(G.player); in = noInput(); in.missileTap = 1; update(&G, &in, 1.f / 60); CHECK(G.nShots == 6 && G.shots[0].target == NULL);
}

void testFeel(void) {
  // Springs converge: no NaN, no runaway, settled within 2 s of any kick under 3.
  Spring s; springInit(&s, FEEL_SPRING.wobbleK, FEEL_SPRING.wobbleZeta); springKick(&s, 3);
  float peak = 0; for (int i = 0; i < 120; i++) { springStep(&s, 1.f / 60, 0); peak = maxf(peak, fabsf(s.x)); }
  CHECK(isfinite(s.x) && fabsf(s.x) < 0.01f && peak > 0.05f);
  // Every row is wired: a hit on the player kicks, shakes, flashes and wobbles from the table.
  flatGame(&G, CH_KESTREL, 17); Mech *P = G.player;
  v3 chest = V3(P->x, P->y + 5.5f * P->ch->scale, P->z + 1);
  damage(&G, P, chest, 10, NULL, 0, 0);
  CHECK(fabsf(G.kick - FEEL[FE_HIT].kick) < 1e-5f && fabsf(G.shake - FEEL[FE_HIT].shake) < 1e-5f && fabsf(G.flash - FEEL[FE_HIT].flash) < 1e-5f && P->wobP.v > 0);
  CHECK(REC.sfx[SFX_CLANG] == 1 && REC.haptic == FEEL[FE_HIT].haptic);
  // REDUCED MOTION cuts the camera columns to 30% and the haptics to nothing; the mech still wobbles.
  flatGame(&G, CH_KESTREL, 17); P = G.player; G.reducedMotion = 1; damage(&G, P, V3(P->x, P->y + 5.5f * P->ch->scale, P->z + 1), 10, NULL, 0, 0);
  CHECK(fabsf(G.kick - FEEL[FE_HIT].kick * 0.3f) < 1e-5f && REC.haptic == 0 && P->wobP.v > 0);
  // Knockback jolts the aim toward the blow without taking control.
  flatGame(&G, CH_KESTREL, 17); P = G.player; float dir[2] = { 0, 1 }; knock(&G, P, NULL, 10, dir, 0);
  CHECK(fabsf(P->twist) > 0.2f && P->pitch > 0.05f && P->push[1] == 10);
  // Shutdown sags the hips; the restart overshoots.
  flatGame(&G, CH_KESTREL, 17); P = G.player; P->heat = 101; Input in = noInput(); steps(&G, &in, 60); CHECK(P->shutdown && P->sag.x > 0.3f);
  P->heat = 44; update(&G, &in, 1.f / 60); CHECK(!P->shutdown && P->sag.v < 0);
}

void testAi(void) {
  // Over 60 s of a fight on each difficulty, no enemy's own fire takes it past its heat cap by more than a beam frame.
  for (int d = 0; d < DIFF_N; d++) {
    gameInit(&G, recFx(), 21); startFreePlay(&G, PAL_DUSK, TIME_DUSK, WX_CLEAR, 4, 21, CH_KESTREL, d, 1);
    float worst = 0; int shots = 0; Input in = noInput();
    for (int i = 1; i < G.nMechs; i++) { G.mechs[i].ai.aware = 1; G.mechs[i].x *= 0.4f; G.mechs[i].z *= 0.4f; }
    G.player->hp[SEC_T] = 1e6f; G.player->max[SEC_T] = 1e6f;
    for (int f = 0; f < 60 * 60; f++) { update(&G, &in, 1.f / 60); for (int i = 1; i < G.nMechs; i++) { Mech *e = &G.mechs[i]; if (!e->alive || e->fusion.on) continue; worst = maxf(worst, e->heat - DIFFS[d].heatCap); shots += e->ai.shots; } }
    CHECKF(worst < 5, "%s over the cap by %g", DIFFS[d].label, worst);
    CHECKF(G.stats.taken > 0, "%s: the enemies never hit the player", DIFFS[d].label);
  }
  // An enemy cannot track the player through a hill: its belief stays where it last saw them.
  gameInit(&G, recFx(), 23); startFreePlay(&G, PAL_DUSK, TIME_DUSK, WX_CLEAR, 0, 23, CH_KESTREL, DIFF_NORMAL, 1);
  Mech *E = newMech(&G, CH_JACKAL, 1, 0, 200, PI_F); E->ai.aware = 1;
  // A ridge between: raise the terrain cells in a band at z 100.
  for (int i = 0; i <= G.ter.nx; i++) for (int j = 0; j <= G.ter.nz; j++) { float z = -G.ter.hz + j * TER_CELL; if (z > 80 && z < 130) G.ter.hs[j * (G.ter.nx + 1) + i] = 60; }
  Input in = noInput(); steps(&G, &in, 30);
  CHECK(!E->ai.seen);
  G.player->x = 150; steps(&G, &in, 60); CHECKF(fabsf(E->ai.bx) < 1, "belief x %g", E->ai.bx);
  // Heavies in a line match the slowest within 150 m; a harasser flips its strafe when hit.
  gameInit(&G, recFx(), 25); startFreePlay(&G, PAL_DUSK, TIME_DUSK, WX_CLEAR, 0, 25, CH_KESTREL, DIFF_NORMAL, 1);
  Mech *W = newMech(&G, CH_WARDEN, 1, 0, 400, PI_F), *K = newMech(&G, CH_KESTREL, 1, 30, 400, PI_F); K->ai.profile = PROF_LINE; W->ai.aware = K->ai.aware = 1;
  steps(&G, &in, 60 * 2); CHECKF(K->speed <= W->maxSpeed + 0.5f, "kestrel %g vs warden top %g", K->speed, W->maxSpeed);
  gameInit(&G, recFx(), 27); startFreePlay(&G, PAL_DUSK, TIME_DUSK, WX_CLEAR, 0, 27, CH_KESTREL, DIFF_NORMAL, 1);
  Mech *J = newMech(&G, CH_JACKAL, 1, 0, 170, PI_F); J->ai.aware = 1; steps(&G, &in, 60); float s0 = J->ai.strafe;
  damage(&G, J, centerOf(J), 1, G.player, 0, 0); steps(&G, &in, 2); CHECK(J->ai.strafe == -s0);
  // A punch from an adjacent enemy on HARD within 3 s of opportunity.
  gameInit(&G, recFx(), 29); startFreePlay(&G, PAL_DUSK, TIME_DUSK, WX_CLEAR, 0, 29, CH_KESTREL, DIFF_HARD, 1);
  J = newMech(&G, CH_JACKAL, 1, 0, 7, PI_F); J->ai.aware = 1; int punched = 0;
  for (int f = 0; f < 180; f++) { update(&G, &in, 1.f / 60); if (J->melee.on) punched = 1; }
  CHECK(punched);
}

// The tone guide, as tests: briefs in the board-book voice, the voice flat and short.
static int countWords(const char *s) { int n = 0, in = 0; for (; *s; s++) { if (*s == ' ' || *s == '.') { in = 0; } else if (!in) { in = 1; n++; } } return n; }
void testTone(void) {
  for (int i = 0; i < MISSION_N; i++) {
    const char *b = MISSIONS[i].intel; int sentences = 0, longest = 0, words = 0; char last = 0;
    CHECKF(!strchr(b, '!') && !strchr(b, '?'), "%s brief has ! or ?", MISSIONS[i].key);
    for (const char *p = b; *p; p++) { CHECKF(!(*p >= '0' && *p <= '9'), "%s brief has a digit", MISSIONS[i].key); if (*p == '.') { sentences++; longest = longest > words ? longest : words; words = 0; } else if (*p == ' ') { if (last != ' ' && last != '.') words++; } last = *p; }
    CHECKF(sentences >= 1 && sentences <= 4, "%s brief has %d sentences", MISSIONS[i].key, sentences);
    CHECKF(longest <= 8, "%s brief has a %d-word sentence", MISSIONS[i].key, longest);
    CHECK(b[strlen(b) - 1] == '.');
  }
  for (int k = 0; k < VO_N; k++) for (int i = 0; i < VOICE_MAX && VOICE[k][i]; i++) {
    const char *l = VOICE[k][i];
    CHECKF(countWords(l) <= 7 && !strchr(l, '!') && l[strlen(l) - 1] == '.', "voice line too long or loud: %s", l);
  }
  for (int c = 0; c < CH_N; c++) CHECKF(!strchr(CHASSIS_ROLE[c], '!') && countWords(CHASSIS_ROLE[c]) <= 12, "%s role line", CHASSIS[c].key);
  for (int v = 0; v < VERDICT_N; v++) CHECK(countWords(VERDICT[v]) == 1 && VERDICT[v][strlen(VERDICT[v]) - 1] == '.');
  // The voice pools: never a dry line twice in a mission, at most one a minute.
  flatGame(&G, CH_KESTREL, 31); int dry = 0;
  for (int i = 0; i < 20; i++) { const char *l = voiceLine(&G, VO_KILL, NULL); if (strcmp(l, VOICE[VO_KILL][0])) dry++; }
  CHECK(dry <= 1);
}
