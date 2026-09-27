#!/bin/bash
# usage: bl.sh script.py [args...]   (runs Blender 4.2 headless with the MPFB user dir)
S=<claude-tmp>
export BLENDER_USER_RESOURCES=$S/realism/characters/bl_user
script=$1; shift
exec timeout ${BL_TIMEOUT:-900} $S/realism/characters/blender-4.2.9-linux-x64/blender -b --python-exit-code 1 -P "$script" -- "$@"
