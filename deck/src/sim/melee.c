#include "sim/game.h"
// Melee: a press starts a wind-up; at the hit frame the nearest mech within
// reach and arc takes the blow and the knockback; then a recovery during
// which the mech cannot fire and turns at half rate. Miss and it whiffs.
// Knockback is scaled by the masses involved (mass = scale^3).
static const float KNOCK_MIN = 0.3f, KNOCK_MAX = 2.5f, RECOIL = 0.2f;

const MeleeDef *meleeOf(const Mech *m) {
  const MeleeDef *f = m->ch->melee;
  if (!f) return &DEFAULT_MELEE;
  if (f->fists && m->hp[SEC_LA] <= 0 && m->hp[SEC_RA] <= 0) return &DEFAULT_MELEE;
  return f;
}
// Which fist throws this punch: they take turns, skipping a lost arm.
int punchArm(Mech *m) {
  int want = m->lastArm == SEC_RA ? SEC_LA : SEC_RA, other = want == SEC_RA ? SEC_LA : SEC_RA;
  return m->hp[want] > 0 ? want : m->hp[other] > 0 ? other : -1;
}
int canPunch(const Game *G, const Mech *m) { return m->alive && !m->shutdown && !m->melee.on && !(m->meleeCd > 0) && !(m == G->player && G->guide.on); }
int meleePress(Game *G, Mech *m) {
  if (!canPunch(G, m)) return 0;
  const MeleeDef *def = meleeOf(m);
  m->melee.on = 1; m->melee.t = 0; m->melee.phase = 0; m->melee.hitMech = NULL; m->melee.arm = -1;
  if (def->fists) m->melee.arm = m->lastArm = punchArm(m);
  m->meleeCd = def->cd;
  return 1;
}
Mech *meleeTarget(Game *G, const Mech *m) {
  const MeleeDef *def = meleeOf(m); float facing = viewYaw(m), reach = def->reach * m->ch->scale;
  Mech *best = NULL; float bestD = 1e30f;
  for (int i = 0; i < G->nMechs; i++) {
    Mech *t = &G->mechs[i];
    if (t == m || !t->alive) continue;
    float dx = t->x - m->x, dz = t->z - m->z, d = hypot2(dx, dz) - t->geo->radius * t->ch->scale;
    if (d > reach || d >= bestD) continue;
    if (fabsf(wrapA(atan2f(dx, dz) - facing)) > def->arc) continue;
    best = t; bestD = d;
  }
  return best;
}
float knock(Game *G, Mech *target, Mech *attacker, float base, const float dir[2], int recoil) {
  if (!target || !(base > 0) || !dir) return 0;
  float ratio = attacker ? clampf(massOf(attacker) / massOf(target), KNOCK_MIN, KNOCK_MAX) : 1, v = base * ratio;
  if (recoil && attacker) { attacker->push[0] -= dir[0] * v * RECOIL; attacker->push[1] -= dir[1] * v * RECOIL; }
  target->push[0] += dir[0] * v; target->push[1] += dir[1] * v;
  // The aim jolts toward the blow and up; the wobble springs carry it back.
  float side = signf(dir[0] * cosf(target->yaw + target->twist) - dir[1] * sinf(target->yaw + target->twist)); if (!side) side = 1;
  float j = clampf(v / 10, 0, 1);
  target->twist = clampf(target->twist + side * FEEL_KNOCK.twist * j, -1.9f, 1.9f);
  target->pitch = clampf(target->pitch + FEEL_KNOCK.pitch * j, -0.4f, 0.45f);
  return v;
}
void meleeTick(Game *G, Mech *m, float dt) {
  if (m->meleeCd > 0) m->meleeCd = maxf(0, m->meleeCd - dt);
  if (!m->melee.on) return;
  const MeleeDef *def = meleeOf(m);
  m->melee.t += dt;
  if (m->melee.phase == 0 && m->melee.t >= def->windup) {
    m->melee.phase = 1;
    Mech *t = meleeTarget(G, m);
    if (t) {   // the blow lands on the target's skin, facing the attacker, at fist height
      float dx = t->x - m->x, dz = t->z - m->z, hd = hypot2(dx, dz); if (hd < 1e-6f) hd = 1; float nx = dx / hd, nz = dz / hd;
      float R = t->geo->radius * t->ch->scale;
      v3 p = V3(t->x - nx * R, clampf(m->y + 5 * m->ch->scale, t->y + 1, t->y + t->geo->height * t->ch->scale - 1), t->z - nz * R);
      t->lastHitMelee = 1;
      damage(G, t, p, def->dmg, m, 0, 1);
      float dir[2] = { nx, nz }, v = knock(G, t, m, def->knock, dir, 1);
      m->melee.hitMech = t; m->melee.hitP = p; m->melee.hitV = v;
      m->heat += def->heat;
      float side = signf(dx * cosf(viewYaw(t)) - dz * sinf(viewYaw(t))); if (!side) side = 1;
      feel(G, FE_PUNCH, m, 1, 0, NULL, m == G->player ? NULL : &p);
      feel(G, FE_PUNCHED, t, 1, -side, NULL, t == G->player ? NULL : &p);
      G->fx.sfx(G->fx.ud, SFX_PUNCH, m == G->player ? NULL : &p, 1, 0);
      G->farthestShove = maxf(G->farthestShove, v);
    } else {
      v3 c = centerOf(m);
      feel(G, FE_WHIFF, m, 1, 0, NULL, NULL);
      G->fx.sfx(G->fx.ud, SFX_PUNCH, m == G->player ? NULL : &c, 0, 0);
    }
  }
  if (m->melee.phase == 1 && m->melee.t >= def->windup + def->recover) m->melee.on = 0;
}
// Landing on a mech: a stomp. Called from the landing branch with how long the lander was in the air.
Mech *tryStomp(Game *G, Mech *m, float airT) {
  const MeleeDef *def = meleeOf(m);
  if (airT < def->stompAir) return NULL;
  float rm = m->geo->radius * m->ch->scale;
  for (int i = 0; i < G->nMechs; i++) {
    Mech *t = &G->mechs[i];
    if (t == m || !t->alive) continue;
    float top = t->y + t->geo->height * t->ch->scale, dx = t->x - m->x, dz = t->z - m->z, hd = hypot2(dx, dz);
    if (hd > (rm + t->geo->radius * t->ch->scale) * 1.2f || m->y < top - 1.5f || m->y > top + 1.0f) continue;
    float nx = hd > 0.01f ? dx / hd : 1, nz = hd > 0.01f ? dz / hd : 0;
    t->lastHitMelee = 2;
    const JetsDef *J = m->jets ? &JETS[m->jets] : NULL;
    int insta = J && m->jet.blasted && m->jet.top - m->y >= J->stompFall;   // down from a blast-off, from high enough: flattened
    damage(G, t, V3(t->x, top - 0.5f, t->z), insta ? 1e4f : def->stompDmg, m, 0, 1);
    if (insta && m == G->player && m->jet.lock == t) G->hitStop = 2 * HIT_STOP;
    float dir[2] = { nx, nz };
    knock(G, t, m, def->stompKnock, dir, 1);
    m->vy = 4; m->push[0] -= nx * def->stompKnock * 0.5f; m->push[1] -= nz * def->stompKnock * 0.5f;
    v3 at = V3(t->x, top, t->z);
    feel(G, FE_STOMP, m, 1, 0, NULL, m == G->player ? NULL : &at);
    feel(G, FE_PUNCHED, t, 1.2f, 0, NULL, t == G->player ? NULL : &at);
    G->fx.sfx(G->fx.ud, SFX_PUNCH, m == G->player ? NULL : &at, 1, 0);
    return t;
  }
  return NULL;
}
void meleePose(const Mech *m, float *lean, float *arm, float *lunge) {
  *lean = 0; *arm = 0; *lunge = 0;
  if (!m->melee.on) return;
  const MeleeDef *def = meleeOf(m); float t = m->melee.t;
  if (m->melee.phase == 0) { float u = minf(1, t / def->windup); *lean = 0.15f * u; *arm = -0.9f * u; return; }
  float t2 = t - def->windup, snap = t2 < 0.15f ? 1 : maxf(0, 1 - (t2 - 0.15f) / maxf(0.1f, def->recover - 0.15f));
  *lean = -0.2f * snap; *arm = 0.6f * snap; *lunge = 0.6f * snap;
}
