#!/usr/bin/env bash
set -euo pipefail

PORT=${AVALON_SMOKE_PORT:-8000}
export AVALON_PORT="$PORT"
export AVALON_BOT_MODE="heuristic"
export AVALON_DEBUG="1"

# Start server in background
python -m avalon.main >/tmp/avalon-smoke.log 2>&1 &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT

# Wait for server
for _ in {1..40}; do
  if curl -s "http://127.0.0.1:$PORT/game/state" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

python - <<'PY'
import json
import os
import urllib.request

port = os.environ.get("AVALON_PORT", "8001")
base = f"http://127.0.0.1:{port}"

def post(path, payload):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(base + path, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())

def get(path):
    with urllib.request.urlopen(base + path) as resp:
        return json.loads(resp.read().decode())

players = [
    {"id": "h1", "name": "Human 1", "is_bot": False},
    {"id": "b1", "name": "Bot 1", "is_bot": True},
    {"id": "b2", "name": "Bot 2", "is_bot": True},
    {"id": "b3", "name": "Bot 3", "is_bot": True},
    {"id": "b4", "name": "Bot 4", "is_bot": True},
]
roles = ["Merlin", "Percival", "Loyal Servant", "Assassin", "Morgana"]

new_game = post("/game/new", {"players": players, "roles": roles, "hammer_auto_approve": True, "lady_of_lake": False})
print("host_token:", bool(new_game.get("host_token")))

join = post("/game/players/join", {"name": "Tester"})
print("player_id:", join.get("player_id"))
print("token:", bool(join.get("token")))

ready = post("/game/players/ready", {"token": join.get("token"), "ready": True})
print("started:", ready.get("state", {}).get("started"))

private_state = get(f"/game/state?token={join.get('token')}")
game_url = f"{base}/game?token={join.get('token')}"
with open("/tmp/avalon-smoke-url", "w", encoding="utf-8") as handle:
    handle.write(game_url)
print("game_url:", game_url)
print("private_state:")
print(json.dumps(private_state, indent=2))
PY

GAME_URL=$(cat /tmp/avalon-smoke-url 2>/dev/null || true)
if [ -n "$GAME_URL" ]; then
  open "$GAME_URL" >/dev/null 2>&1 || true
fi
