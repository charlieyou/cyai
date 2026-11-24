#!/usr/bin/env bash
# Reruns one test by itself N times and counts the runs that pass, for a known-flaky-test rule.
#
# usage: rerun-alone.sh <n> <log> <pass-pattern> -- <command...>
#   <pass-pattern>  grep -E pattern that appears in the output of a passing run, e.g. for
#                   cargo nextest '1 test run: 1 passed'.
#   <command...>    runs exactly one test, with an exact-name filter and the runner's own
#                   retries turned off, so a failure is never retried into a pass, e.g.
#                   cargo nextest run --retries 0 -p <crate> -E 'test(=<full::test::path>)'
#
# Run it from the directory where <command> works in the landing worktree, with the same
# environment as the gate (such as its build directory), after the gate and other suites
# have finished, so the reruns do not share the machine with them. The log ends with
# "RERUN_DONE pass=<k>/<n>"; monitor that line. A run counts as passing only if its exit
# code is 0 and its output matches <pass-pattern>.
set -u
if [ $# -lt 5 ] || [ "$4" != "--" ] || ! [[ "$1" =~ ^[1-9][0-9]*$ ]]; then
  sed -n '2,15p' "$0"; exit 2
fi
N=$1; LOG=$2; PASS=$3; shift 4
echo "=== $(date -u +%FT%TZ) cwd=$PWD HEAD=$(git rev-parse HEAD 2>/dev/null) load=$(cut -d' ' -f1 /proc/loadavg) cmd=$*" > "$LOG"
pass=0
for i in $(seq 1 "$N"); do
  out=$("$@" 2>&1); rc=$?
  if [ $rc -eq 0 ] && echo "$out" | grep -qE -e "$PASS"; then
    pass=$((pass + 1)); echo "run $i: pass" >> "$LOG"
  else
    echo "run $i: FAIL rc=$rc" >> "$LOG"
    echo "$out" | grep -E 'panicked|assert|FAIL|error' | head -5 >> "$LOG"
  fi
done
echo "=== $(date -u +%FT%TZ) RERUN_DONE pass=$pass/$N" >> "$LOG"
