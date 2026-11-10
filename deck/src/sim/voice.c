#include "sim/game.h"
// The cockpit voice: a pool per event, a seeded pick, no dry line twice in a
// mission, at most one dry line a minute. `flat` replaces the pool's flat line.
const char *voiceLine(Game *G, int key, const char *flat) {
  const char **pool = VOICE[key];
  if (!pool[0]) return NULL;
  const char *base = flat ? flat : pool[0];
  int fresh[VOICE_MAX], nf = 0;
  for (int i = 1; i < VOICE_MAX && pool[i]; i++) if (!(G->voice.used[key] & (1 << i))) fresh[nf++] = i;
  if (!nf || G->time - G->voice.lastDry < DRY_GAP) return base;
  int pick = rngInt(&G->rng, nf + 1);   // the flat line is in the draw too, so dry lines are a treat
  if (pick == nf) return base;
  G->voice.used[key] |= 1 << fresh[pick]; G->voice.lastDry = G->time;
  return pool[fresh[pick]];
}
const char *voice(Game *G, int key, const char *flat, int force, float delayMs) {
  const char *line = voiceLine(G, key, flat);
  if (line) G->fx.say(G->fx.ud, line, force, delayMs);
  return line;
}
