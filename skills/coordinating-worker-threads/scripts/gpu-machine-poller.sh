#!/bin/bash
# Polls RunPod and DigitalOcean for GPU capacity and creates exactly one machine, from
# whichever provider has capacity first, then exits. Run it in the background with its
# output in a log, and monitor the log from its first line for 'GRAB' (every exit line):
#   GRABBED provider=digitalocean size=<size> <id> <ip> <region>
#   GRABBED provider=runpod pod=<id or create output>
#   GRAB_UNKNOWN ...      a create ended in something other than success or a known capacity
#                         refusal, so a machine may exist; list both providers by hand
#   GRAB_ABORT ...        a machine named NAME already exists, or another poller is running
#   GRAB_TIMEOUT          GRAB_MAX_SECONDS passed with no capacity
#   GRAB_CONFIG_ERROR ... a setting is missing or invalid, or a provider CLI does not work
#
# The one safety rule: the poller continues only after a create that the provider refused
# for capacity (RP_REFUSAL / DO_REFUSAL). Any other failed create stops it, so it can never
# make a second machine after a create whose outcome it does not know.
#
# Settings (environment):
#   NAME              machine name, also the DigitalOcean tag (default gpu-worker); use one
#                     name per effort, because the existence check matches only this name
#   PROVIDERS         "runpod do", "runpod" or "do" (default "runpod do"); RunPod is tried first
#   GRAB_MAX_SECONDS  how long to poll (default 10800)
#   POLL_SECONDS      pause between rounds (default 30)
#   DO_SIZES          DigitalOcean size slugs in order of preference, required for "do",
#                     e.g. "gpu-mi300x1-192gb gpu-mi325x1-256gb"
#   DO_REGIONS        regions to try (default: a list of 16 regions below)
#   DO_IMAGE          droplet image (default gpu-amd-base)
#   DO_SSH_KEYS       DigitalOcean SSH key IDs or fingerprints, comma-separated, required for "do"
#   DO_REFUSAL        grep -E pattern of a capacity refusal
#                     (default 'Size is not available in this region')
#   RP_GPU            RunPod GPU type ID, required for "runpod", e.g. "AMD Instinct MI300X OAM"
#   RP_IMAGE          container image, required for "runpod"
#   RP_DISK_GB        container disk (default 80)
#   RP_REFUSAL        grep -E pattern of a capacity refusal
#                     (default 'no longer any instances available')
#   RP_START_FILE     the pod's start command as one line with no single quotes (default:
#                     runpod-pod-start.sh next to this script, which installs sshd with the
#                     account's key and keeps the pod up)
#   RP_COMPUTE=cpu    test only: create a CPU pod instead of a GPU pod (needs RP_DISK_GB <= 30)
#
# Only one poller per NAME runs at a time (it holds /tmp/gpu-machine-poller-NAME.lock). It
# never deletes anything: delete the machine yourself once its logs are copied and checked.
set -u
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then sed -n '2,41p' "$0"; exit 0; fi
# Every exit prints a GRAB line, even an unexpected one, so a monitor on GRAB always fires.
ended=
trap '[ -n "$ended" ] || echo "$(date -u +%H:%M:%S) GRAB_UNKNOWN the poller stopped unexpectedly"' EXIT
for v in GRAB_MAX_SECONDS POLL_SECONDS RP_DISK_GB; do
  [[ "${!v:-1}" =~ ^[1-9][0-9]*$ ]] || { ended=1; echo "$(date -u +%H:%M:%S) GRAB_CONFIG_ERROR $v must be a whole number of seconds or GB"; exit 2; }
done
HERE=$(cd "$(dirname "$0")" && pwd)
PROVIDERS=${PROVIDERS:-runpod do}
NAME=${NAME:-gpu-worker}
DEADLINE=$(( $(date +%s) + ${GRAB_MAX_SECONDS:-10800} ))
DO_REFUSAL=${DO_REFUSAL:-Size is not available in this region}
RP_REFUSAL=${RP_REFUSAL:-no longer any instances available}

read -r -a DO_SIZES <<< "${DO_SIZES:-}"
read -r -a DO_REGIONS <<< "${DO_REGIONS:-atl1 nyc2 tor1 ric1 mkc1 mem1 nyc1 nyc3 sfo2 sfo3 ams3 fra1 lon1 sgp1 syd1 blr1}"
DO_IMAGE=${DO_IMAGE:-gpu-amd-base}

now() { date -u +%H:%M:%S; }
has() { case " $PROVIDERS " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }
die() { ended=1; echo "$(now) GRAB_CONFIG_ERROR $*"; exit 2; }
unknown() { ended=1; echo "$(now) GRAB_UNKNOWN $*; check doctl compute droplet list and runpodctl pod list --all"; exit 3; }
oneline() { echo "$1" | tr '\n' ' ' | sed -E 's/ +/ /g' | cut -c1-300; }

read -r -a P <<< "$PROVIDERS"
[ ${#P[@]} -gt 0 ] || die "PROVIDERS is empty"
for p in "${P[@]}"; do
  case $p in runpod | do) ;; *) die "unknown provider '$p' in PROVIDERS (use runpod and/or do)" ;; esac
done
[[ "$NAME" =~ ^[A-Za-z0-9._-]+$ ]] || die "NAME may contain only letters, digits, '.', '_' and '-'"
if has do; then
  [ ${#DO_SIZES[@]} -gt 0 ] || die "DO_SIZES is empty"
  [ -n "${DO_SSH_KEYS:-}" ] || die "DO_SSH_KEYS is empty"
fi
if has runpod; then
  RP_START_FILE=${RP_START_FILE:-$HERE/runpod-pod-start.sh}
  [ -r "$RP_START_FILE" ] || die "cannot read RP_START_FILE $RP_START_FILE"
  [ "$(grep -c . "$RP_START_FILE")" -eq 1 ] || die "RP_START_FILE must hold exactly one non-empty line"
  ! grep -q -e "'" -e $'\r' "$RP_START_FILE" || die "RP_START_FILE must not contain single quotes or carriage returns"
  [ -n "${RP_IMAGE:-}" ] || die "RP_IMAGE is empty"
  RP_START=$(tr -d '\n' < "$RP_START_FILE")
  if [ "${RP_COMPUTE:-}" = cpu ]; then
    RP_TARGET=(--compute-type cpu)
  else
    [ -n "${RP_GPU:-}" ] || die "RP_GPU is empty"
    RP_TARGET=(--gpu-id "$RP_GPU")
  fi
fi

# Prints the first droplet tagged $NAME, or nothing. Returns 1 when the list call fails.
do_existing() {
  local out
  out=$(doctl compute droplet list --tag-name "$NAME" --format ID,PublicIPv4,Region --no-header 2>&1) || { echo "$out"; return 1; }
  echo "$out" | head -1
}

# Prints the ID of the pod named $NAME, or nothing. Returns 1 when the list call fails.
runpod_existing() {
  local out
  out=$(runpodctl pod list --all 2>&1) || { echo "$out"; return 1; }
  NAME="$NAME" python3 -c '
import json, os, sys
pods = json.load(sys.stdin)
print(next((p["id"] for p in pods if p.get("name") == os.environ["NAME"]), ""))
' <<< "$out" 2>&1
}

# A provider's list is checked when the provider is used or its CLI is installed, so a
# machine made through either provider is seen even when that provider is not polled.
CHECK=()
if has do || command -v doctl > /dev/null; then CHECK+=(do); fi
if has runpod || command -v runpodctl > /dev/null; then CHECK+=(runpod); fi
for p in "${CHECK[@]}"; do
  out=$("${p}_existing") || die "the $p list call failed, fix the CLI or its login first: $(oneline "$out")"
done

exec 9> "/tmp/gpu-machine-poller-$NAME.lock"
flock -n 9 || { ended=1; echo "$(now) GRAB_ABORT another poller for $NAME is running"; exit 0; }

declare -A seen
# Logs each distinct refusal once, so the log stays short.
refused() {
  local key="$1|$(oneline "$2" | sed -E 's/request [0-9a-f-]{36}//')"
  if [ -z "${seen[$key]:-}" ]; then
    seen[$key]=1
    echo "$(now) $1 refused: $(oneline "$2")"
  fi
}

runpod_try() {
  local out
  if out=$(runpodctl pod create --name "$NAME" "${RP_TARGET[@]}" --image "$RP_IMAGE" \
    --container-disk-in-gb "${RP_DISK_GB:-80}" --ports 22/tcp --docker-args "bash -c '$RP_START'" 2>&1); then
    local id; id=$(runpod_existing) || id="(list failed; see create output)"
    ended=1; echo "$(now) GRABBED provider=runpod pod=$(oneline "$id") create_output: $(oneline "$out")"
    exit 0
  fi
  echo "$out" | grep -qE -e "$RP_REFUSAL" || unknown "runpod create failed without a capacity refusal: $(oneline "$out")"
  refused "runpod ${RP_TARGET[*]}" "$out"
}

do_try() {
  local size r out
  for size in "${DO_SIZES[@]}"; do
    for r in "${DO_REGIONS[@]}"; do
      if out=$(doctl compute droplet create "$NAME" --size "$size" --image "$DO_IMAGE" --region "$r" \
        --ssh-keys "$DO_SSH_KEYS" --tag-names "$NAME" --wait --format ID,PublicIPv4,Region,Status --no-header 2>&1); then
        ended=1; echo "$(now) GRABBED provider=digitalocean size=$size $out"
        exit 0
      fi
      echo "$out" | grep -qE -e "$DO_REFUSAL" || unknown "digitalocean create of $size in $r failed without a capacity refusal: $(oneline "$out")"
      refused "digitalocean $size in $r" "$out"
    done
  done
}

echo "$(now) poller start: providers=[${P[*]}] name=$NAME lists checked=[${CHECK[*]}]"
n=0
failed_rounds=0
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  n=$((n + 1))
  listed=1
  for p in "${CHECK[@]}"; do
    if ! out=$("${p}_existing"); then
      refused "$p list" "$out (creating nothing this round)"; listed=0
    elif [ -n "$out" ]; then
      ended=1; echo "$(now) GRAB_ABORT $p machine $out already exists"; exit 0
    fi
  done
  if [ $listed -eq 0 ]; then
    failed_rounds=$((failed_rounds + 1))
    [ $failed_rounds -lt 10 ] || unknown "a provider list failed 10 rounds in a row"
  else
    failed_rounds=0
    if has runpod; then runpod_try; fi
    if has do; then do_try; fi
    [ $((n % 10)) -eq 1 ] && echo "$(now) poll $n: no capacity (providers: ${P[*]})"
  fi
  sleep "${POLL_SECONDS:-30}"
done
ended=1; echo "$(now) GRAB_TIMEOUT"
