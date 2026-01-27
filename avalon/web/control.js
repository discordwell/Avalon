const api = (path, options = {}) => fetch(path, options).then(async (res) => {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
});

const $ = (id) => document.getElementById(id);
const roleGrid = $("roleGrid");
const humanCountEl = $("humanCount");
const botCountEl = $("botCount");
const totalCountEl = $("totalCount");
const joinLinksEl = $("joinLinks");
const serverStatusEl = $("serverStatus");
const phaseValueEl = $("phaseValue");
const publicStateEl = $("publicState");
const eventLogEl = $("eventLog");
const setupHintEl = $("setupHint");
const roleHintEl = $("roleHint");
const evilCountEl = $("evilCount");
const goodCountEl = $("goodCount");
const ladyToggle = $("ladyToggle");
const joinSection = $("joinSection");
const liveSection = $("liveSection");
const slotListEl = $("slotList");

const roleOptions = [
  { name: "Percival", alignment: "good", defaultOn: true },
  { name: "Morgana", alignment: "evil", defaultOn: true },
  { name: "Mordred", alignment: "evil", defaultOn: false },
  { name: "Oberon", alignment: "evil", defaultOn: false },
];

const mandatoryRoles = ["Merlin", "Assassin"];

let humanCount = 2;
let botCount = 3;
let evilCount = 2;
let gameCreated = false;
let gameStarted = false;
let publicBaseUrl = window.location.origin;
let tunnelPolling = null;
let cachedPlayers = [];

function defaultEvilCount(total) {
  if (total <= 6) return 2;
  if (total <= 9) return 3;
  return 4;
}

function updateTotals() {
  const total = humanCount + botCount;
  evilCount = Math.min(Math.max(1, evilCount), Math.max(1, total - 2));
  const goodCount = total - evilCount;
  humanCountEl.textContent = humanCount;
  botCountEl.textContent = botCount;
  totalCountEl.textContent = total;
  evilCountEl.textContent = evilCount;
  goodCountEl.textContent = goodCount;
  const valid = total >= 5 && total <= 10;
  totalCountEl.style.color = valid ? "inherit" : "#c75c2c";
}

function createRoleButton(role) {
  const button = document.createElement("button");
  button.className = "role-toggle";
  button.dataset.role = role.name;
  button.dataset.alignment = role.alignment;
  if (role.defaultOn) button.classList.add("active");
  button.textContent = role.name;
  button.addEventListener("click", () => {
    button.classList.toggle("active");
    enforcePercivalRule();
    updateRoleHint();
  });
  return button;
}

roleOptions.forEach((role) => roleGrid.appendChild(createRoleButton(role)));

ladyToggle.addEventListener("click", () => {
  ladyToggle.classList.toggle("active");
  updateRoleHint();
});

function adjustCount(kind, delta) {
  if (kind === "human") {
    humanCount = Math.max(1, humanCount + delta);
  } else {
    botCount = Math.max(0, botCount + delta);
  }
  const total = humanCount + botCount;
  evilCount = defaultEvilCount(total);
  updateTotals();
}

$("humanUp").addEventListener("click", () => adjustCount("human", 1));
$("humanDown").addEventListener("click", () => adjustCount("human", -1));
$("botUp").addEventListener("click", () => adjustCount("bot", 1));
$("botDown").addEventListener("click", () => adjustCount("bot", -1));
$("evilUp").addEventListener("click", () => {
  evilCount += 1;
  updateTotals();
});
$("evilDown").addEventListener("click", () => {
  evilCount -= 1;
  updateTotals();
});

$("addHumanSlot").addEventListener("click", async () => {
  try {
    await api("/game/players/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_bot: false }),
    });
    await refreshState();
  } catch (err) {
    setupHintEl.textContent = err.message;
  }
});

$("addBotSlot").addEventListener("click", async () => {
  try {
    await api("/game/players/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_bot: true }),
    });
    await refreshState();
  } catch (err) {
    setupHintEl.textContent = err.message;
  }
});

function buildPlayers() {
  const players = [];
  for (let i = 1; i <= humanCount; i += 1) {
    players.push({ id: `h${i}`, name: `Human ${i}`, is_bot: false });
  }
  for (let i = 1; i <= botCount; i += 1) {
    players.push({ id: `b${i}`, name: `Bot ${i}`, is_bot: true });
  }
  return players;
}

function buildRoles(totalPlayers) {
  const totalEvil = evilCount;
  const totalGood = totalPlayers - totalEvil;

  const goodRoles = ["Merlin"];
  const evilRoles = ["Assassin"];

  const activeRoles = [...roleGrid.querySelectorAll(".role-toggle.active[data-role]")].map(
    (btn) => btn.dataset.role
  );

  if (activeRoles.includes("Percival")) goodRoles.push("Percival");
  if (activeRoles.includes("Morgana")) evilRoles.push("Morgana");
  if (activeRoles.includes("Mordred")) evilRoles.push("Mordred");
  if (activeRoles.includes("Oberon")) evilRoles.push("Oberon");

  if (goodRoles.length > totalGood || evilRoles.length > totalEvil) return null;

  while (goodRoles.length < totalGood) goodRoles.push("Loyal Servant");
  while (evilRoles.length < totalEvil) evilRoles.push("Minion of Mordred");

  return [...goodRoles, ...evilRoles];
}

function renderJoinLinks(players) {
  if (!players.length) {
    joinLinksEl.textContent = "No links yet.";
    return;
  }
  joinLinksEl.innerHTML = "";
  const card = document.createElement("div");
  card.className = "link-card";
  const url = `${publicBaseUrl}/play`;
  card.innerHTML = `<strong>Player picker</strong><p class=\"hint\">${url}</p>`;
  joinLinksEl.appendChild(card);
}

function renderSlots(players) {
  slotListEl.innerHTML = "";
  if (!players.length) return;
  players.forEach((player) => {
    const row = document.createElement("div");
    row.className = "slot-row";
    const nameInput = document.createElement("input");
    nameInput.value = player.name;
    nameInput.disabled = player.is_bot;

    const tag = document.createElement("span");
    tag.className = "slot-tag";
    tag.textContent = player.is_bot ? "Bot" : player.claimed ? "Claimed" : "Open";

    const saveBtn = document.createElement("button");
    saveBtn.className = "ghost";
    saveBtn.textContent = "Rename";
    saveBtn.disabled = player.is_bot;
    saveBtn.addEventListener("click", async () => {
      try {
        await api("/game/players/rename", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ player_id: player.id, name: nameInput.value.trim() || player.name }),
        });
        await refreshState();
      } catch (err) {
        setupHintEl.textContent = err.message;
      }
    });

    const resetBtn = document.createElement("button");
    resetBtn.className = "ghost";
    resetBtn.textContent = "Remove player";
    resetBtn.disabled = player.is_bot;
    resetBtn.addEventListener("click", async () => {
      try {
        await api("/game/players/reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ player_id: player.id }),
        });
        await refreshState();
      } catch (err) {
        setupHintEl.textContent = err.message;
      }
    });

    const removeBtn = document.createElement("button");
    removeBtn.className = "ghost";
    removeBtn.textContent = "Remove slot";
    removeBtn.addEventListener("click", async () => {
      try {
        await api("/game/players/remove", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ player_id: player.id }),
        });
        await refreshState();
      } catch (err) {
        setupHintEl.textContent = err.message;
      }
    });

    row.appendChild(tag);
    row.appendChild(nameInput);
    row.appendChild(saveBtn);
    row.appendChild(resetBtn);
    row.appendChild(removeBtn);
    slotListEl.appendChild(row);
  });
}

function updateVisibility() {
  joinSection.classList.toggle("hidden", !gameCreated);
  liveSection.classList.toggle("hidden", !gameStarted);
}

async function refreshState() {
  try {
    const state = await api("/game/state");
    serverStatusEl.textContent = "Online";
    phaseValueEl.textContent = state.state ? state.state.phase : "No game";
    publicStateEl.textContent = JSON.stringify(state.state, null, 2);
    if (state.state?.players) {
      cachedPlayers = state.state.players;
      renderSlots(cachedPlayers);
      if (gameCreated) {
        renderJoinLinks(cachedPlayers);
      }
    }
  } catch (err) {
    serverStatusEl.textContent = "Offline";
    publicStateEl.textContent = "Unable to reach server.";
  }
}

async function refreshEvents() {
  try {
    const events = await api("/game/events");
    eventLogEl.textContent = JSON.stringify(events.events, null, 2);
  } catch (err) {
    eventLogEl.textContent = "Unable to load events.";
  }
}

async function startTunnel() {
  try {
    await api("/tunnel/start", { method: "POST" });
    if (tunnelPolling) return;
    tunnelPolling = setInterval(async () => {
      const status = await api("/tunnel/status");
      if (status.tunnel.public_url) {
        publicBaseUrl = status.tunnel.public_url;
        setupHintEl.textContent = `Public link: ${publicBaseUrl}`;
        clearInterval(tunnelPolling);
        tunnelPolling = null;
        if (gameCreated) {
          renderJoinLinks(cachedPlayers);
        }
      }
      if (status.tunnel.error) {
        setupHintEl.textContent = status.tunnel.error;
        clearInterval(tunnelPolling);
        tunnelPolling = null;
      }
    }, 1200);
  } catch (err) {
    setupHintEl.textContent = err.message;
  }
}

$("createGame").addEventListener("click", async () => {
  try {
    const players = buildPlayers();
    const total = players.length;
    if (total < 5 || total > 10) {
      throw new Error("Total players must be between 5 and 10.");
    }
    const roles = buildRoles(total);
    if (!roles) {
      throw new Error("Role selection does not fit the good/evil counts.");
    }
    const lady = ladyToggle.classList.contains("active");
    await api("/game/new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ players, roles, hammer_auto_approve: true, lady_of_lake: lady }),
    });
    setupHintEl.textContent = "Game created. Starting public tunnel…";
    gameCreated = true;
    publicBaseUrl = window.location.origin;
    cachedPlayers = players;
    renderJoinLinks(players);
    updateVisibility();
    await refreshState();
    await refreshEvents();
    await startTunnel();
  } catch (err) {
    setupHintEl.textContent = err.message;
  }
});

$("startGame").addEventListener("click", async () => {
  try {
    await api("/game/start", { method: "POST" });
    setupHintEl.textContent = "Game launched.";
    gameStarted = true;
    updateVisibility();
    await refreshState();
    await refreshEvents();
  } catch (err) {
    setupHintEl.textContent = err.message;
  }
});

function enforcePercivalRule() {
  const percival = roleGrid.querySelector('[data-role="Percival"]');
  const morgana = roleGrid.querySelector('[data-role="Morgana"]');
  if (morgana.classList.contains("active") && !percival.classList.contains("active")) {
    percival.classList.add("active");
  }
}

function updateRoleHint() {
  const active = [...roleGrid.querySelectorAll(".role-toggle.active[data-role]")].map(
    (btn) => btn.dataset.role
  );
  const lady = ladyToggle.classList.contains("active") ? "Lady of the Lake" : "Lady off";
  roleHintEl.textContent = `Mandatory: ${mandatoryRoles.join(", ")}. Selected: ${active.join(", ") || "None"}. ${lady}.`;
}

updateRoleHint();
updateTotals();
updateVisibility();
refreshState();
refreshEvents();
setInterval(refreshState, 2000);
setInterval(refreshEvents, 4000);
