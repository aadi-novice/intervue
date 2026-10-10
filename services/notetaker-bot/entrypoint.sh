#!/usr/bin/env bash
# Starts PulseAudio (null sink), then runs the bot under Xvfb. BOT_MODE=single|pool
set -euo pipefail

SINK="${PULSE_SINK:-intervue_sink}"
MODE="${BOT_MODE:-single}"

case "$MODE" in
  single) ENTRY="dist/main.js" ;;
  pool)   ENTRY="dist/pool.js" ;;
  *) echo "{\"level\":\"fatal\",\"msg\":\"invalid BOT_MODE '$MODE' (expected single|pool)\"}" >&2; exit 2 ;;
esac

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/runtime}"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

pulseaudio -D --exit-idle-time=-1 --disallow-exit --log-target=stderr
for _ in $(seq 1 50); do
  pactl info >/dev/null 2>&1 && break
  sleep 0.1
done
pactl load-module module-null-sink sink_name="$SINK" sink_properties=device.description="$SINK" >/dev/null
pactl set-default-sink "$SINK"
pactl set-default-source "${SINK}.monitor" || true

cd /app
# No `exec`: xvfb-run must stay the parent so it can clean up Xvfb. dumb-init forwards SIGTERM to us.
# xvfb-run (a shell script) would not relay SIGTERM to node while waiting on it, so signal node directly;
# the app then leaves the meeting, uploads the manifest and exits, and xvfb-run cleans up Xvfb.
trap 'pkill -TERM -f "node ${ENTRY}" 2>/dev/null || true' TERM INT
xvfb-run -a --server-args="-screen 0 1280x720x24" node "$ENTRY" &
child=$!
code=0
wait "$child" || code=$?
# A trapped signal interrupts the first wait; wait again for the real exit status.
if kill -0 "$child" 2>/dev/null; then wait "$child" || code=$?; fi
exit "$code"
