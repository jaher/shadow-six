#!/bin/bash
# rv.sh <glb> <views> [tag]: render views with the soldier figure (theater + uniform by variant) into <dir>/review
T=<claude-tmp>
E=<repo>/assets/characters/enemies
G=$(readlink -f $1); D=$(dirname $G); N=$(basename $G .glb)
TH=temperate; FIG=$E/rifleman_v00.glb
case $N in *_dak*) TH=desert; FIG=$E/afrika_v00.glb;; *_winter*) TH=snow; FIG=$E/winter_v00.glb;; esac
timeout 150 node $T/render.mjs $G $D/review --views $2 --theater $TH --fig $FIG 2>&1 | grep -E "^loaded" | cut -c1-160
