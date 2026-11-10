#include "platform/audio.h"
#include <SDL.h>
#include <string.h>
#define RATE 48000
#define MAX_OSC 40
#define MAX_NOISE 20
enum { O_SINE, O_SAW, O_SQUARE, O_TRI };
enum { F_LOW, F_BAND, F_HIGH };
typedef struct { int on, type; float f0, f1, dur, t, vol, pan, delay, phase; } Osc;
typedef struct { float b0, b1, b2, a1, a2, x1, x2, y1, y2; } Biquad;
typedef struct { int on, ftype; float f0, f1, dur, t, vol, pan, delay; Biquad bq; unsigned seed; } Noise;
typedef struct { float hum, humRate, jet, jetRate, servo, servoRate, beam, beamK, sizzle, sizzleK, fusion, fusionP, bed; } Loops;
struct Audio {
  SDL_AudioDeviceID dev; float volume;
  Osc osc[MAX_OSC]; Noise noise[MAX_NOISE];
  struct { float freq, level, env, decay, phase; } thump;
  struct { float level, t, hold, release; } duck;
  Loops want, loop;   // what the game asked for, what the callback runs
  float humPhase, humPhase2, beamPhase, beamPhase2, sizPhase, fusPhase, lfoPhase; Biquad jetLp, sizBp, beamLp, bedLp; unsigned nseed;
  v3 ear; float earYaw;
};
static float frand(unsigned *s) { *s = *s * 1664525u + 1013904223u; return (*s >> 8) / 8388608.f - 1; }
static void bqSet(Biquad *q, int type, float f, float Q) {
  f = clampf(f, 20, RATE * 0.45f); float w = TAU * f / RATE, c = cosf(w), s = sinf(w), al = s / (2 * Q), a0 = 1 + al;
  if (type == F_LOW) { q->b0 = (1 - c) / 2 / a0; q->b1 = (1 - c) / a0; q->b2 = q->b0; }
  else if (type == F_HIGH) { q->b0 = (1 + c) / 2 / a0; q->b1 = -(1 + c) / a0; q->b2 = q->b0; }
  else { q->b0 = al / a0; q->b1 = 0; q->b2 = -al / a0; }
  q->a1 = -2 * c / a0; q->a2 = (1 - al) / a0;
}
static float bqRun(Biquad *q, float x) { float y = q->b0 * x + q->b1 * q->x1 + q->b2 * q->x2 - q->a1 * q->y1 - q->a2 * q->y2; q->x2 = q->x1; q->x1 = x; q->y2 = q->y1; q->y1 = y; return y; }
static float wave(int type, float ph) {
  ph -= floorf(ph);
  switch (type) { case O_SAW: return 2 * ph - 1; case O_SQUARE: return ph < 0.5f ? 1 : -1; case O_TRI: return 4 * fabsf(ph - 0.5f) - 1; default: return sinf(ph * TAU); }
}
// The ducking curve: down at once, held, then back over the release.
static float duckGain(Audio *a) { if (a->duck.level >= 1) return 1; float t = a->duck.t; if (t < a->duck.hold) return a->duck.level; float u = (t - a->duck.hold) / a->duck.release; return u >= 1 ? 1 : lerpf(a->duck.level, 1, u); }

static void callback(void *ud, Uint8 *stream, int len) {
  Audio *a = ud; float *out = (float *)stream; int n = len / (2 * sizeof(float));
  memset(out, 0, len);
  Loops L = a->loop; float dt = 1.f / RATE;
  for (int i = 0; i < n; i++) {
    float l = 0, r = 0, loops = 0;
    for (int k = 0; k < MAX_OSC; k++) {
      Osc *o = &a->osc[k]; if (!o->on) continue;
      if (o->delay > 0) { o->delay -= dt; continue; }
      float u = o->t / o->dur, f = o->f0 * powf(o->f1 / o->f0, u), env = powf(0.0001f, u) * o->vol;
      o->phase += f * dt; float s = wave(o->type, o->phase) * env;
      l += s * (1 - maxf(0, o->pan)); r += s * (1 + minf(0, o->pan));
      if ((o->t += dt) >= o->dur) o->on = 0;
    }
    for (int k = 0; k < MAX_NOISE; k++) {
      Noise *q = &a->noise[k]; if (!q->on) continue;
      if (q->delay > 0) { q->delay -= dt; continue; }
      float u = q->t / q->dur, env = powf(0.0001f, u) * q->vol;
      if ((i & 31) == 0) bqSet(&q->bq, q->ftype, q->f0 * powf(q->f1 / q->f0, u), q->ftype == F_BAND ? 1.5f : 0.8f);
      float s = bqRun(&q->bq, frand(&q->seed)) * env * (q->ftype == F_BAND ? 2.5f : 1);
      l += s * (1 - maxf(0, q->pan)); r += s * (1 + minf(0, q->pan));
      if ((q->t += dt) >= q->dur) q->on = 0;
    }
    // The sub-bass thump: a sine with a 10 ms attack and its decay, through a soft clipper.
    if (a->thump.env > 0.0002f || a->thump.level > 0) {
      if (a->thump.level > 0) { a->thump.env = minf(a->thump.level, a->thump.env + dt / 0.01f * a->thump.level); if (a->thump.env >= a->thump.level) a->thump.level = 0; }
      else a->thump.env *= powf(0.0001f, dt / a->thump.decay);
      a->thump.phase += a->thump.freq * dt; float s = tanhf(2.2f * sinf(a->thump.phase * TAU) * a->thump.env) / tanhf(2.2f);
      l += s; r += s;
    }
    // The loops, through the duckable bus.
    a->humPhase += 55 * L.humRate * dt; a->humPhase2 += 110.4f * L.humRate * dt;
    loops += (wave(O_SINE, a->humPhase) * 0.7f + wave(O_SAW, a->humPhase2) * 0.12f) * L.hum;
    if (L.jet > 0.001f) { if ((i & 31) == 0) bqSet(&a->jetLp, F_LOW, 500 + 900 * L.jetRate, 0.8f); loops += bqRun(&a->jetLp, frand(&a->nseed)) * L.jet * 1.6f; }
    if (L.servo > 0.001f) { a->lfoPhase += 70 * L.servoRate * dt; loops += wave(O_TRI, a->lfoPhase) * L.servo * 0.5f; }
    if (L.beam > 0.001f) {   // the beam's bite: saw and square through a resonant lowpass, climbing with the melt
      float base = 150 + 170 * L.beamK; a->beamPhase += base * dt; a->beamPhase2 += base * 1.505f * dt;
      if ((i & 31) == 0) bqSet(&a->beamLp, F_LOW, 700 + 2200 * L.beamK, 4);
      loops += bqRun(&a->beamLp, wave(O_SAW, a->beamPhase) + wave(O_SQUARE, a->beamPhase2)) * L.beam * 0.5f;
    }
    if (L.sizzle > 0.001f) {   // being melted: gritty filtered noise over a low saw
      if ((i & 31) == 0) bqSet(&a->sizBp, F_BAND, 420 + 1300 * L.sizzleK, 1.6f);
      a->sizPhase += (55 + 45 * L.sizzleK) * dt;
      loops += (bqRun(&a->sizBp, frand(&a->nseed)) * 2 + wave(O_SAW, a->sizPhase) * 0.3f) * L.sizzle;
    }
    if (L.fusion > 0.001f) {   // the scan: a triangle rising with the scan, chopped by a square LFO
      a->fusPhase += (320 + 1100 * L.fusionP * L.fusionP) * dt; a->lfoPhase += (6 + 22 * L.fusionP) * dt;
      loops += wave(O_TRI, a->fusPhase) * (1 + 0.75f * wave(O_SQUARE, a->lfoPhase)) * L.fusion;
    }
    if (L.bed > 0.001f) { if ((i & 63) == 0) bqSet(&a->bedLp, F_LOW, 320, 0.7f); loops += bqRun(&a->bedLp, frand(&a->nseed)) * L.bed; }
    float dg = duckGain(a); a->duck.t += dt;
    l += loops * dg; r += loops * dg;
    out[i * 2] = tanhf(l * a->volume); out[i * 2 + 1] = tanhf(r * a->volume);
  }
}
Audio *audioInit(void) {
  Audio *a = calloc(1, sizeof *a); a->volume = 0.8f; a->duck.level = 1; a->duck.hold = 0.25f; a->duck.release = 0.4f; a->nseed = 12345; a->thump.freq = 55; a->thump.decay = 0.2f;
  for (int i = 0; i < MAX_NOISE; i++) a->noise[i].seed = 777 + i * 131;
  SDL_AudioSpec want = { 0 }, have; want.freq = RATE; want.format = AUDIO_F32SYS; want.channels = 2; want.samples = 512; want.callback = callback; want.userdata = a;
  a->dev = SDL_OpenAudioDevice(NULL, 0, &want, &have, 0);
  if (!a->dev) { fprintf(stderr, "audio: %s (silent)\n", SDL_GetError()); return a; }
  SDL_PauseAudioDevice(a->dev, 0);
  return a;
}
void audioQuit(Audio *a) { if (!a) return; if (a->dev) SDL_CloseAudioDevice(a->dev); free(a); }
void audioSetVolume(Audio *a, float v) { a->volume = v; }
void audioListener(Audio *a, v3 ear, float yaw) { a->ear = ear; a->earYaw = yaw; }
// Where a sound is, as heard from the cockpit: `ref` is how far it carries at full volume; past that
// it falls off with distance. Pans by bearing relative to where the torso faces. 0: too faint to play.
static int spatial(Audio *a, const v3 *at, float ref, float *g, float *pan) {
  if (!at) { *g = 1; *pan = 0; return 1; }
  float dx = at->x - a->ear.x, dy = at->y - a->ear.y, dz = at->z - a->ear.z, d = sqrtf(dx * dx + dy * dy + dz * dz);
  *g = d <= ref ? 1 : ref / (ref + 1.4f * (d - ref));
  if (*g < 0.02f) return 0;
  float rel = wrapA(atan2f(dx, dz) - a->earYaw);
  *pan = clampf(-sinf(rel) * minf(1, d / 10), -1, 1) * 0.85f;
  return 1;
}
static void lock(Audio *a) { if (a->dev) SDL_LockAudioDevice(a->dev); }
static void unlock(Audio *a) { if (a->dev) SDL_UnlockAudioDevice(a->dev); }
static void osc(Audio *a, int type, float f0, float f1, float dur, float vol, float g, float pan, float delay) {
  vol *= g; if (vol < 0.003f) return;
  for (int i = 0; i < MAX_OSC; i++) { Osc *o = &a->osc[i]; if (o->on) continue; *o = (Osc){ 1, type, f0, f1, dur, 0, vol, pan, delay, 0 }; return; }
}
static void noise(Audio *a, float dur, float vol, float f0, float f1, int ftype, float g, float pan, float delay) {
  vol *= g; if (vol < 0.003f) return;
  for (int i = 0; i < MAX_NOISE; i++) { Noise *q = &a->noise[i]; if (q->on) continue; unsigned s = q->seed; memset(q, 0, sizeof *q); q->on = 1; q->ftype = ftype; q->f0 = f0; q->f1 = f1; q->dur = dur; q->vol = vol; q->pan = pan; q->delay = delay; q->seed = s; bqSet(&q->bq, ftype, f0, 1); return; }
}
// The recipes (the reference's synthesis halves; its CC0 clips come later).
void audioSfx(Audio *a, int kind, const v3 *at, float p1, float p2) {
  float g, pan; float ref = kind == SFX_BOOM ? (p1 ? 90 : 40) : kind == SFX_STEP ? 12 : kind == SFX_FUSION ? 120 : kind == SFX_BONKER ? 80 : 35;
  if (!spatial(a, at, ref, &g, &pan)) return;
  lock(a);
  switch (kind) {
    case SFX_LASER: if (p1) { osc(a, O_SAW, 2400, 260, 0.2f, 0.035f, g, pan, 0); osc(a, O_SINE, 1100, 160, 0.22f, 0.035f, g, pan, 0); } else { osc(a, O_SAW, 1900, 180, 0.28f, 0.05f, g, pan, 0); osc(a, O_SINE, 900, 120, 0.3f, 0.05f, g, pan, 0); } break;
    case SFX_CANNON: osc(a, O_SINE, 110, 32, 0.32f, 0.3f, g, pan, 0); noise(a, 0.35f, 0.3f, 900, 80, F_LOW, g, pan, 0); break;   // a thunk first and a bang second
    case SFX_THUNDERCLAP: osc(a, O_SAW, 1400, 90, 0.4f, 0.22f, g, pan, 0); noise(a, 0.14f, 0.4f, 4200, 900, F_BAND, g, pan, 0); osc(a, O_SINE, 55, 30, 0.6f, 0.35f, g, pan, 0.03f); break;
    case SFX_BONKER: osc(a, O_SINE, 70, 24, 0.5f, 0.45f, g, pan, 0); osc(a, O_TRI, 920, 860, 0.35f, 0.06f, g, pan, 0); noise(a, 0.45f, 0.35f, 700, 60, F_LOW, g, pan, 0); break;
    case SFX_PEASHOOTER: noise(a, 0.05f, 0.12f, 2500, 900, F_BAND, g, pan, 0); break;
    case SFX_TOASTER: noise(a, 0.5f, 0.25f, 900, 250, F_LOW, g, pan, 0); osc(a, O_SQUARE, 180, 90, 0.06f, 0.05f, g, pan, 0); break;
    case SFX_MISSILE: noise(a, 0.7f, 0.12f, 3000, 400, F_BAND, g, pan, 0); break;
    case SFX_BOOM: if (p1) { osc(a, O_SINE, 70, 25, 1.2f, 0.4f, g, pan, 0); noise(a, 1.6f, 0.6f, 700, 40, F_LOW, g, pan, 0); } else { osc(a, O_SINE, 120, 25, 0.4f, 0.25f, g, pan, 0); noise(a, 0.6f, 0.25f, 1200, 40, F_LOW, g, pan, 0); } break;
    case SFX_CLANG: { int sec = (int)p1, arm = sec == SEC_LA || sec == SEC_RA, leg = sec == SEC_LL || sec == SEC_RL; float rate = arm ? 1.4f : leg ? 0.9f : 0.75f;   // arms ring high, legs thud, the torso is dull
      osc(a, O_SQUARE, 240 * rate, 120 * rate, 0.12f, 0.05f, g, pan, 0); noise(a, 0.15f, 0.15f, 4000, 800, F_HIGH, g, pan, 0); if (!arm) osc(a, O_SINE, leg ? 70 : 55, 30, 0.2f, 0.12f, g, pan, 0); break; }
    case SFX_STEP: { float v = p1 * (at ? 0.55f : 1), sc = p2 > 0 ? p2 : 1; osc(a, O_SINE, 72 / sc, 36, 0.16f, 0.14f * v, g, pan, 0); noise(a, 0.07f, 0.035f * v, 170, 60, F_LOW, g, pan, 0); break; }   // felt more than heard
    case SFX_LAND: osc(a, O_SINE, 62, 28, 0.32f, 0.22f * p1, g, pan, 0); noise(a, 0.14f, 0.08f * p1, 200, 50, F_LOW, g, pan, 0); break;
    case SFX_BLASTOFF: osc(a, O_SINE, 70, 20, 0.8f, 0.4f * (0.5f + p1), g, pan, 0); noise(a, 0.7f, 0.25f + 0.2f * p1, 1400, 200, F_LOW, g, pan, 0); break;
    case SFX_PUNCH: if (p1) { osc(a, O_SINE, 90, 30, 0.3f, 0.3f, g, pan, 0); noise(a, 0.2f, 0.3f, 600, 100, F_LOW, g, pan, 0); } else noise(a, 0.25f, 0.08f, 1200, 300, F_BAND, g, pan, 0); break;
    case SFX_WHINE: osc(a, O_SAW, 320, 1500, 0.26f, 0.05f, g, pan, 0); osc(a, O_SINE, 160, 900, 0.26f, 0.06f, g, pan, 0); break;
    case SFX_POWERDOWN: osc(a, O_SAW, 220, 30, 1.6f, 0.05f, g, pan, 0); break;
    case SFX_POWERUP: osc(a, O_SINE, 60, 240, 0.8f, 0.06f, g, pan, 0); break;
    case SFX_BEEP: osc(a, O_SQUARE, 1200, 1190, 0.06f, 0.03f, g, pan, 0); break;
    case SFX_LOCK: osc(a, O_SQUARE, 1500, 1500, 0.04f, 0.03f, g, pan, 0); osc(a, O_SQUARE, 2200, 2200, 0.05f, 0.03f, g, pan, 0.05f); break;
    case SFX_FUSIONCRACK: osc(a, O_SAW, 2600, 180, 0.35f, 0.12f, g, pan, 0); osc(a, O_SQUARE, 1400, 90, 0.4f, 0.05f, g, pan, 0); noise(a, 0.25f, 0.25f, 6000, 900, F_HIGH, g, pan, 0); break;
    case SFX_FUSION: osc(a, O_SAW, 2200, 50, 1.3f, 0.12f, g, pan, 0); osc(a, O_SINE, 90, 20, 1.6f, 0.5f, g, pan, 0); noise(a, 1.6f, 0.6f, 700, 40, F_LOW, g, pan, 0); break;
    default: break;
  }
  unlock(a);
}
// Heavier: lower, longer, louder (thumpParams).
void audioThump(Audio *a, float bass, float duck, const v3 *at) {
  float g, pan;
  if (bass > 0.03f && spatial(a, at, 40, &g, &pan)) {
    float b = clampf(bass * g, 0, 1.5f);
    lock(a);
    a->thump.freq = 60 - 15 * minf(1, b); a->thump.decay = 0.15f + 0.25f * minf(1, b); a->thump.level = maxf(a->thump.env, minf(1, 0.5f * b + 0.15f * b * b));
    unlock(a);
  }
  if (duck > 0.02f) { lock(a); float lvl = 1 - minf(0.95f, duck); if (lvl < duckGain(a)) { a->duck.level = lvl; a->duck.t = 0; } unlock(a); }
}
void audioFusion(Audio *a, int on, float p) { lock(a); a->want.fusion = on ? 0.04f : 0; a->want.fusionP = p; unlock(a); }
void audioChirp(Audio *a) { lock(a); osc(a, O_SQUARE, 880, 880, 0.05f, 0.02f, 1, 0, 0); osc(a, O_SQUARE, 660, 660, 0.07f, 0.02f, 1, 0, 0.06f); unlock(a); }
void audioMenuClick(Audio *a) { lock(a); osc(a, O_SINE, 90, 40, 0.12f, 0.2f, 1, 0, 0); osc(a, O_SQUARE, 700, 500, 0.04f, 0.02f, 1, 0, 0); unlock(a); }
void audioTick(Audio *a, const Game *G, int paused) {
  const Mech *P = G->player; Loops w = { 0 };
  if (P && !paused && G->state != ST_BRIEF) {
    int live = P->alive && !P->shutdown; float pace = minf(1, fabsf(P->speed) / P->maxSpeed), hot = P->shutdown ? 0 : hotFrac(P->heat);
    w.hum = P->alive ? (P->shutdown ? 0.03f : (0.07f + 0.13f * pace) * (1 + HEAT.hum * hot)) : 0; w.humRate = P->shutdown ? 0.5f : (0.72f + 0.4f * pace) * (1 + HEAT.humRate * hot);
    float charge = live ? P->jet.charge : 0; int climb = live && P->jet.blasted && P->vy > 0;
    w.jet = charge ? 0.08f + 0.2f * charge : climb ? 0.34f : G->guide.on ? 0.24f : 0; w.jetRate = charge ? 1.1f + 0.9f * charge : climb ? 0.85f : G->guide.on ? 1.7f : 0.85f;
    w.servo = live ? minf(0.13f, G->twistRate * 0.07f) : 0; w.servoRate = 0.75f + minf(0.6f, G->twistRate * 0.25f);
    float k = (beamMult(P) - 1) / (MELT_MAX - 1); w.beam = P->beaming ? 0.03f + 0.025f * k : 0; w.beamK = k;
    int onYou = P->alive && G->hasBeamOnAt && G->time - G->beamOnAt < 0.2f; w.sizzle = onYou ? 0.05f + 0.07f * meltFrac(P) : 0; w.sizzleK = meltFrac(P);
    w.bed = 0.035f;
  }
  lock(a); w.fusion = a->want.fusion; w.fusionP = a->want.fusionP;
  // Ease the loops in and out, so nothing clicks.
  Loops *L = &a->loop; float *f = (float *)L, *t = (float *)&w; for (unsigned i = 0; i < sizeof(Loops) / sizeof(float); i++) f[i] += (t[i] - f[i]) * 0.25f;
  unlock(a);
}
