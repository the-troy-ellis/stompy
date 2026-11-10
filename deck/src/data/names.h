// Every display name, in one place. Code uses keys; the owner names things
// after seeing them, so renaming is a change here and nowhere else.
#ifndef NAMES_H
#define NAMES_H
#include "data/data.h"
extern const char *CHASSIS_NAME[CH_N];
extern const char *WEAPON_NAME[W_N];
extern const char *CHASSIS_ROLE[CH_N];   // the menu's board-book line
extern const char *CHASSIS_KIT[CH_N];
extern const char *MISSION_NAME[];       // by index into MISSIONS
extern const char *CAT_LABEL[CAT_N];
extern const char *SECTION_NAME[SEC_N];
extern const char *DIFF_LABEL[DIFF_N];
enum { VERDICT_WON, VERDICT_UNTOUCHED, VERDICT_PUNCHED, VERDICT_LOST, VERDICT_AWKWARD, VERDICT_FLATTENED, VERDICT_N };
extern const char *VERDICT[VERDICT_N];
// The cockpit voice's pools (docs: the first line is flat, the rest are dry).
enum { VO_KILL, VO_KILLPUNCH, VO_KILLSTOMP, VO_LEGLOST, VO_ARMLOST, VO_LEGSLOST, VO_SHUTDOWN, VO_ONLINE, VO_COMPLETE, VO_FAILED, VO_INBOUND, VO_N };
#define VOICE_MAX 4
extern const char *VOICE[VO_N][VOICE_MAX];
extern const float DRY_GAP;
#endif
