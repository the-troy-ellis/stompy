#include "data/names.h"
// Every one the owner's, confirmed.
const char *CHASSIS_NAME[CH_N] = { [CH_KESTREL] = "BARRY", [CH_JACKAL] = "SKEDADDLE", [CH_WARDEN] = "SLOWPOKE", [CH_PUNCHER] = "PURPLE PUNCHER", [CH_LIGHT1] = "BIG TROUBLE", [CH_SNIPER1] = "LONG LARRY" };
const char *WEAPON_NAME[W_N] = { [W_LASER] = "BIG ZAPPER", [W_MLASER] = "LIL ZAPPER", [W_AC] = "BIG BOOMER", [W_LRM] = "ANGRY BEES", [W_FUSION] = "OOPS BUTTON", [W_PPC] = "ANGRY ZAPPER",
  [W_PLASER] = "BLINKY", [W_SRM] = "FIRECRACKERS", [W_GAUSS] = "BIG BONKER", [W_MG] = "RATATAT", [W_FLAMER] = "TOASTER" };
// What the menu says about each one, in the board-book voice.
const char *CHASSIS_ROLE[CH_N] = { [CH_KESTREL] = "IT DOES A LITTLE OF EVERYTHING.", [CH_JACKAL] = "IT RUNS FAST. IT BREAKS FAST.", [CH_WARDEN] = "FOUR LEGS. SLOW. DOES NOT STOP.",
  [CH_PUNCHER] = "IT PUNCHES.", [CH_LIGHT1] = "IT IS SMALL. IT IS RUDE.", [CH_SNIPER1] = "LONG LEGS. LONG GUN." };
const char *CHASSIS_KIT[CH_N] = { [CH_KESTREL] = "2x BIG ZAPPER - BIG BOOMER - ANGRY BEES - OOPS BUTTON", [CH_JACKAL] = "2x LIL ZAPPER - OOPS BUTTON",
  [CH_WARDEN] = "BIG ZAPPER - BIG BOOMER - ANGRY BEES - OOPS BUTTON", [CH_PUNCHER] = "BIG BOOMER - FIRECRACKERS - OOPS BUTTON - FISTS",
  [CH_LIGHT1] = "FIRECRACKERS - LIL ZAPPER - RATATAT - OOPS BUTTON", [CH_SNIPER1] = "BIG BONKER - ANGRY ZAPPER - LIL ZAPPER - OOPS BUTTON" };
const char *MISSION_NAME[] = { "LIL SNOOZERS", "TOWER TOPPLER", "HELPLESS LIL BUDDIES", "FOUR LEGS BAD" };
const char *CAT_LABEL[CAT_N] = { "ENERGY", "BALLISTIC", "MISSILE", "FUSION" };
const char *SECTION_NAME[SEC_N] = { "Torso", "Left arm", "Right arm", "Left leg", "Right leg" };
const char *DIFF_LABEL[DIFF_N] = { "EASY", "NORMAL", "HARD" };
// The debrief's one word: drafts until the owner picks.
const char *VERDICT[VERDICT_N] = { "STOMPED.", "UNTOUCHED.", "PUNCHED.", "SQUASHED.", "AWKWARD.", "FLATTENED." };
const char *VOICE[VO_N][VOICE_MAX] = {
  [VO_KILL] = { "Target destroyed.", "Target stomped.", "That one is done." },
  [VO_KILLPUNCH] = { "Target punched.", "Fist contact confirmed." },
  [VO_KILLSTOMP] = { "Target stomped.", "Target stomped. Literally." },
  [VO_LEGLOST] = { "Leg destroyed.", "Leg destroyed. Recommend hopping.", "Leg destroyed. Speed is now optional." },
  [VO_ARMLOST] = { "Arm destroyed.", "Arm destroyed. We have another." },
  [VO_LEGSLOST] = { "Legs destroyed.", "Legs destroyed. We are now a turret." },
  [VO_SHUTDOWN] = { "Reactor shutdown.", "Reactor shutdown. Please hold." },
  [VO_ONLINE] = { "Reactor online.", "Reactor online. Carry on." },
  [VO_COMPLETE] = { "Mission complete.", "Mission complete. Good stomping." },
  [VO_FAILED] = { "Mission failed." },
  [VO_INBOUND] = { "Reinforcements inbound." },
};
const float DRY_GAP = 60;
