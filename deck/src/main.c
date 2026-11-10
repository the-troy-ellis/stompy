// Stompy for the Steam Deck. `stompy --window` runs in a window; `--free` jumps
// straight into Free Play; `--shot N file.ppm` saves frame N and exits; `--skip S` runs the sim S seconds
// before the first frame and `--demo` flies the mech itself (the tools' screenshots).
#include "game/app.h"
#include <stdlib.h>
#include <string.h>
int main(int argc, char **argv) {
  AppArgs a = { 1280, 800, -1, 0, 0, NULL, 0, 0, 0, NULL, 0, -1 };
  for (int i = 1; i < argc; i++) {
    if (!strcmp(argv[i], "--window")) a.fullscreen = 0;
    else if (!strcmp(argv[i], "--fullscreen")) a.fullscreen = 1;
    else if (!strcmp(argv[i], "--free")) a.autoFree = 1;
    else if (!strcmp(argv[i], "--seed") && i + 1 < argc) a.seed = atoi(argv[++i]);
    else if (!strcmp(argv[i], "--shot") && i + 2 < argc) { a.shotFrames = atoi(argv[++i]); a.shotPath = argv[++i]; }
    else if (!strcmp(argv[i], "--skip") && i + 1 < argc) a.skip = (float)atof(argv[++i]);
    else if (!strcmp(argv[i], "--demo")) a.demo = 1;
    else if (!strcmp(argv[i], "--debug")) a.debug = 1;
    else if (!strcmp(argv[i], "--mech") && i + 1 < argc) a.mech = atoi(argv[++i]);
    else if (!strcmp(argv[i], "--screen") && i + 1 < argc) a.screen = argv[++i];
    else if (!strcmp(argv[i], "--size") && i + 2 < argc) { a.w = atoi(argv[++i]); a.h = atoi(argv[++i]); }
  }
  return appRun(&a);
}
