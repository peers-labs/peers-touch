#!/usr/bin/env bash
set -euo pipefail

: "${PT_CELL_RUN_ROOT:?PT_CELL_RUN_ROOT is required}"
: "${PT_CELL_APP_BINARY:?PT_CELL_APP_BINARY is required}"
: "${PT_CELL_RUN_ID:?PT_CELL_RUN_ID is required}"
: "${TAURI_WEBDRIVER_PORT:?TAURI_WEBDRIVER_PORT is required}"
: "${PT_GATEWAY_PORT:?PT_GATEWAY_PORT is required}"

export DISPLAY="${PT_CELL_DISPLAY:-:99}"
export XDG_RUNTIME_DIR="$PT_CELL_RUN_ROOT/runtime"
export HOME="${HOME:-$PT_CELL_RUN_ROOT/home}"
export NO_AT_BRIDGE=0

vnc_port="${PT_CELL_VNC_PORT:-5909}"
xorg_pid=""
dbus_pid=""
keyring_pid=""
openbox_pid=""
vnc_pid=""
app_pid=""

mkdir -p "$PT_CELL_RUN_ROOT" "$XDG_RUNTIME_DIR" "$HOME"
chmod 0700 "$PT_CELL_RUN_ROOT" "$XDG_RUNTIME_DIR" "$HOME"

stop_process() {
  local pid="${1:-}"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 50); do
      kill -0 "$pid" 2>/dev/null || return 0
      sleep 0.1
    done
    kill -KILL "$pid" 2>/dev/null || true
  fi
}

cleanup() {
  trap - EXIT INT TERM
  stop_process "$app_pid"
  stop_process "$vnc_pid"
  stop_process "$openbox_pid"
  stop_process "$keyring_pid"
  stop_process "$dbus_pid"
  stop_process "$xorg_pid"
  rm -f "$PT_CELL_RUN_ROOT/ready.json"
}
trap cleanup EXIT INT TERM

/usr/lib/xorg/Xorg "$DISPLAY" \
  -config /etc/X11/xorg-dummy.conf \
  -noreset \
  -nolisten tcp \
  -logfile "$PT_CELL_RUN_ROOT/xorg.log" \
  >"$PT_CELL_RUN_ROOT/xorg.stdout.log" 2>&1 &
xorg_pid=$!

for _ in $(seq 1 100); do
  xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 && break
  kill -0 "$xorg_pid" 2>/dev/null || {
    printf 'Xorg exited before display readiness\n' >&2
    exit 1
  }
  sleep 0.1
done
xdpyinfo -display "$DISPLAY" >/dev/null

dbus_state="$PT_CELL_RUN_ROOT/dbus.state"
dbus-daemon --session --fork --print-address=1 --print-pid=1 >"$dbus_state"
export DBUS_SESSION_BUS_ADDRESS
DBUS_SESSION_BUS_ADDRESS="$(sed -n '1p' "$dbus_state")"
dbus_pid="$(sed -n '2p' "$dbus_state")"

keyring_state="$PT_CELL_RUN_ROOT/keyring.state"
printf '\n' \
  | gnome-keyring-daemon --unlock --components=secrets \
    >"$keyring_state"
while IFS='=' read -r key value; do
  case "$key" in
    GNOME_KEYRING_CONTROL|SSH_AUTH_SOCK)
      value="${value%;}"
      value="${value#\'}"
      value="${value%\'}"
      export "$key=$value"
      ;;
  esac
done <"$keyring_state"
keyring_pid="$(pgrep -nf gnome-keyring-daemon || true)"
printf 'runtime-cell-keyring-probe' \
  | secret-tool store \
    --label=peers-touch-runtime-cell \
    peers-touch runtime-cell \
    >/dev/null
test "$(
  secret-tool lookup peers-touch runtime-cell
)" = "runtime-cell-keyring-probe"
secret-tool clear peers-touch runtime-cell

openbox >"$PT_CELL_RUN_ROOT/openbox.log" 2>&1 &
openbox_pid=$!
for _ in $(seq 1 100); do
  wmctrl -m >/dev/null 2>&1 && break
  kill -0 "$openbox_pid" 2>/dev/null || {
    printf 'Openbox exited before EWMH readiness\n' >&2
    exit 1
  }
  sleep 0.1
done
wmctrl -m >/dev/null

x11vnc \
  -display "$DISPLAY" \
  -localhost \
  -nopw \
  -forever \
  -shared \
  -rfbport "$vnc_port" \
  -o "$PT_CELL_RUN_ROOT/x11vnc.log" \
  >/dev/null 2>&1 &
vnc_pid=$!

"$PT_CELL_APP_BINARY" >"$PT_CELL_RUN_ROOT/app.log" 2>&1 &
app_pid=$!

for _ in $(seq 1 600); do
  if nc -z 127.0.0.1 "$TAURI_WEBDRIVER_PORT"; then
    break
  fi
  kill -0 "$app_pid" 2>/dev/null || {
    printf 'Tauri Desktop exited before WebDriver readiness\n' >&2
    exit 1
  }
  sleep 0.25
done
nc -z 127.0.0.1 "$TAURI_WEBDRIVER_PORT"
for _ in $(seq 1 100); do
  nc -z 127.0.0.1 "$vnc_port" && break
  kill -0 "$vnc_pid" 2>/dev/null || {
    printf 'x11vnc exited before observer readiness\n' >&2
    exit 1
  }
  sleep 0.1
done
nc -z 127.0.0.1 "$vnc_port"

xrandr_output="$(xrandr --query)"
grep -Eq ' connected( primary)? 1920x1080' <<<"$xrandr_output"
extensions="$(xdpyinfo -queryExtensions)"
grep -q XTEST <<<"$extensions"
xprop -root _NET_CLIENT_LIST_STACKING >/dev/null
scrot --overwrite "$PT_CELL_RUN_ROOT/desktop-probe.png"
test -s "$PT_CELL_RUN_ROOT/desktop-probe.png"

webkit_version="$(pkg-config --modversion webkit2gtk-4.1)"
jq -n \
  --arg runId "$PT_CELL_RUN_ID" \
  --arg display "$DISPLAY" \
  --arg webkitVersion "$webkit_version" \
  --argjson xorgPid "$xorg_pid" \
  --argjson dbusPid "${dbus_pid:-0}" \
  --argjson keyringPid "${keyring_pid:-0}" \
  --argjson openboxPid "$openbox_pid" \
  --argjson vncPid "$vnc_pid" \
  --argjson appPid "$app_pid" \
  --argjson webdriverPort "$TAURI_WEBDRIVER_PORT" \
  --argjson gatewayPort "$PT_GATEWAY_PORT" \
  --argjson vncPort "$vnc_port" \
  '{
    runId: $runId,
    state: "DRIVER_READY",
    display: $display,
    webkitVersion: $webkitVersion,
    processes: {
      xorg: $xorgPid,
      dbus: $dbusPid,
      keyring: $keyringPid,
      windowManager: $openboxPid,
      observer: $vncPid,
      app: $appPid
    },
    ports: {
      webdriver: $webdriverPort,
      gateway: $gatewayPort,
      observer: $vncPort
    }
  }' >"$PT_CELL_RUN_ROOT/ready.json.tmp"
mv "$PT_CELL_RUN_ROOT/ready.json.tmp" "$PT_CELL_RUN_ROOT/ready.json"

while
  kill -0 "$xorg_pid" 2>/dev/null \
    && kill -0 "$openbox_pid" 2>/dev/null \
    && kill -0 "$vnc_pid" 2>/dev/null \
    && kill -0 "$app_pid" 2>/dev/null
do
  sleep 1
done

printf 'A required Linux runtime-cell process exited\n' >&2
exit 1
