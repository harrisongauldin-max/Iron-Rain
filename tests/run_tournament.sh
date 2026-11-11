#!/usr/bin/env bash
# Old vs new AI across the standard scenarios, SEEDS runs each (default 3), JOBS in parallel (default 4).
cd "$(dirname "$0")" && mkdir -p results && rm -f results/*.json
SEEDS=${SEEDS:-3}; JOBS=${JOBS:-4}
for sd in $(seq 1 "$SEEDS"); do for sc in even even-attack even-attack-far attack; do for ai in old new; do echo "$sc $ai $sd"; done; done; done |
  xargs -P "$JOBS" -L 1 sh -c 'timeout 900 python3 ai_tournament.py $0 $1 $2 2>/dev/null | grep "^{" > results/$0_$1_$2.json'
python3 ai_summary.py
