const api = (path, options = {}) => fetch(path, options).then(async (res) => {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
});

const $ = (id) => document.getElementById(id);
const phaseValueEl = $("phaseValue");
const seatCountEl = $("seatCount");
const playerListEl = $("playerList");
const playerNameInput = $("playerNameInput");
const joinBtn = $("joinBtn");
const readyBtn = $("readyBtn");
const lobbyHintEl = $("lobbyHint");
const seatInfoEl = $("seatInfo");
const hostControlsEl = $("hostControls");
const hostSlotListEl = $("hostSlotList");
const hostAddHuman = $("hostAddHuman");
const hostRemoveHuman = $("hostRemoveHuman");

const isHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
let playerId = localStorage.getItem("avalon_player_id") || "";
let startRequested = false;

function renderPlayers(players) {
  playerListEl.innerHTML = "";
  players.filter((p) => !p.is_bot).forEach((player) => {
    const row = document.createElement("div");
    row.className = "slot-row";
    const tag = document.createElement("span");
    tag.className = "slot-tag";
    tag.textContent = player.ready ? "Ready" : player.claimed ? "Joined" : "Open";
    const name = document.createElement("div");
    name.textContent = player.name;
    row.appendChild(tag);
    row.appendChild(name);
    playerListEl.appendChild(row);
  });
}

function renderHostSlots(players) {
  hostSlotListEl.innerHTML = "";
  players
    .filter((p) => !p.is_bot)
    .forEach((player) => {
      const row = document.createElement("div");
      row.className = "slot-row";
      const tag = document.createElement("span");
      tag.className = "slot-tag";
      tag.textContent = player.ready ? "Ready" : player.claimed ? "Joined" : "Open";
      const nameInput = document.createElement("input");
      nameInput.value = player.name;
      const saveBtn = document.createElement("button");
      saveBtn.className = "ghost";
      saveBtn.textContent = "Rename";
      saveBtn.addEventListener("click", async () => {
        await api("/game/players/rename", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ player_id: player.id, name: nameInput.value.trim() || player.name }),
        });
        await refresh();
      });
      const kickBtn = document.createElement("button");
      kickBtn.className = "ghost";
      kickBtn.textContent = "Kick";
      kickBtn.addEventListener("click", async () => {
        await api("/game/players/reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ player_id: player.id }),
        });
        await refresh();
      });
      row.appendChild(tag);
      row.appendChild(nameInput);
      row.appendChild(saveBtn);
      row.appendChild(kickBtn);
      hostSlotListEl.appendChild(row);
    });
}

async function joinGame() {
  const name = playerNameInput.value.trim();
  if (!name) {
    lobbyHintEl.textContent = "Enter your name first.";
    return;
  }
  try {
    const result = await api("/game/players/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    playerId = result.player_id;
    localStorage.setItem("avalon_player_id", playerId);
    seatInfoEl.textContent = `Seat claimed as ${name}.`;
    lobbyHintEl.textContent = "Seat claimed. Click Ready when you're set.";
    await refresh();
  } catch (err) {
    lobbyHintEl.textContent = err.message;
  }
}

async function readyUp() {
  if (!playerId) {
    lobbyHintEl.textContent = "Join the game first.";
    return;
  }
  try {
    await api("/game/players/ready", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player_id: playerId, ready: true }),
    });
    lobbyHintEl.textContent = "Ready set. Waiting for others…";
    await refresh();
  } catch (err) {
    lobbyHintEl.textContent = err.message;
  }
}

function allHumansReady(players) {
  const humans = players.filter((p) => !p.is_bot);
  return humans.length > 0 && humans.every((p) => p.claimed && p.ready);
}

async function maybeStartGame(state) {
  if (!isHost || startRequested) return;
  if (!state.started && allHumansReady(state.players || [])) {
    startRequested = true;
    await api("/game/start", { method: "POST" });
  }
}

async function refresh() {
  try {
    const state = await api("/game/state");
    if (!state.state) {
      lobbyHintEl.textContent = "Waiting for host to create a game.";
      return;
    }
    const players = state.state.players || [];
    phaseValueEl.textContent = state.state.phase;
    seatCountEl.textContent = players.filter((p) => !p.is_bot).length;
    renderPlayers(players);
    if (isHost) {
      hostControlsEl.classList.remove("hidden");
      renderHostSlots(players);
      await maybeStartGame(state.state);
    }
    const seat = players.find((p) => p.id === playerId);
    if (seat) {
      seatInfoEl.textContent = `Seat: ${seat.name}. Status: ${seat.ready ? "Ready" : "Joined"}.`;
    }
    if (playerId && state.state.started) {
      window.location.href = `/game?player_id=${playerId}`;
    }
  } catch (err) {
    lobbyHintEl.textContent = err.message;
  }
}

joinBtn.addEventListener("click", joinGame);
readyBtn.addEventListener("click", readyUp);

if (isHost) {
  hostAddHuman.addEventListener("click", async () => {
    await api("/game/players/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_bot: false }),
    });
    await refresh();
  });
  hostRemoveHuman.addEventListener("click", async () => {
    await api("/game/players/remove_last_human", { method: "POST" });
    await refresh();
  });
}

refresh();
setInterval(refresh, 1500);
