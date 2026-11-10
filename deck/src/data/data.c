#include "data/data.h"
#define PI_F_ 3.14159265358979323846f
static inline float clampf_(float v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
#include <math.h>
#include <string.h>

// Melee numbers per chassis (docs/specs/12-melee.md). Every mech can shove;
// PURPLE PUNCHER's fists override these. Reach is metres times chassis scale.
const MeleeDef DEFAULT_MELEE = { 8, 9, 30 * PI_F_ / 180, 0.3f, 0.7f, 1.5f, 2, 12, 6, 6, 0.6f, 0 };
const MeleeDef FIST_MELEE = { 30, 14, 25 * PI_F_ / 180, 0.45f, 0.9f, 2, 4, 22, 18, 14, 0.6f, 1 };
const AiPunch AI_PUNCH = { { 0.3f, 0.6f, 0.9f }, 1.3f };

// Weapons: beams climb with the target's melt (beams.c), shells use ammo,
// missiles need a lock, the fusion cannon is a whole decision.
#define RGB(r, g, b) { r, g, b }
const WeaponDef WEAPONS[W_N] = {
  [W_LASER]  = { "laser", WK_BEAM, CAT_ENERGY, .dps = 3.5f, .hps = 12, .range = 520, .col = RGB(1, 0.25f, 0.2f), .w = 0.22f, .cd = 1, .tons = 5, .fp = 3.5f, .spread = -1, .lift = -1 },
  [W_MLASER] = { "mlaser", WK_BEAM, CAT_ENERGY, .dps = 2.0f, .hps = 6, .range = 360, .col = RGB(0.3f, 1, 0.35f), .w = 0.16f, .cd = 1, .tons = 2, .fp = 2, .spread = -1, .lift = -1 },
  [W_PLASER] = { "plaser", WK_BEAM, CAT_ENERGY, .dps = 2.6f, .hps = 8, .range = 300, .col = RGB(1, 0.55f, 0.15f), .w = 0.15f, .cd = 1, .tons = 3, .fp = 2.6f, .meltRate = 1.5f, .stutter = 12, .spread = -1, .lift = -1 },
  [W_FLAMER] = { "flamer", WK_BEAM, CAT_ENERGY, .dps = 0.8f, .hps = 3, .range = 90, .col = RGB(1, 0.5f, 0.12f), .w = 0.1f, .cd = 1, .tons = 1.5f, .fp = 0.8f, .targetHeat = 6, .cone = 1, .sfx = SFX_K_TOASTER, .spread = -1, .lift = -1 },
  [W_GAUSS]  = { "gauss", WK_SHELL, CAT_BALLISTIC, .dmg = 20, .heat = 1, .cd = 3.2f, .range = 800, .speed = 700, .ammo = 12, .knock = 6, .recoil = 1.6f, .hasTracer = 1, .tracer = RGB(0.85f, 0.95f, 1), .sfx = SFX_K_BONKER, .tons = 12, .fp = 6.3f, .spread = -1, .lift = -1 },
  [W_MG]     = { "mg", WK_SHELL, CAT_BALLISTIC, .dmg = 0.8f, .heat = 0.2f, .cd = 0.5f, .range = 220, .speed = 520, .ammo = 60, .burstN = 6, .burstDt = 0.05f, .jitter = 0.012f, .hasTracer = 1, .tracer = RGB(1, 0.85f, 0.45f), .tw = 0.18f, .tl = 3.5f, .sfx = SFX_K_PEASHOOTER, .tons = 1, .fp = 9.6f, .spread = -1, .lift = -1 },
  [W_AC]     = { "ac", WK_SHELL, CAT_BALLISTIC, .dmg = 11, .heat = 2, .cd = 1.1f, .range = 650, .speed = 340, .ammo = 30, .tons = 8, .fp = 10, .spread = -1, .lift = -1 },
  [W_PPC]    = { "ppc", WK_SHELL, CAT_ENERGY, .bolt = 1, .dmg = 14, .heat = 11, .cd = 3.5f, .range = 600, .speed = 420, .scramble = 1.5f, .col = RGB(0.45f, 0.7f, 1), .tons = 7, .fp = 4, .sfx = SFX_K_THUNDERCLAP, .spread = -1, .lift = -1 },
  [W_SRM]    = { "srm", WK_MISSILE, CAT_MISSILE, .homing = 0, .dmg = 2.6f, .heat = 4, .cd = 3, .range = 260, .speed = 160, .ammo = 18, .count = 6, .knock = 1.2f, .spread = 0.035f, .lift = 0.02f, .tons = 3, .fp = 5.2f },
  [W_LRM]    = { "lrm", WK_MISSILE, CAT_MISSILE, .homing = 1, .dmg = 1.9f, .heat = 6, .cd = 4.5f, .range = 850, .speed = 120, .ammo = 14, .count = 10, .tons = 6, .fp = 4.2f, .spread = -1, .lift = -1 },
  [W_FUSION] = { "fusion", WK_FUSION, CAT_FUSION, .scan = 3, .cd = 25, .overload = 140, .range = 600, .scanHeat = 2, .col = RGB(0.78f, 0.5f, 1), .slack = 1.5f, .grace = 0.5f, .assist = 2.2f, .feedback = 0.35f, .pulseSpeed = 350, .spread = -1, .lift = -1 },
};

// Body plans by leg type. Lengths are model units (times chassis scale).
// +x is the mech's left, +z its front.
const Geo GEO[LEG_N] = {
  [LEG_FORWARD] = { 4.6f, 2.6f, 2.5f, 0.42f, 0, 0.36f, { 3.5f, 4.5f }, 2.4f, 7.9f, 4.4f, 5, { 0, 2.35f, 1.9f }, 2.25f, 2.0f, 3.2f, 1.6f, 1,
    2, { { 0.95f, 0, 1.1f, 0, 0 }, { -0.95f, 0, -1.1f, 0, 0.5f } } },
  [LEG_REVERSE] = { 4.9f, 2.7f, 2.9f, 0.5f, 1, 0.42f, { 3.5f, 4.5f }, 2.4f, 8.6f, 4.7f, 5.3f, { 0, 2.6f, 1.5f }, 2.3f, 2.0f, 3.3f, 1.6f, 1,
    2, { { 1.0f, 0.1f, 1.15f, 0.45f, 0 }, { -1.0f, 0.1f, -1.15f, 0.45f, 0.5f } } },
  [LEG_QUAD] = { 3.4f, 2.4f, 2.9f, 0.35f, 2, 0.34f, { 3.0f, 3.6f }, 3.1f, 6.6f, 3.3f, 4.0f, { 0, 1.6f, 1.4f }, 1.9f, 1.2f, 2.1f, 0.9f, 1,
    4, { { 1.4f, 1.6f, 2.9f, 2.3f, 0 }, { -1.4f, -1.6f, -2.9f, -2.2f, 0 }, { -1.4f, 1.6f, -2.9f, 2.3f, 0.5f }, { 1.4f, -1.6f, 2.9f, -2.2f, 0.5f } } },
};

// Gaits by leg type (docs/specs/16-body-plans.md): how a plan's steps look, never how fast it goes.
const Gait GAIT[LEG_N] = {
  [LEG_FORWARD] = { 1.7f, 2.6f, 12, 0.55f, 0.6f, 0.8f, { 0.6f, 0.9f }, 0.6f, 0.85f, 0.24f, 0.35f, 0.04f, 0.2f, 0.08f, 0.2f, 0.4f, { 0.1f, 0.35f },
    145, 0, 20, 0.3f, 1.1f, 70, 0.55f, 0.12f, 0.045f, 0.3f },
  [LEG_REVERSE] = { 3.0f, 3.0f, 0, 0.55f, 0.62f, 0.45f, { 0.5f, 1.2f }, 0.85f, 0.3f, 0.08f, 0.1f, 0.4f, 0.06f, 0.04f, 0.28f, 0.5f, { 0.25f, 0.5f },
    100, 125, 0, 0.5f, 0.5f, 140, 0.6f, 0.08f, 0.03f, 0.15f },
  [LEG_QUAD] = { 1.4f, 0, 0, 2, 0.34f, 0.4f, { 0.4f, 0.6f }, 0.6f, 0.75f, 0.2f, 0.2f, 0.03f, 0.1f, 0.03f, 0, 0, { 0, 0 },
    105, 0, 0, 0.5f, 0.8f, 90, 0.6f, 0.06f, 0.05f, 0.15f },
};

#define HP(t, la, ra, ll, rl) { t, la, ra, ll, rl }
const Chassis CHASSIS[CH_N] = {
  [CH_KESTREL] = { "kestrel", LEG_FORWARD, STYLE_REVERSE, 15, 1.05f, 10, 1, 300, 0.03f, PROF_BASELINE, HP(72, 32, 32, 42, 42), RGB(0.55f, 0.58f, 0.62f), RGB(0.85f, 0.6f, 0.15f),
    45, 12.5f, 0, 0, 1, 2, 4, { { "la", SEC_LA, CAT_ENERGY, W_LASER }, { "ra", SEC_RA, CAT_ENERGY, W_LASER }, { "t1", SEC_T, CAT_BALLISTIC, W_AC }, { "t2", SEC_T, CAT_MISSILE, W_LRM } }, 0, {0}, 0 },
  [CH_JACKAL] = { "jackal", LEG_REVERSE, STYLE_FORWARD, 19, 1.6f, 9, 0.85f, 140, 0.035f, PROF_HARASS, HP(30, 13, 13, 18, 18), RGB(0.62f, 0.26f, 0.2f), RGB(0.2f, 0.2f, 0.22f),
    25, 15.5f, 0, 0, 1, 2, 2, { { "la", SEC_LA, CAT_ENERGY, W_MLASER }, { "ra", SEC_RA, CAT_ENERGY, W_MLASER } }, 0, {0}, 0 },
  // The biggest: heavier, larger and slower than PURPLE PUNCHER.
  [CH_WARDEN] = { "warden", LEG_QUAD, STYLE_QUAD, 8, 0.7f, 10, 1.4f, 330, 0.025f, PROF_LINE, HP(58, 28, 28, 34, 34), RGB(0.36f, 0.4f, 0.3f), RGB(0.75f, 0.7f, 0.2f),
    90, 56, 0, 0, 1, 2, 3, { { "t1", SEC_T, CAT_MISSILE, W_LRM }, { "ra", SEC_RA, CAT_BALLISTIC, W_AC }, { "la", SEC_LA, CAT_ENERGY, W_LASER } }, 0, {0}, 4 },
  // A light reverse-joint skirmisher: long shins, boosted jets stock, shoved a very long way.
  [CH_LIGHT1] = { "light1", LEG_REVERSE, STYLE_LIGHT1, 22, 1.9f, 8, 0.8f, 170, 0.035f, PROF_SKIRMISH, HP(28, 12, 12, 16, 16), RGB(0.26f, 0.58f, 0.56f), RGB(0.95f, 0.45f, 0.18f),
    25, 12.5f, 0, 0, 2, 2, 3, { { "la", SEC_LA, CAT_MISSILE, W_SRM }, { "ra", SEC_RA, CAT_ENERGY, W_MLASER }, { "t1", SEC_T, CAT_BALLISTIC, W_MG } }, 0,
    { .hip = 4.5f, .l1 = 2.4f, .l2 = 2.9f, .stride = { 4.2f, 5.2f }, .swing = 0.46f, .radius = 2.2f, .height = 7.6f, .armX = 1.45f, .armY = 1.6f, .eye = { 0, 1.55f, 1.1f }, .acY = 0.8f, .rackY = 2.2f }, 6 },
  // A medium sniper on stilts: tall legs, a narrow stance, a long gun arm.
  [CH_SNIPER1] = { "sniper1", LEG_FORWARD, STYLE_SNIPER1, 13, 0.9f, 11, 1, 450, 0.02f, PROF_SNIPER, HP(60, 26, 26, 36, 36), RGB(0.72f, 0.7f, 0.62f), RGB(0.2f, 0.45f, 0.75f),
    50, 21.5f, 0, 0, 0, 1, 3, { { "ra", SEC_RA, CAT_BALLISTIC, W_GAUSS }, { "la", SEC_LA, CAT_ENERGY, W_PPC }, { "t1", SEC_T, CAT_ENERGY, W_MLASER } }, 0,
    { .hip = 5.4f, .l1 = 3.0f, .l2 = 2.8f, .radius = 2.2f, .armX = 1.9f, .armY = 1.9f, .eye = { 0, 2.0f, 1.4f }, .acY = 1.3f, .rackY = 2.6f,
      .nLegs = 2, .legs = { { 0.7f, 0, 0.8f, 0, 0 }, { -0.7f, 0, -0.8f, 0, 0.5f } } }, 8 },
  // The one with fists. Slow enough to kite, ruinous if it reaches you.
  [CH_PUNCHER] = { "puncher", LEG_FORWARD, STYLE_PUNCHER, 9, 0.6f, 12, 1.3f, 20, 0.03f, PROF_BRAWLER, HP(110, 50, 50, 60, 60), RGB(0.45f, 0.22f, 0.6f), RGB(0.95f, 0.75f, 0.2f),
    80, 57, 0, 0, 0, 1, 2, { { "t1", SEC_T, CAT_BALLISTIC, W_AC }, { "t2", SEC_T, CAT_MISSILE, W_SRM } }, &FIST_MELEE,
    { .hip = 5.0f, .l1 = 2.6f, .l2 = 2.6f, .stride = { 3.0f, 3.4f }, .girth = 1.35f, .radius = 3.0f, .armX = 2.95f, .armY = 1.55f, .eye = { 0, 1.8f, 1.75f }, .acY = 0.9f, .rackY = 2.55f }, 11 },
};
const int MECH_ORDER[CH_N] = { CH_KESTREL, CH_JACKAL, CH_WARDEN, CH_LIGHT1, CH_SNIPER1, CH_PUNCHER };

static Geo PLANS[CH_N];
const Geo *geoFor(int ch) { return &PLANS[ch]; }
void dataInit(void) {
  for (int i = 0; i < CH_N; i++) {
    const Chassis *c = &CHASSIS[i]; const Geo *b = &GEO[c->legs], *o = &c->geoOver; Geo *g = &PLANS[i];
    *g = *b;
    float dh = (o->hip ? o->hip : b->hip) - b->hip;
    g->legTop = b->legTop + dh; g->torsoY = b->torsoY + dh; g->height = b->height + dh;
#define OV(f) if (o->f) g->f = o->f
    OV(hip); OV(l1); OV(l2); OV(ankle); OV(swing); OV(radius); OV(height); OV(legTop); OV(torsoY); OV(armX); OV(armY); OV(rackY); OV(acY); OV(girth);
    if (o->stride[0]) { g->stride[0] = o->stride[0]; g->stride[1] = o->stride[1]; }
    if (o->eye[1]) { g->eye[0] = o->eye[0]; g->eye[1] = o->eye[1]; g->eye[2] = o->eye[2]; }
    if (o->nLegs) { g->nLegs = o->nLegs; memcpy(g->legs, o->legs, sizeof g->legs); }
#undef OV
  }
}

// The feel table (docs/specs/13-thunk.md): kick, bob, shake, flash, white, squash, wobble, bass, duck, dust, haptic, push, sag, overshoot.
const FeelRow FEEL[FE_N] = {
  [FE_STEP]        = { 0, 28, 0.03f, 0, 0, 0.03f, 0, 0.4f, 0, 1, 10, 0 },
  [FE_NEARSTEP]    = { 0.15f, 0, 0.12f, 0, 0, 0, 0.05f, 0.3f, 0, 0, 8, 0 },
  [FE_BLASTOFF]    = { 1.6f, 0, 1.2f, 0, 0.25f, 0.45f, 0.8f, 1.6f, 0.8f, 6, 110, 0 },
  [FE_LAND]        = { 1.0f, 0, 0.6f, 0, 0, 0.25f, 0.4f, 1.0f, 0.3f, 3, 40, 0 },
  [FE_FIREAC]      = { 0.5f, 0, 0.2f, 0, 0, 0, 0.3f, 0.6f, 0, 0, 20, 0.4f },
  [FE_FIREGAUSS]   = { 1.0f, 0, 0.6f, 0, 0.1f, 0.08f, 0.5f, 1.0f, 0.3f, 1, 50, 0 },
  [FE_FIREMG]      = { 0.12f, 0, 0.06f, 0, 0, 0, 0.04f, 0.15f, 0, 0, 8, 0.03f },
  [FE_FIREBOLT]    = { 0.4f, 0, 0.3f, 0, 0.12f, 0, 0.25f, 0.7f, 0.1f, 0, 25, 0.25f },
  [FE_BOLT]        = { 0.6f, 0, 0.9f, 0.2f, 0.25f, 0, 1.4f, 0.9f, 0.3f, 0, 60, 0 },
  [FE_FIRELRM]     = { 0.3f, 0, 0.3f, 0, 0, 0, 0.15f, 0.5f, 0, 2, 20, 0.15f },
  [FE_HIT]         = { 0.3f, 0, 0.5f, 0.4f, 0, 0, 0.6f, 0.5f, 0.2f, 0, 30, 0 },
  [FE_SHUTDOWN]    = { 0, 0, 0, 0, 0, 0, 0, 0.6f, 0.8f, 0, 0, 0, .sag = 0.4f },
  [FE_RESTART]     = { 0.3f, 0, 0.1f, 0, 0, 0.1f, 0.3f, 0.4f, 0, 0, 20, 0, .overshoot = 0.1f },
  [FE_SECTIONLOST] = { 0.5f, 0, 0.8f, 0, 0, 0, 0.9f, 0.8f, 0.3f, 1, 50, 0 },
  [FE_DEATH]       = { 1.0f, 0, 1.5f, 0, 0, 0, 0, 1.2f, 1.0f, 0, 100, 0 },
  [FE_EXPLOSION]   = { 0, 0, 1.0f, 0, 0, 0, 0.3f, 0.9f, 0.3f, 0, 30, 0 },
  [FE_PUNCH]       = { 1.0f, 0, 0.8f, 0, 0, 0.1f, 0.5f, 1.0f, 0.5f, 2, 60, 0 },
  [FE_PUNCHED]     = { 0.4f, 0, 1.2f, 0.2f, 0, 0.15f, 1.2f, 0.8f, 0.4f, 2, 60, 0 },
  [FE_STOMP]       = { 1.2f, 0, 1.0f, 0, 0, 0.3f, 0.8f, 1.2f, 0.6f, 4, 80, 0 },
  [FE_WHIFF]       = { 0.3f, 0, 0, 0, 0, 0, 0.2f, 0, 0, 0, 0, 0 },
  [FE_BLAST]       = { 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4 },
  [FE_FUSIONFIRE]  = { 0.6f, 0, 1.2f, 0.4f, 0.7f, 0.1f, 0.8f, 1.2f, 1.0f, 0, 80, 0 },
};
const FeelView FEEL_VIEW = { 0.6f, 1.2f, 0.6f, 0.3f };
const FeelKnock FEEL_KNOCK = { 0.3f, 0.1f, 12 };
const FeelSpring FEEL_SPRING = { 160, 0.7f, 90, 0.35f, 45, 1, 200, 1 };
const FeelInertia FEEL_INERTIA = { 0.012f, 0.005f, 0.1f, 28, 0.4f, 0.6f };
const float HIT_BY_SECTION[SEC_N] = { 1, 0.7f, 0.7f, 1.2f, 1.2f };
const float HIT_STOP = 0.08f;
const HeatFeel HEAT = { 85, 100, 0.035f, 0.006f, 0.5f, 0.3f, 0.5f };
float hotFrac(float heat) { return clampf_((heat - HEAT.from) / (HEAT.to - HEAT.from)); }
const WalkDef WALK = { 2.5f, 0.75f, 0.5f, 1.15f, 0.6f, 0.35f, 0.3f };

// Blast-off jets by JUMP JETS level (0 none, 1 STOCK, 2 BOOSTED): hold to charge, let go to blast off.
const JetsDef JETS[3] = { {0},
  { 0.9f, { 14, 40 }, 14, 3, { 4, 12 }, 0.2f, 6, 0.3f, 80, 20, 4, 10, 0.5f, 8 },
  { 0.75f, { 15, 44 }, 16, 2, { 4, 12 }, 0.2f, 7, 0.3f, 90, 22, 4, 10, 0.5f, 8 } };
const JetsFlight JETS_FLIGHT = { 6, 40, 0.3f, 35, 1.1f };
const float SINK_PER_LEVEL = 2, ARMOUR_HP = 0.1f, ARMOUR_SPEED = 0.04f, KNUCKLES_MULT = 1.5f;

// Difficulty scales skill, never stats.
const Diff DIFFS[DIFF_N] = {
  [DIFF_EASY] = { "EASY", 400, 60, 1.4f, 0, 1.5f },
  [DIFF_NORMAL] = { "NORMAL", 600, 72, 1.0f, 0, 0.8f },
  [DIFF_HARD] = { "HARD", 800, 85, 0.7f, 1, 0.3f },
};
const FireDef FIRE = { 15, 0.25f, 0.3f, 1, 120, 1.9f };
const BehaviourDef BEHAVIOUR = { 60, 0.4f, 35, { 40, 80, 120 }, 2, 8, 12, 20, 15, { 80, 120, 160, 200, 240, 300 }, 4, 10,
  { 140, 200 }, 60, 1.2f, 6, 1.2f, 3, 60, 3, 150, 6 };
const PerceptionDef PERCEPTION = { 0.15f, 8, 200, 1, 2, 20, 80 };

// Each biome's palette is its native light; night and dawn bring their own sky, fog, light and shade.
#define N3(a, b, c) { a, b, c }
const PalDef PALS[PAL_N] = {
  [PAL_DUSK] = { "Dusk desert", N3(0.56f, 0.36f, 0.23f), N3(0.74f, 0.52f, 0.31f), N3(0.92f, 0.8f, 0.62f), N3(0.42f, 0.3f, 0.25f),
    { N3(0.16f, 0.1f, 0.3f), N3(0.9f, 0.56f, 0.38f), { 180, 1150 }, N3(0.4f, 0.75f, -0.5f), N3(1, 1, 1) },
    { N3(0.02f, 0.02f, 0.07f), N3(0.13f, 0.11f, 0.2f), { 110, 720 }, N3(-0.35f, 0.8f, 0.45f), N3(0.34f, 0.36f, 0.52f) },
    { N3(0.24f, 0.28f, 0.5f), N3(0.98f, 0.72f, 0.58f), { 160, 1000 }, N3(0.85f, 0.3f, 0.2f), N3(0.95f, 0.86f, 0.86f) } },
  [PAL_ICE] = { "Glacier", N3(0.58f, 0.66f, 0.75f), N3(0.8f, 0.86f, 0.92f), N3(0.98f, 0.99f, 1), N3(0.42f, 0.47f, 0.55f),
    { N3(0.08f, 0.14f, 0.32f), N3(0.66f, 0.75f, 0.86f), { 120, 900 }, N3(-0.5f, 0.7f, -0.3f), N3(1, 1, 1) },
    { N3(0.01f, 0.02f, 0.07f), N3(0.15f, 0.2f, 0.3f), { 90, 620 }, N3(0.4f, 0.85f, 0.3f), N3(0.3f, 0.36f, 0.52f) },
    { N3(0.2f, 0.24f, 0.46f), N3(0.95f, 0.76f, 0.76f), { 110, 850 }, N3(0.85f, 0.3f, -0.2f), N3(0.96f, 0.88f, 0.9f) } },
  [PAL_VOLCANIC] = { "Volcanic plain", N3(0.2f, 0.14f, 0.13f), N3(0.32f, 0.22f, 0.18f), N3(0.5f, 0.34f, 0.25f), N3(0.13f, 0.1f, 0.1f),
    { N3(0.08f, 0.02f, 0.03f), N3(0.6f, 0.22f, 0.1f), { 140, 1000 }, N3(0.3f, 0.6f, 0.6f), N3(1, 1, 1) },
    { N3(0.02f, 0.0f, 0.01f), N3(0.3f, 0.08f, 0.03f), { 100, 700 }, N3(-0.3f, 0.75f, 0.5f), N3(0.5f, 0.36f, 0.34f) },
    { N3(0.16f, 0.08f, 0.12f), N3(0.82f, 0.42f, 0.22f), { 130, 900 }, N3(0.85f, 0.35f, 0.1f), N3(0.92f, 0.8f, 0.76f) } },
  [PAL_FOREST] = { "Forest", N3(0.2f, 0.27f, 0.15f), N3(0.28f, 0.36f, 0.2f), N3(0.42f, 0.48f, 0.36f), N3(0.3f, 0.3f, 0.28f),
    { N3(0.32f, 0.38f, 0.4f), N3(0.58f, 0.64f, 0.6f), { 30, 140 }, N3(0.35f, 0.8f, -0.4f), N3(1, 1, 1) },
    { N3(0.02f, 0.03f, 0.04f), N3(0.1f, 0.13f, 0.12f), { 20, 95 }, N3(-0.3f, 0.8f, 0.45f), N3(0.32f, 0.38f, 0.46f) },
    { N3(0.24f, 0.28f, 0.36f), N3(0.8f, 0.74f, 0.62f), { 30, 125 }, N3(0.85f, 0.3f, 0.2f), N3(0.94f, 0.88f, 0.84f) } },
};
const WeatherDef WEATHER[WX_N] = {
  [WX_CLEAR] = { 1, 1, 0 },
  [WX_RAIN] = { 0.7f, 0.9f, 4, .dim = 0.8f, .lightning = 1 },
  [WX_SNOW] = { 0.5f, 0.8f, 2.5f, .whiten = 0.35f },
  [WX_DUST] = { 0.35f, 0.5f, 9, .haze = 0.6f, .tint = N3(0.78f, 0.48f, 0.26f), .push = 0.5f },
  [WX_FOG] = { 0.3f, 0.6f, 0.5f, .haze = 0.8f },
  [WX_MIST] = { 0.6f, 0.8f, 0.3f, .haze = 0.7f },
};
const float RADAR_RANGE = 800;

// Act I (the owner's names; docs/specs/04-campaign.md). Bearing 0 is straight
// ahead at the start, 90 to the right; `at` is from the map's centre.
// TOWER TOPPLER and HELPLESS LIL BUDDIES need structures and trucks (M3);
// until then they are listed but not playable.
#define FOE(t, b, d) { t, { b, d }, 1, 0, 0, 0, 0, -1 }
#define FOE_ASLEEP(t, b, d) { t, { b, d }, 1, 0, 0, 0, 1, -1 }
#define FOE_PROF(t, b, d, p) { t, { b, d }, 1, 0, 0, 0, 0, p }
const Mission MISSIONS[] = {
  { "m01", PAL_DUSK, 7, TIME_DUSK, WX_CLEAR, { -1, -1 }, 0, 2, { FOE_ASLEEP(CH_JACKAL, 20, 600), FOE_PROF(CH_JACKAL, 335, 460, PROF_BRAWLER) }, OBJ_ELIMINATE,
    "Two scouts sleep by the road. Wake them up. Knock them down.", 1 },
  { "m02", PAL_DUSK, 20, TIME_DUSK, WX_CLEAR, { -1, -1 }, 0, 2, { FOE(CH_JACKAL, 345, 700), FOE_ASLEEP(CH_JACKAL, 30, 480) }, OBJ_DESTROY,
    "Three tall towers talk and talk. Knock them down. Someone will come.", 0 },
  { "m03", PAL_DUSK, 33, TIME_DUSK, WX_CLEAR, { -1, -1 }, 0, 0, { {0} }, OBJ_ESCORT,
    "Four little trucks drive down the valley. SKEDADDLEs come to catch them. Keep two trucks safe.", 0 },
  { "m04", PAL_DUSK, 46, TIME_DUSK, WX_CLEAR, { TIME_DUSK, TIME_NIGHT }, 240, 3, { FOE(CH_WARDEN, 0, 720), FOE(CH_JACKAL, 330, 600), FOE(CH_JACKAL, 30, 640) }, OBJ_ELIMINATE,
    "One big mech walks on four legs. Two little mechs walk with it. Stomp all three.", 1 },
};
const int MISSION_N = sizeof MISSIONS / sizeof MISSIONS[0];
