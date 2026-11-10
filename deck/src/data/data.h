// Every tuned number in one place, ported from the reference repo's
// src/data/ (the result of a lot of tuning: port, don't reinvent). Code uses
// the enum keys; display names live only in names.c.
#ifndef DATA_H
#define DATA_H

enum { LEG_FORWARD, LEG_REVERSE, LEG_QUAD, LEG_N };
enum { STYLE_FORWARD, STYLE_REVERSE, STYLE_QUAD, STYLE_PUNCHER, STYLE_LIGHT1, STYLE_SNIPER1, STYLE_N };
// Chassis keys are stable; names.c says what they are called (kestrel is BARRY).
enum { CH_KESTREL, CH_JACKAL, CH_WARDEN, CH_LIGHT1, CH_SNIPER1, CH_PUNCHER, CH_N };
enum { W_LASER, W_MLASER, W_PLASER, W_FLAMER, W_GAUSS, W_MG, W_AC, W_PPC, W_SRM, W_LRM, W_FUSION, W_N, W_NONE = -1 };
enum { SEC_T, SEC_LA, SEC_RA, SEC_LL, SEC_RL, SEC_N };
enum { CAT_ENERGY, CAT_BALLISTIC, CAT_MISSILE, CAT_FUSION, CAT_N };
enum { WK_BEAM, WK_SHELL, WK_MISSILE, WK_FUSION };
enum { PROF_BASELINE, PROF_HARASS, PROF_LINE, PROF_SKIRMISH, PROF_SNIPER, PROF_BRAWLER, PROF_N };
enum { DIFF_EASY, DIFF_NORMAL, DIFF_HARD, DIFF_N };
enum { PAL_DUSK, PAL_ICE, PAL_VOLCANIC, PAL_FOREST, PAL_N };
enum { TIME_DAY, TIME_DUSK, TIME_NIGHT, TIME_DAWN };
enum { WX_CLEAR, WX_RAIN, WX_SNOW, WX_DUST, WX_FOG, WX_MIST, WX_N };
enum { SFX_LASER_KIND_DEFAULT = 0, SFX_K_TOASTER, SFX_K_BONKER, SFX_K_PEASHOOTER, SFX_K_THUNDERCLAP };

typedef struct {
  const char *key; int kind, cat;
  float dps, hps;                 // beams: damage and heat per second
  float dmg, heat, cd, range, speed; int ammo, count;
  float knock, recoil;            // shells: a shove on the target, a step back for the shooter
  int burstN; float burstDt, jitter;
  int homing; float spread, lift; // missiles (spread, lift: -1 = the default)
  float meltRate, targetHeat; int cone, stutter; float scramble; int bolt;
  float col[3], w;                // the beam's colour and width
  int hasTracer; float tracer[3], tw, tl;
  float tons, fp; int sfx;        // mechlab weight, firepower score, sound recipe
  // The fusion cannon only.
  float scan, overload, scanHeat, slack, grace, assist, feedback, pulseSpeed;
} WeaponDef;

typedef struct { float hx, hz, fx, fz, ph; } LegPlan;
typedef struct {
  float hip, l1, l2, ankle; int knee;   // knee: 0 forward, 1 back, 2 out
  float swing, stride[2];
  float radius, height, legTop, torsoY, eye[3], armX, armY, rackY, acY, girth;
  int nLegs; LegPlan legs[4];
} Geo;

typedef struct {
  float cadence, runCadence, runMin, runAt, runSwing, crouch, lift[2], liftEarly, slam, drop, surge, bounce, sway, hipTurn, runLean, runDrop, plantBack[2];
  float knee, runKnee, kneeFast, vault, sink, bodyK, bodyZeta, speedUp, lag, nod;
} Gait;

typedef struct { float dmg, reach, arc, windup, recover, cd, heat, knock, stompDmg, stompKnock, stompAir; int fists; } MeleeDef;

typedef struct { const char *id; int loc, cat, stock; } Hardpoint;
typedef struct {
  const char *key; int legs, style;
  float speed, turn, sink, scale, pref, acc0; int profile;
  float hp[SEC_N]; float col[3], acc[3];
  float tons, frame; int sinks, armour, jets; int jetsMax;
  int nHard; Hardpoint hard[4];
  const MeleeDef *melee;
  Geo geoOver;                    // partial override of the leg type's plan (0: unset)
  int unlock;
} Chassis;

// The feel table (docs/specs/13-thunk.md): a row per event.
enum { FE_STEP, FE_NEARSTEP, FE_BLASTOFF, FE_LAND, FE_FIREAC, FE_FIREGAUSS, FE_FIREMG, FE_FIREBOLT, FE_BOLT, FE_FIRELRM, FE_HIT, FE_SHUTDOWN, FE_RESTART,
       FE_SECTIONLOST, FE_DEATH, FE_EXPLOSION, FE_PUNCH, FE_PUNCHED, FE_STOMP, FE_WHIFF, FE_BLAST, FE_FUSIONFIRE, FE_N };
typedef struct { float kick, bob, shake, flash, white, squash, wobble, bass, duck, dust, haptic, push, sag, overshoot; } FeelRow;
typedef struct { float wobble, shakeMax, flashMax, reducedScale; } FeelView;
typedef struct { float twist, pitch, skidDust; } FeelKnock;
typedef struct { float squashK, squashZeta, wobbleK, wobbleZeta, sagK, sagZeta, bobK, bobZeta; } FeelSpring;
typedef struct { float pitch, roll, max, k, zeta, view; } FeelInertia;

typedef struct { float from, to, fov, sway, hum, humRate, flicker; } HeatFeel;
typedef struct { float slopeUp, slopeDown, slopeMin, slopeMax, digCut, digHold, digSlow; } WalkDef;

typedef struct { float charge, vy[2], fwd, recharge, heat[2], tap, steer, tilt, reach, aimFwd, assist, assistMax, letGo, stompFall; } JetsDef;
typedef struct { float steerOver, tiltAt, cone, escape, lockTilt; } JetsFlight;

typedef struct { const char *label; float sight, heatCap, aimErr; int sections; float react; } Diff;
typedef struct { float coolBelow, alphaTorso, lockFace, lockFor, lrmMin, armOffset; } FireDef;
typedef struct {
  float coverHeat, coverTorso, coverLeave, coverDists[3]; float coverEvery, coverArrive, coverMaxWait, coverRetry;
  float ridgeAbove, ridgeRadii[6], ridgeEvery, ridgeArrive;
  float harassBand[2], jumpWithin, jumpFor, jumpCooldown, hitFlipEvery, relocateAfter, relocateAway, stompOver, lineRange, allyGap;
} BehaviourDef;
typedef struct { float lookEvery, lostAfter, shoutRange, shoutDelay, extrapolate, searchFor, searchRadius; } PerceptionDef;
typedef struct { float chance[DIFF_N], keepOut; } AiPunch;

typedef struct { float zen[3], hor[3], fog[2], light[3], shade[3]; } PalVariant;
typedef struct { const char *name; float low[3], mid[3], high[3], rock[3]; PalVariant day, night, dawn; } PalDef;
typedef struct { float fog, radar, wind; float dim, whiten, haze, tint[3], push; int lightning; } WeatherDef;

// A mission's foe: a chassis placed by polar [bearing degrees, distance] from the map's centre.
typedef struct { int type; float at[2]; int placed; float face; int hasFace; int aware; int hasAware; int profile; } Foe;
enum { OBJ_ELIMINATE, OBJ_DESTROY, OBJ_ESCORT, OBJ_SURVIVE, OBJ_EXTRACT };
typedef struct { const char *key; int pal, seed, time, weather; int ramp[2]; float rampSecs; int nFoes; Foe foes[8]; int objective; const char *intel; int playable; } Mission;

extern const WeaponDef WEAPONS[W_N];
extern const Chassis CHASSIS[CH_N];
extern const int MECH_ORDER[CH_N];
extern const Geo GEO[LEG_N];
extern const Gait GAIT[LEG_N];
extern const MeleeDef DEFAULT_MELEE, FIST_MELEE;
extern const AiPunch AI_PUNCH;
extern const FeelRow FEEL[FE_N];
extern const FeelView FEEL_VIEW; extern const FeelKnock FEEL_KNOCK; extern const FeelSpring FEEL_SPRING; extern const FeelInertia FEEL_INERTIA;
extern const float HIT_BY_SECTION[SEC_N]; extern const float HIT_STOP;
extern const HeatFeel HEAT; extern const WalkDef WALK;
extern const JetsDef JETS[3]; extern const JetsFlight JETS_FLIGHT;
extern const Diff DIFFS[DIFF_N]; extern const FireDef FIRE; extern const BehaviourDef BEHAVIOUR; extern const PerceptionDef PERCEPTION;
extern const PalDef PALS[PAL_N]; extern const WeatherDef WEATHER[WX_N]; extern const float RADAR_RANGE;
extern const Mission MISSIONS[]; extern const int MISSION_N;
extern const float SINK_PER_LEVEL, ARMOUR_HP, ARMOUR_SPEED, KNUCKLES_MULT;

// The body plan of a chassis: its leg type's, with its own partial merged over it (geoFor).
void dataInit(void);
const Geo *geoFor(int chassis);
float hotFrac(float heat);
#endif
