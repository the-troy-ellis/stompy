// The whole simulation's state in one struct, plus the input it takes and the
// effects sink it talks through. No platform here: the sim runs headless.
#ifndef SIM_H
#define SIM_H
#include "util/mathx.h"
#include <stddef.h>
#include "util/rng.h"
#include "util/spring.h"
#include "data/data.h"
#include "sim/terrain.h"

#define MAX_MECHS 24
#define MAX_WEAPONS 6
#define MAX_SHOTS 256
#define MAX_PARTS 4000
#define MAX_DEBRIS 40
#define MAX_WRECKS 24
#define MAX_PULSES 8
#define MAX_CBEAMS 64
#define MAX_MSGS 4
#define MAX_SCORCH 64

typedef struct Game Game;
typedef struct Mech Mech;

enum { SFX_LASER, SFX_CANNON, SFX_THUNDERCLAP, SFX_BONKER, SFX_PEASHOOTER, SFX_TOASTER, SFX_MISSILE, SFX_BOOM, SFX_CLANG, SFX_STEP, SFX_LAND, SFX_BLASTOFF,
       SFX_PUNCH, SFX_WHINE, SFX_POWERDOWN, SFX_POWERUP, SFX_BEEP, SFX_LOCK, SFX_FUSIONCRACK, SFX_FUSION, SFX_N };
// What the sim asks the outside to do. `at` NULL means your own mech: full, centred.
typedef struct {
  void *ud;
  void (*say)(void *ud, const char *line, int force, float delayMs);
  void (*sfx)(void *ud, int kind, const v3 *at, float a, float b);
  void (*thump)(void *ud, float bass, float duck, float haptic, const v3 *at);
  void (*fusionSound)(void *ud, int on, float p);
} Fx;
extern const Fx NULL_FX;

typedef struct {
  float thr, turn, twist, pitch;     // -1..1: throttle nudge, the legs, the torso's rates
  float twistBy, pitchBy;            // radians this frame (gyro, mouse)
  int stop, centre, jets, punch, target, zoom;
  int energy, ballistic, missile, fusion, missileTap;
} Input;

typedef struct { int type; const WeaponDef *def; int mount; float cd; int ammo, dead, side; int burstLeft; float burstT; v3 burstAim; } Weapon;
typedef struct { v3 pos, from; int lifted; float yaw; } Foot;

typedef struct {
  int aware, seen, state;            // state: 0 fight, 1 search
  float strafe, strafeT, jitter, coolT, hitAt, lockT, aimPhase; int hot, hasAimPhase;
  float wp[2]; int hasWp;
  v3 beamAim;
  float bx, bz, by, bvx, bvz, bAt; int hasBelief;   // where it believes you are
  float lastSeen, lookT, reactAt, shoutAt; int shoutPending;
  int jumpOn; float jumpUntil, jumpYaw, jumpCd;
  int coverOn; float coverX, coverZ, coverSince, coverLookT, coverCd;
  int ridgeOn; float ridgeX, ridgeZ, ridgeLookT, moveOffX, moveOffZ; int hasMoveOff;
  float flippedAt, flipT; int hasFlipped;
  int shots, shotsAt;
  int profile, still;
} AI;

struct Mech {
  int type; const Chassis *ch; const Geo *geo; int team, alive, gone, idx;
  float x, y, z, vy, yaw, twist, pitch, speed, throttle, heat, fuel;
  int jetting, air, shutdown, wasAir, centring; float airT;
  float hp[SEC_N], max[SEC_N], sinkRate, maxSpeed; int jets;
  int nW; Weapon w[MAX_WEAPONS];
  // The gait (gait.c): planted feet, the distance clock, the drawn body.
  Foot feet[4]; float cyc, bob, lean, sway, hipYaw, surge, lastYaw, runK, runLean, stepAt, dig, slide; int walled;
  float pWalk, pDrop, pMean, pVault, pAhead, torsoDrop, torsoNod; int pInit, torsoInit; Spring hull, torso;
  // Beams and melt (the target's).
  float melt, meltAt, meltRate; int meltFrame, beamOn, beaming; Mech *beamMech; v3 beamEnd;
  struct { Mech *mech; float t, off; int on, slipping; v3 end; } fusion;
  struct { int on, phase, arm; float t; Mech *hitMech; v3 hitP; float hitV; } melee; float meleeCd; int lastArm, lastHitMelee;
  struct { float charge; int blasted; float top, fly[2]; Mech *lock; int on, hasAt; v3 at; float atT; Mech *atMech; float base; int hasBase; float used, away; } jet;
  float push[2]; Spring squash, wobP, wobR, sag, tiltP, tiltR; float tiltSpeed, tiltYaw; int tiltInit;
  float scramble; struct { int frame; v3 p, dir; int big; } flash;
  struct { float t; int exploded; float angle, drop, buckle, fallYaw, roll; } dying; int isDying;
  struct { int on; float angle, fallYaw, roll, drop; } fallen;
  AI ai;
};

typedef struct { int kind, type; v3 p, v; Mech *owner, *target; float dmg, life, smoke, age; int vid, guided; } Shot;
// Particles: a pool of typed arrays (spec 14), so spawning allocates nothing.
enum { PK_SMOKE, PK_FIRE, PK_SPARK, PK_DEBRIS, PK_SHOCK, PK_DUST, PK_FLAME };
typedef struct { int n; v3 p[MAX_PARTS], v[MAX_PARTS]; float life[MAX_PARTS], life0[MAX_PARTS], size[MAX_PARTS], grav[MAX_PARTS], spin[MAX_PARTS]; float col[MAX_PARTS][3]; unsigned char kind[MAX_PARTS]; } Particles;
enum { PART_ARM, PART_ULEG, PART_LLEG, PART_FOOT, PART_PLATE };
typedef struct { int part, chassis; float scale; v3 p, v, rot, spin; int landed, bounced; float t, life; } Debris;
typedef struct { float x, y, z, yaw; int chassis; float scale, t, roll; float pops[4]; int nPops; float bigPop; int hasBigPop; float settle; } Wreck;
typedef struct { v3 a, b; Mech *target, *shooter; float t, dur; int hit; float seed; } Pulse;
typedef struct { v3 a, b; float col[3], w; } CBeam;
typedef struct { char text[64]; float t; int warn; } Msg;
typedef struct { float x, z, r, y; } Scorch;

typedef struct { int shots, hits; float dealt, taken; int kills; } Stats;
enum { ST_BRIEF, ST_PLAY, ST_OVER, ST_DEBRIEF };

struct Game {
  int state, paused, won; float endT;
  int nMechs; Mech mechs[MAX_MECHS]; Mech *player;
  int nShots; Shot shots[MAX_SHOTS];
  Particles parts;
  int nDebris; Debris debris[MAX_DEBRIS];
  int nWrecks; Wreck wrecks[MAX_WRECKS];
  int nPulses; Pulse pulses[MAX_PULSES];
  int nCBeams; CBeam cbeams[MAX_CBEAMS];
  int nMsgs; Msg msgs[MAX_MSGS];
  int nScorch, scorchAt; Scorch scorch[MAX_SCORCH];
  v3 eye, view, aim; Mech *aimMech, *target; int lock, lockOn;
  float flash, shake, kick, whiteFlash, hitMark, hitStop, twistRate, lastTwist, beamOnAt; int hasBeamOnAt;
  Spring bob, bobIn; int bobInit;
  int zoom, reducedMotion;
  struct { int vid; float yaw, pitch; v3 dir, pos, nose; float lost, fuel; int n, on; } guide; int mDown; float mAt; int mVid;
  int volleySeq, lastVolley;
  float time, clock; int frame;
  Terrain ter; int biome, timeOfDay, weather; PalVariant pal; int hasRamp; PalVariant ramp0, ramp1; float rampSecs; float fogScale;
  Rng rng; Fx fx; Input input;
  int diff, kind; const Mission *def; Stats stats;
  float farthestShove; int punchReady;
  struct { int melee, shutdown, foeShutdown; } death; int lastKillMelee; int hasLastKill;
  struct { float lastDry; int used[16]; } voice;
};
#endif
