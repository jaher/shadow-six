#!/usr/bin/env bash
# All M2 cradle variants (base + mirror) x (intact, destroyed) x (temperate, snow), 4 at a time.
HERE="$(cd "$(dirname "$0")" && pwd)"
for a in fuel_tank_h_cradle fuel_tank_h_cradle_m; do
  for st in intact destroyed; do
    "$HERE/run1.sh" $a $st 11 &
    "$HERE/run1.sh" $a $st 11 snow &
  done
  wait
done
