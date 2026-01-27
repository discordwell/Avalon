const api = (path, options = {}) => fetch(path, options).then(async (res) => {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
});

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(window.location.search);
const playerId = params.get("player_id") || "";

const playerNameEl = $("playerName");
const roleRevealEl = $("roleReveal");
const phaseValueEl = $("phaseValue");
const questValueEl = $("questValue");
const playerTableEl = $("playerTable");
const chatLogEl = $("chatLog");
const actionPanelEl = $("actionPanel");
const privateIntelEl = $("privateIntel");

let lastChatCount = 0;
let cachedState = null;
let cachedPrivate = null;

function renderPlayerTable(visibility = [], ladyHolderId) {
  playerTableEl.innerHTML = "";
  visibility.forEach((entry) => {
    const card = document.createElement("div");
    card.className = "player-card";
    if (entry.alignment_hint === "evil") card.classList.add("evil");
    if (entry.alignment_hint === "merlin_candidate") card.classList.add("merlin");
    const tag = entry.alignment_hint === "evil"
      ? "Evil"
      : entry.alignment_hint === "merlin_candidate"
      ? "Merlin?"
      : "Unknown";
    const ladyTag = entry.id === ladyHolderId ? "<div class=\"tag\">Lady</div>" : "";
    card.innerHTML = `${ladyTag}<div class=\"tag\">${tag}</div><strong>${entry.name}</strong>`;
    playerTableEl.appendChild(card);
  });
}

function renderChat(chat = [], players = []) {
  const lookup = Object.fromEntries(players.map((p) => [p.id, p.name]));
  if (chat.length === lastChatCount) return;
  chatLogEl.innerHTML = "";
  chat.forEach((msg) => {
    const item = document.createElement("div");
    item.className = "chat-item";
    const name = lookup[msg.player_id] || msg.player_id;
    item.textContent = `${name}: ${msg.message}`;
    chatLogEl.appendChild(item);
  });
  lastChatCount = chat.length;
}

function renderPrivateIntel(privateState) {
  if (!privateState || !privateState.role) {
    privateIntelEl.textContent = "No private intel yet.";
    return;
  }
  const knowledge = [...(privateState.knowledge || []), ...(privateState.lady_knowledge || [])];
  privateIntelEl.textContent = knowledge.length ? knowledge.join("\n") : "No special intel.";
}

function renderRoleReveal(privateState) {
  if (!privateState || !privateState.role) {
    roleRevealEl.textContent = "Waiting for game start…";
    return;
  }
  roleRevealEl.textContent = `You are ${privateState.role}. Alignment: ${privateState.alignment}.`;
}

function renderActionMenu(state, privateState) {
  actionPanelEl.innerHTML = "";
  if (!state) {
    actionPanelEl.innerHTML = "<p class=\"hint\">No active game.</p>";
    return;
  }

  const player = state.players.find((p) => p.id === playerId);
  if (!player) {
    actionPanelEl.innerHTML = "<p class=\"hint\">Player not found.</p>";
    return;
  }

  const phase = state.phase;
  const leader = state.players[state.leader_index];

  const addButton = (label, handler, ghost = false) => {
    const btn = document.createElement("button");
    btn.textContent = label;
    if (ghost) btn.classList.add("ghost");
    btn.addEventListener("click", handler);
    actionPanelEl.appendChild(btn);
  };

  const addTeamPicker = (size) => {
    const selector = document.createElement("div");
    selector.className = "stack";
    const info = document.createElement("p");
    info.className = "hint";
    info.textContent = `Select ${size} players (including yourself if desired).`;
    selector.appendChild(info);

    const selects = [];
    for (let i = 0; i < size; i += 1) {
      const select = document.createElement("select");
      state.players.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.name;
        select.appendChild(opt);
      });
      selects.push(select);
      selector.appendChild(select);
    }

    addButton("Submit team", async () => {
      const team = selects.map((s) => s.value);
      await api("/game/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player_id: playerId, action_type: "propose_team", payload: { team } }),
      });
    });
    actionPanelEl.appendChild(selector);
  };

  if (phase === "team_proposal") {
    if (leader.id !== playerId) {
      actionPanelEl.innerHTML = `<p class=\"hint\">Waiting for ${leader.name} to propose a team.</p>`;
      return;
    }
    const size = teamSize(state);
    addTeamPicker(size);
    return;
  }

  if (phase === "team_vote") {
    if (state.team_votes && state.team_votes[playerId] !== undefined) {
      actionPanelEl.innerHTML = "<p class=\"hint\">Vote submitted. Waiting on others.</p>";
      return;
    }
    addButton("Approve team", () => submitAction("vote_team", { approve: true }));
    addButton("Reject team", () => submitAction("vote_team", { approve: false }), true);
    return;
  }

  if (phase === "quest") {
    if (!state.proposed_team.includes(playerId)) {
      actionPanelEl.innerHTML = "<p class=\"hint\">Quest in progress. You are not on the team.</p>";
      return;
    }
    if (state.quest_votes && state.quest_votes[playerId] !== undefined) {
      actionPanelEl.innerHTML = "<p class=\"hint\">Vote submitted.</p>";
      return;
    }
    addButton("Quest success", () => submitAction("quest_vote", { success: true }));
    addButton("Quest fail", () => submitAction("quest_vote", { success: false }), true);
    return;
  }

  if (phase === "lady_of_lake") {
    if (state.lady_holder_id !== playerId) {
      actionPanelEl.innerHTML = "<p class=\"hint\">Waiting for the Lady of the Lake.</p>";
      return;
    }
    const select = document.createElement("select");
    state.players.forEach((p) => {
      if (p.id === playerId) return;
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      select.appendChild(opt);
    });
    actionPanelEl.appendChild(select);
    addButton("Use Lady of the Lake", () => submitAction("lady_peek", { target_id: select.value }));
    return;
  }

  if (phase === "assassination") {
    if (privateState.role !== "Assassin") {
      actionPanelEl.innerHTML = "<p class=\"hint\">Waiting for the assassin.</p>";
      return;
    }
    const select = document.createElement("select");
    state.players.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      select.appendChild(opt);
    });
    actionPanelEl.appendChild(select);
    addButton("Assassinate", () => submitAction("assassinate", { target_id: select.value }));
    return;
  }

  if (phase === "game_over") {
    actionPanelEl.innerHTML = `<p class=\"hint\">Game over. Winner: ${state.winner}</p>`;
    return;
  }

  actionPanelEl.innerHTML = "<p class=\"hint\">Waiting for next phase.</p>";
}

function teamSize(state) {
  const sizes = {
    5: [2, 3, 2, 3, 3],
    6: [2, 3, 4, 3, 4],
    7: [2, 3, 3, 4, 4],
    8: [3, 4, 4, 5, 5],
    9: [3, 4, 4, 5, 5],
    10: [3, 4, 4, 5, 5],
  };
  return sizes[state.config.player_count][state.quest_number - 1];
}

async function submitAction(actionType, payload) {
  await api("/game/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ player_id: playerId, action_type: actionType, payload }),
  });
}

$("sendChat").addEventListener("click", async () => {
  const message = $("chatMessage").value.trim();
  if (!message) return;
  await submitAction("chat", { message });
  $("chatMessage").value = "";
});

async function refresh() {
  try {
    const [publicState, privateState] = await Promise.all([
      api("/game/state"),
      playerId ? api(`/game/state?player_id=${playerId}`) : Promise.resolve(null),
    ]);
    cachedState = publicState.state;
    cachedPrivate = privateState;
    if (cachedState) {
      phaseValueEl.textContent = cachedState.phase;
      questValueEl.textContent = cachedState.quest_number;
      const player = cachedState.players.find((p) => p.id === playerId);
      playerNameEl.textContent = player ? player.name : "Player";
      renderChat(cachedState.chat || [], cachedState.players || []);
    }
    if (cachedPrivate) {
      renderRoleReveal(cachedPrivate);
      renderPrivateIntel(cachedPrivate);
      renderPlayerTable(cachedPrivate.visibility || [], cachedState?.lady_holder_id);
    }
    renderActionMenu(cachedState, cachedPrivate || {});
  } catch (err) {
    roleRevealEl.textContent = "Unable to reach server.";
  }
}

refresh();
setInterval(refresh, 1500);
