// The 3D view: the sky, the ground, every mech posed from its planted feet,
// the shots, beams, debris, wrecks and effects, and the cockpit camera with
// its kick, bob, shake, wobble and heat sway.
#ifndef SCENE_H
#define SCENE_H
#include "render/gl.h"
#include "sim/game.h"
typedef struct Scene Scene;
typedef struct { int on; v3 eye, at; float fov; } CamOverride;   // the menu's turntable
typedef struct { float fovDeg; int w, h; const CamOverride *cam; float menuSpin; int menuChassis; } SceneOpts;
Scene *sceneInit(void);
void sceneLoadWorld(Scene *s, const Game *G);         // after a match starts: the ground's chunks
void sceneRender(Scene *s, const Game *G, const SceneOpts *o, m4 *vpOut);
void sceneMenuMech(Scene *s, int chassis, float spin, const PalVariant *pal, int biome, int w, int h, m4 *vpOut, float yOffset);   // one mech on a patch of desert
#endif
