#!/usr/bin/env bash
set -euo pipefail

PLATFORM="${1:-}"
if [[ "$PLATFORM" != "linux" && "$PLATFORM" != "mac" ]]; then
  echo "Uso interno: abrir-crowther-unix.sh linux|mac"
  exit 2
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
HOST="127.0.0.1"
PORT="${CROWTHER_PORT:-41731}"
APP_URL="http://$HOST:$PORT/"
LOG_FILE="${TMPDIR:-/tmp}/crowther-http-$PORT.log"

if ! command -v python3 >/dev/null 2>&1; then
  echo "No se encontró Python 3. Instálalo para iniciar Crowther en local."
  [[ "$PLATFORM" != "mac" ]] || read -r -p "Pulsa Intro para cerrar... " _
  exit 1
fi

server_is_crowther() {
  python3 -c 'import sys, urllib.request
try:
    with urllib.request.urlopen(sys.argv[1], timeout=1) as response:
        page = response.read(65536).decode("utf-8", "replace")
    sys.exit(0 if "Crowther" in page else 1)
except Exception:
    sys.exit(1)' "$APP_URL" >/dev/null 2>&1
}

port_is_open() {
  python3 -c 'import socket, sys
connection = socket.socket()
connection.settimeout(0.5)
result = connection.connect_ex((sys.argv[1], int(sys.argv[2])))
connection.close()
sys.exit(0 if result == 0 else 1)' "$HOST" "$PORT" >/dev/null 2>&1
}

open_browser() {
  if [[ "$PLATFORM" == "mac" ]]; then
    open "$APP_URL" >/dev/null 2>&1 || echo "Abre esta dirección en tu navegador: $APP_URL"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$APP_URL" >/dev/null 2>&1 &
  elif command -v gio >/dev/null 2>&1; then
    gio open "$APP_URL" >/dev/null 2>&1 &
  else
    echo "Abre esta dirección en tu navegador: $APP_URL"
  fi
}

if server_is_crowther; then
  echo "Crowther ya está en marcha: $APP_URL"
  open_browser
  exit 0
fi

if port_is_open; then
  echo "El puerto $PORT está ocupado por otro servicio. Cierra ese servicio y vuelve a intentarlo."
  [[ "$PLATFORM" != "mac" ]] || read -r -p "Pulsa Intro para cerrar... " _
  exit 1
fi

(
  cd -- "$PROJECT_DIR"
  exec nohup python3 -m http.server "$PORT" --bind "$HOST"
) >"$LOG_FILE" 2>&1 </dev/null &
SERVER_PID=$!

for attempt in {1..30}; do
  if server_is_crowther; then
    echo "Crowther está listo: $APP_URL"
    open_browser
    exit 0
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    break
  fi
  sleep 0.2
done

echo "No se pudo iniciar Crowther. Revisa el puerto $PORT y el registro $LOG_FILE."
if [[ -f "$LOG_FILE" ]]; then
  tail -n 8 "$LOG_FILE"
fi
[[ "$PLATFORM" != "mac" ]] || read -r -p "Pulsa Intro para cerrar... " _
exit 1
