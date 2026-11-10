#!/bin/sh
# A screenshot of the game under a virtual screen with software GL, for a machine with no display:
#   tools/shot.sh out.png [frames] [extra args...]      e.g. tools/shot.sh free.png 300 --free --seed 7
out=$1; frames=${2:-120}; shift 2 2>/dev/null
SDL_AUDIODRIVER=dummy xvfb-run -a -s "-screen 0 1280x800x24" ./build/stompy --window --shot "$frames" /tmp/stompy-shot.ppm "$@" >/dev/null 2>&1
python3 -c "from PIL import Image; Image.open('/tmp/stompy-shot.ppm').save('$out')" 2>/dev/null || cp /tmp/stompy-shot.ppm "${out%.png}.ppm"
echo "$out"
