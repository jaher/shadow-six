#!/bin/bash
# q.sh listfile [P]  -> runs "script var seed [snow]" lines through run.sh, P at a time; log to listfile.log
D=<claude-tmp>
cd $D && xargs -P ${2:-3} -L 1 ./run.sh < $1 >> $1.log 2>&1
echo QDONE >> $1.log
