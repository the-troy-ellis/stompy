// Every sim function, by module. The renderer and HUD only read Game.
#ifndef GAME_H
#define GAME_H
#include "sim/sim.h"
#include "data/names.h"

// state.c
void gameInit(Game *G, Fx fx, unsigned seed);
Mech *newMech(Game *G, int type, int team, float x, float z, float yaw);
void startMatch(Game *G, const Mission *def, unsigned seed, int chassis, int diff, int flatGround);
void startFreePlay(Game *G, int biome, int timeOfDay, int weather, int nFoes, unsigned seed, int chassis, int diff, int flatGround);
void applyStockLoadout(Game *G, Mech *m);
void palAt(PalVariant *out, int biome, int timeOfDay);
void blendPal(const PalVariant *a, const PalVariant *b, float t, PalVariant *out);
float darkness(const PalVariant *p);
void fogOf(const Game *G, float out[2]);

// update.c
Input noInput(void);
void update(Game *G, const Input *in, float dt);

// geom.c
m4 frameOf(const Mech *m);
m4 torsoFrame(const Mech *m);
v3 centerOf(const Mech *m);
v3 muzzleOf(const Mech *m, const Weapon *w);
v3 eyeOf(const Mech *m);
static inline float viewYaw(const Mech *m) { return m->yaw + m->twist; }
float rayUpright(v3 o, v3 d, float x, float y, float z, float R, float H);
typedef struct { float t; Mech *mech; v3 point; int ok; } Hit;
Hit rayHit(Game *G, v3 o, v3 d, float maxT, const Mech *ignore);
float rayTerrainG(Game *G, v3 o, v3 d, float maxT);
int sectionHit(const Mech *m, v3 p);
v3 leadPoint(v3 from, const Mech *t, float speed);
float groundUnder(Game *G, const Mech *m, float x, float z);
int blockedLOS(Game *G, v3 a, v3 b);

// feel.c
void initFeel(Mech *m);
void stepFeel(Mech *m, float dt);
void stepBob(Game *G, float dt);
void feel(Game *G, int event, Mech *mech, float k, float roll, const float *dir, const v3 *at);
void inertiaTargets(const Mech *m, float accel, float yawRate, float *p, float *r);

// gait.c
v3 restFoot(Game *G, const Mech *m, int i, float ahead);
void initFeet(Game *G, Mech *m);
void gait(Game *G, Mech *m, float dt);
float runOf(const Mech *m, float pace);
float strideOf(const Mech *m, float pace, float sw);
float swingNow(const Mech *m, float pace);
v3 solveKnee(v3 H, v3 A, v3 pole, float l1, float l2);
static inline const Gait *gaitOf(const Mech *m) { return &GAIT[m->ch->legs]; }

// mech.c
void stepMech(Game *G, Mech *m, float dt);
float gradeFactor(float grade);
float slopeFactor(Game *G, const Mech *m);
static inline int grips(const Mech *m) { return m->ch->legs == LEG_QUAD; }

// combat.c
void damage(Game *G, Mech *m, v3 p, float amt, Mech *src, int beam, int melee);
void loseSection(Game *G, Mech *m, int sec, v3 p, Mech *src);
void destroy(Game *G, Mech *m, Mech *src);
void stepDying(Game *G, float dt);
int fire(Game *G, Mech *m, Weapon *w, v3 aim, Mech *target);
int volley(Game *G, Mech *owner, int type, v3 mz, v3 dir, Mech *target);
void stepBursts(Game *G, float dt);
void stepShots(Game *G, float dt);
void stepWrecks(Game *G, float dt);
void onShotHit(Game *G, Shot *s, Mech *t, v3 p);
extern const float DEATH_BEAT, DEATH_BUCKLE, DEATH_TOPPLE, WRECK_SETTLE, WRECK_BURN;

// beams.c
extern const float MELT_T, MELT_MAX, MELT_COOL, BEAM_CONTACT_GAP;
float meltMult(float t);
static inline float meltFrac(const Mech *m) { return minf(1, m->melt / MELT_T); }
float beamMult(const Mech *m);
void beamTick(Game *G, Mech *m, float dt, v3 aim);
void coolArmour(Game *G, float dt);
void toast(Game *G, Mech *t, float amt);

// missiles.c
extern const float HOLD_TO_GUIDE, BLAST_R;
void missileTrigger(Game *G, int down);
void startGuide(Game *G, int vid);
void steerVolley(Game *G, float dt);
void endGuide(Game *G, int detonate);
void blast(Game *G, v3 p, float dmg, Mech *owner, Mech *direct);
int fireCat(Game *G, int cat);
void cycleTarget(Game *G);

// fusion.c
void fusionTick(Game *G, Mech *m, float dt, int on);
void fusionFire(Game *G, Mech *m, Weapon *w, v3 mz, Mech *t);
void launchPulse(Game *G, v3 a, Mech *target, Mech *shooter);
void updatePulses(Game *G, float dt);

// melee.c
const MeleeDef *meleeOf(const Mech *m);
int punchArm(Mech *m);
int canPunch(const Game *G, const Mech *m);
int meleePress(Game *G, Mech *m);
Mech *meleeTarget(Game *G, const Mech *m);
void meleeTick(Game *G, Mech *m, float dt);
Mech *tryStomp(Game *G, Mech *m, float airT);
float knock(Game *G, Mech *target, Mech *attacker, float base, const float dir[2], int recoil);
static inline float massOf(const Mech *m) { return m->ch->scale * m->ch->scale * m->ch->scale; }
// The drawn pose of a swing: lean (torso pitch, +back), arm (shoulder swing, +back), lunge (m forward).
void meleePose(const Mech *m, float *lean, float *arm, float *lunge);

// jets.c
void stepJets(Game *G, Mech *m, float dt);
void blastOff(Game *G, Mech *m);
void airSteer(Game *G, Mech *m, float along, float across, float dt);
void jetLock(Game *G, Mech *m);

// effects.c
void msg(Game *G, const char *text, int warn);
void particle(Game *G, v3 p, v3 v, float life, float size, const float col[3], int kind, float grav, float spin);
void stepParticles(Game *G, float dt);
void shedPart(Game *G, Mech *m, int part, v3 p, v3 v);
void stepDebris(Game *G, float dt);
void hitSparks(Game *G, Mech *m, v3 p, int sec, float amt);
void explode(Game *G, v3 p, int big);
void scorch(Game *G, float x, float z, float r, float y);
extern const float PLATE_DMG;

// voice.c
const char *voiceLine(Game *G, int key, const char *flat);
const char *voice(Game *G, int key, const char *flat, int force, float delayMs);

// ai.c
void think(Game *G, Mech *e, float dt);
void aiInit(Game *G, Mech *e);
int aiPlanBrawler(const Mech *e);
#endif
