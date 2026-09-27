#!/bin/bash
# Rebuild every armour asset (two parallel chains). Logs in scripts/logs.
cd "$(dirname "$0")"
( ./run.sh mg_nest.py ring; ./run.sh pz4.py g; ./run.sh pz4.py f2; ./run.sh pz3.py l; ./run.sh sdkfz231.py; ./run.sh mg_tripod.py mg42; ./run.sh flak88.py noshield ) &
( ./run.sh mg_nest.py horseshoe; ./run.sh pz3.py j; ./run.sh pz2.py; ./run.sh sdkfz251.py; ./run.sh flak88.py; ./run.sh morser18.py; ./run.sh mg_tripod.py mg34 ) &
wait
echo ALLDONE > logs/rebuild_all.done
