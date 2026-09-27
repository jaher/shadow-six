#!/bin/bash
# queue.sh <listfile> : each line "script var seed theater budget [extra]"
cd <claude-tmp>
while read -r s v sd th b ex; do
  [ -z "$s" ] && continue
  echo "=== $s $v"; ./run.sh $s $v $sd $th $b $ex
done < $1
echo QUEUE_DONE
