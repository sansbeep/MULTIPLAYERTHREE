const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const TICK_RATE = 30;
const VOTE_SECONDS = 30;
const BATTLE_SECONDS = 180;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

app.use(express.static(__dirname));
app.use('/three', express.static(path.join(__dirname, 'node_modules', 'three')));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const players = new Map();
const votes = new Map();
const mapVotes = new Map();
const zombies = new Map();
const playerSettings = new Map();
const friendRequests = new Map();
const friends = new Map();
const lobbyInvites = new Map();
const DEFAULT_LOBBY = 'public';
const lobbySettings = new Map();
const BAD_WORDS = ['fuck', 'shit', 'bitch', 'asshole', 'bastard', 'damn', 'crap', 'slur'];
let zombieCounter = 0;
let currentMap = 'hydro';
let round = {
  phase: 'voting',
  mode: null,
  endsAt: Date.now() + VOTE_SECONDS * 1000,
  wave: 0,
};

function publicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    color: player.color,
    style: player.style,
    cosmetic: player.cosmetic,
    weapon: player.weapon,
    health: player.health,
    score: player.score,
    position: player.position,
    rotation: player.rotation,
    velocity: player.velocity,
    shooting: player.shooting,
    lastShotAt: player.lastShotAt,
    updatedAt: player.updatedAt,
    lobby: player.lobby,
  };
}

function publicRound(lobby = DEFAULT_LOBBY) {
  const counts = { battle: 0, coop: 0 };
  const maps = { hydro: 0, arcade: 0, citadel: 0 };
  const voters = [];
  for (const [id, vote] of votes) {
    const player = players.get(id);
    if (!player || player.lobby !== lobby) continue;
    if (counts[vote] !== undefined) counts[vote] += 1;
  }
  for (const [id, vote] of votes) {
    const player = players.get(id);
    if (!player || player.lobby !== lobby) continue;
    voters.push({
      id,
      name: player ? player.name : `Player ${id.slice(0, 4)}`,
      vote,
    });
  }
  for (const [id, vote] of mapVotes) {
    const player = players.get(id);
    if (!player || player.lobby !== lobby) continue;
    if (maps[vote] !== undefined) maps[vote] += 1;
  }
  return {
    phase: round.phase,
    mode: round.mode,
    endsAt: round.endsAt,
    wave: round.wave,
    votes: counts,
    voters,
    maps,
    map: currentMap,
  };
}

function lobbyRoom(lobby = DEFAULT_LOBBY) {
  return `lobby:${sanitizeLobby(lobby)}`;
}

function sanitizeLobby(input) {
  const clean = String(input || DEFAULT_LOBBY)
    .replace(/[^\w -]/g, '')
    .trim()
    .slice(0, 24);
  return clean || DEFAULT_LOBBY;
}

function playersInLobby(lobby = DEFAULT_LOBBY) {
  return Array.from(players.values()).filter((player) => player.lobby === lobby);
}

function lobbyConfig(lobby = DEFAULT_LOBBY) {
  const id = sanitizeLobby(lobby);
  if (!lobbySettings.has(id)) {
    lobbySettings.set(id, {
      id,
      name: id,
      hostId: null,
      map: 'hydro',
      mode: 'battle',
      restricted: [],
      started: false,
      createdAt: Date.now(),
    });
  }
  return lobbySettings.get(id);
}

function publicLobby(lobby = DEFAULT_LOBBY) {
  const config = lobbyConfig(lobby);
  const lobbyPlayers = playersInLobby(config.id);
  return {
    id: config.id,
    name: config.name,
    hostId: config.hostId,
    hostName: players.get(config.hostId)?.name || 'Open',
    map: config.map,
    mode: config.mode,
    restricted: config.restricted,
    started: config.started,
    players: lobbyPlayers.map((player) => ({ id: player.id, name: player.name, color: player.color, style: player.style, cosmetic: player.cosmetic })),
    playerCount: lobbyPlayers.length,
  };
}

function emitLobbyDirectory() {
  const lobbies = Array.from(lobbySettings.keys())
    .map(publicLobby)
    .filter((lobby) => lobby.id !== DEFAULT_LOBBY && !lobby.started);
  io.emit('lobbyList', lobbies);
}

function emitLobbyState(lobby = DEFAULT_LOBBY, movementOnly = false) {
  const room = lobbyRoom(lobby);
  const lobbyPlayers = playersInLobby(lobby);
  io.to(room).volatile.emit('state', lobbyPlayers.map(publicPlayer));
  if (movementOnly) {
    if (round.mode === 'coop') io.to(room).volatile.emit('zombies', Array.from(zombies.values()).map(publicZombie));
    return;
  }
  io.to(room).emit('playerCount', lobbyPlayers.length);
  io.to(room).emit('roundState', publicRound(lobby));
  if (round.mode === 'coop') io.to(room).emit('zombies', Array.from(zombies.values()).map(publicZombie));
}

function activeLobbies() {
  const lobbies = new Set(Array.from(players.values()).map((player) => player.lobby || DEFAULT_LOBBY));
  if (!lobbies.size) lobbies.add(DEFAULT_LOBBY);
  return lobbies;
}

function emitAllLobbyStates(movementOnly = false) {
  for (const lobby of activeLobbies()) emitLobbyState(lobby, movementOnly);
}

function publicZombie(zombie) {
  return {
    id: zombie.id,
    health: zombie.health,
    position: zombie.position,
    velocity: zombie.velocity,
    attackAt: zombie.attackAt,
    type: zombie.type,
  };
}

function randomColor() {
  const hue = Math.floor(Math.random() * 360);
  return `hsl(${hue}, 72%, 58%)`;
}

function friendList(id) {
  return Array.from(friends.get(id) || [])
    .map((friendId) => players.get(friendId))
    .filter(Boolean)
    .map((friend) => ({ id: friend.id, name: friend.name }));
}

function emitFriends(id) {
  const socket = io.sockets.sockets.get(id);
  if (socket) socket.emit('friendsUpdated', { friends: friendList(id) });
}

function censorMessage(input) {
  let message = String(input || '').replace(/\s+/g, ' ').trim().slice(0, 140);
  for (const word of BAD_WORDS) {
    const pattern = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    message = message.replace(pattern, (match) => '*'.repeat(Math.max(3, match.length)));
  }
  return message;
}

function randomSpawnForMap(mapName = currentMap) {
  if (mapName === 'arcade') {
    return { x: (Math.random() - 0.5) * 22, y: 4.95, z: (Math.random() - 0.5) * 52 };
  }
  if (mapName === 'citadel') {
    const spots = [
      { x: 0, y: 2, z: 0 },
      { x: -58, y: 2, z: -58 },
      { x: 58, y: 2, z: -58 },
      { x: -58, y: 2, z: 58 },
      { x: 58, y: 2, z: 58 },
    ];
    return spots[Math.floor(Math.random() * spots.length)];
  }
  return { x: (Math.random() - 0.5) * 90, y: 2.1, z: (Math.random() - 0.5) * 90 };
}

io.on('connection', (socket) => {
  const player = {
    id: socket.id,
    name: `Player ${socket.id.slice(0, 4)}`,
    lobby: DEFAULT_LOBBY,
    color: randomColor(),
    style: 'classic',
    cosmetic: 'none',
    weapon: 'assault',
    health: 100,
    score: 0,
    position: randomSpawnForMap('hydro'),
    rotation: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    shooting: false,
    lastShotAt: 0,
    updatedAt: Date.now(),
  };

  players.set(socket.id, player);
  lobbyConfig(DEFAULT_LOBBY);
  socket.join(lobbyRoom(player.lobby));

  socket.emit('init', {
    id: socket.id,
    players: playersInLobby(player.lobby).map(publicPlayer),
    round: publicRound(player.lobby),
    zombies: Array.from(zombies.values()).map(publicZombie),
    lobby: player.lobby,
    lobbyState: publicLobby(player.lobby),
  });
  emitFriends(socket.id);

  socket.to(lobbyRoom(player.lobby)).emit('playerJoined', publicPlayer(player));
  emitLobbyState(player.lobby);
  emitLobbyDirectory();

  socket.on('playerUpdate', (state = {}) => {
    const current = players.get(socket.id);
    if (!current) return;

    if (state.position) current.position = sanitizeVector(state.position, current.position);
    if (state.rotation) current.rotation = sanitizeVector(state.rotation, current.rotation);
    if (state.velocity) current.velocity = sanitizeVector(state.velocity, current.velocity);
    if (typeof state.weapon === 'string') current.weapon = state.weapon;
    current.shooting = Boolean(state.shooting);
    current.updatedAt = Date.now();
  });

  socket.on('setName', (name) => {
    const current = players.get(socket.id);
    if (!current) return;
    current.name = sanitizeName(name, current.name);
    io.to(lobbyRoom(current.lobby)).emit('playerRenamed', { id: socket.id, name: current.name });
    io.to(lobbyRoom(current.lobby)).emit('roundState', publicRound(current.lobby));
    emitLobbyDirectory();
  });

  socket.on('setCustomization', (customization = {}) => {
    const current = players.get(socket.id);
    if (!current) return;
    if (typeof customization.color === 'string' && /^#[0-9a-f]{6}$/i.test(customization.color)) {
      current.color = customization.color;
    }
    if (typeof customization.style === 'string') {
      current.style = ['classic', 'scout', 'heavy'].includes(customization.style) ? customization.style : 'classic';
    }
    if (typeof customization.cosmetic === 'string') {
      current.cosmetic = ['none', 'crown', 'horns', 'cape'].includes(customization.cosmetic) ? customization.cosmetic : 'none';
    }
    io.to(lobbyRoom(current.lobby)).emit('playerCustomized', {
      id: socket.id,
      color: current.color,
      style: current.style,
      cosmetic: current.cosmetic,
    });
    emitLobbyState(current.lobby);
    emitLobbyDirectory();
  });

  socket.on('friendRequest', (targetId) => {
    const current = players.get(socket.id);
    const target = players.get(targetId);
    if (!current || !target || targetId === socket.id) return;
    if ((friends.get(socket.id) || new Set()).has(targetId)) {
      socket.emit('friendResponse', { fromId: targetId, fromName: target.name, accepted: true });
      emitFriends(socket.id);
      return;
    }
    if (!friendRequests.has(targetId)) friendRequests.set(targetId, new Set());
    if (friendRequests.get(targetId).has(socket.id)) return;
    friendRequests.get(targetId).add(socket.id);
    const targetSocket = io.sockets.sockets.get(targetId);
    if (targetSocket) {
      targetSocket.emit('friendRequest', { fromId: socket.id, fromName: current.name });
    }
  });

  socket.on('friendResponse', ({ targetId, accepted } = {}) => {
    const current = players.get(socket.id);
    const target = players.get(targetId);
    if (!current || !target) return;
    if (friendRequests.has(socket.id)) friendRequests.get(socket.id).delete(targetId);
    if (accepted) {
      if (!friends.has(socket.id)) friends.set(socket.id, new Set());
      if (!friends.has(targetId)) friends.set(targetId, new Set());
      friends.get(socket.id).add(targetId);
      friends.get(targetId).add(socket.id);
      emitFriends(socket.id);
      emitFriends(targetId);
    }
    const targetSocket = io.sockets.sockets.get(targetId);
    if (targetSocket) {
      targetSocket.emit('friendResponse', { fromId: socket.id, fromName: current.name, accepted: Boolean(accepted) });
    }
  });

  socket.on('chatMessage', (message) => {
    const current = players.get(socket.id);
    if (!current) return;
    const clean = censorMessage(message);
    if (!clean) return;
    io.to(lobbyRoom(current.lobby)).emit('chatMessage', {
      id: socket.id,
      name: current.name,
      message: clean,
      at: Date.now(),
    });
  });

  socket.on('inviteFriend', (targetId) => {
    const current = players.get(socket.id);
    const target = players.get(targetId);
    if (!current || !target || targetId === socket.id) return;
    if (!(friends.get(socket.id) || new Set()).has(targetId)) return;
    const targetSocket = io.sockets.sockets.get(targetId);
    if (targetSocket) {
      const config = lobbyConfig(current.lobby);
      targetSocket.emit('lobbyInvite', {
        fromId: socket.id,
        fromName: current.name,
        lobby: current.lobby,
        map: config.map,
        mode: config.mode,
      });
      if (!lobbyInvites.has(targetId)) lobbyInvites.set(targetId, new Set());
      lobbyInvites.get(targetId).add(current.lobby);
    }
  });

  socket.on('listLobbies', (callback) => {
    const lobbies = Array.from(lobbySettings.keys())
      .map(publicLobby)
      .filter((lobby) => lobby.id !== DEFAULT_LOBBY && !lobby.started);
    if (typeof callback === 'function') callback(lobbies);
    socket.emit('lobbyList', lobbies);
  });

  socket.on('createLobby', (settings = {}, callback) => {
    const current = players.get(socket.id);
    if (!current) return;
    const lobbyId = sanitizeLobby(settings.name || `${current.name}'s Lobby`);
    const config = lobbyConfig(lobbyId);
    config.name = lobbyId;
    config.hostId = socket.id;
    config.map = sanitizeMap(settings.map);
    config.mode = settings.mode === 'coop' ? 'coop' : 'battle';
    config.restricted = Array.isArray(settings.restricted)
      ? settings.restricted.filter((weapon) => ['shotgun', 'sniper', 'smg', 'dmr', 'launcher'].includes(weapon))
      : [];
    config.started = false;
    moveToLobby(socket, current, lobbyId);
    emitLobbyState(lobbyId);
    io.to(lobbyRoom(lobbyId)).emit('lobbyState', publicLobby(lobbyId));
    emitLobbyDirectory();
    if (typeof callback === 'function') callback(publicLobby(lobbyId));
  });

  socket.on('joinLobby', (lobbyName, callback) => {
    const current = players.get(socket.id);
    if (!current) return;
    const nextLobby = sanitizeLobby(lobbyName);
    const config = lobbyConfig(nextLobby);
    const invited = lobbyInvites.get(socket.id)?.has(nextLobby);
    if (config.started && config.hostId !== socket.id && nextLobby !== 'mega-server' && !invited) {
      if (typeof callback === 'function') callback({ error: 'That match already started. Ask a friend for an invite.' });
      return;
    }
    if (invited) lobbyInvites.get(socket.id).delete(nextLobby);
    if (!config.hostId) {
      config.hostId = socket.id;
      config.name = nextLobby === 'mega-server' ? 'Mega Portal' : config.name;
      if (nextLobby === 'mega-server') {
        config.map = randomMap();
        config.mode = 'battle';
        config.started = true;
        startRound(config.mode, config.map);
      }
    }
    moveToLobby(socket, current, nextLobby);
    socket.emit('init', {
      id: socket.id,
      players: playersInLobby(nextLobby).map(publicPlayer),
      round: publicRound(nextLobby),
      zombies: Array.from(zombies.values()).map(publicZombie),
      lobby: nextLobby,
      lobbyState: publicLobby(nextLobby),
    });
    socket.to(lobbyRoom(nextLobby)).emit('playerJoined', publicPlayer(current));
    emitLobbyState(nextLobby);
    io.to(lobbyRoom(nextLobby)).emit('lobbyState', publicLobby(nextLobby));
    if (config.started) {
      socket.emit('lobbyStarted', publicLobby(nextLobby));
      socket.emit('mapState', config.map);
    }
    emitLobbyDirectory();
    if (typeof callback === 'function') callback(publicLobby(nextLobby));
  });

  socket.on('startLobby', (callback) => {
    const current = players.get(socket.id);
    if (!current) return;
    const config = lobbyConfig(current.lobby);
    if (config.hostId !== socket.id) return;
    config.started = true;
    startRound(config.mode, config.map);
    io.to(lobbyRoom(config.id)).emit('lobbyStarted', publicLobby(config.id));
    io.to(lobbyRoom(config.id)).emit('mapState', config.map);
    emitLobbyDirectory();
    if (typeof callback === 'function') callback(publicLobby(config.id));
  });

  socket.on('kickPlayer', (targetId) => {
    const current = players.get(socket.id);
    const target = players.get(targetId);
    if (!current || !target || target.id === current.id) return;
    const config = lobbyConfig(current.lobby);
    if (config.hostId !== socket.id || target.lobby !== current.lobby) return;
    const targetSocket = io.sockets.sockets.get(targetId);
    if (targetSocket) {
      targetSocket.emit('kicked', { lobby: current.lobby, reason: 'Host removed you from the lobby.' });
      moveToLobby(targetSocket, target, DEFAULT_LOBBY);
    }
    emitLobbyState(current.lobby);
    io.to(lobbyRoom(current.lobby)).emit('lobbyState', publicLobby(current.lobby));
    emitLobbyDirectory();
  });

  socket.on('pingCheck', (_sent, callback) => {
    if (typeof callback === 'function') callback(Date.now());
  });

  socket.on('shoot', (shot = {}) => {
    const current = players.get(socket.id);
    if (!current) return;

    current.weapon = typeof shot.weapon === 'string' ? shot.weapon : current.weapon;
    current.shooting = true;
    current.lastShotAt = Date.now();

    socket.to(lobbyRoom(current.lobby)).emit('remoteShot', {
      id: socket.id,
      weapon: current.weapon,
      origin: sanitizeVector(shot.origin, current.position),
      direction: sanitizeVector(shot.direction, { x: 0, y: 0, z: -1 }),
      spread: Number.isFinite(shot.spread) ? shot.spread : 0,
      pelletCount: Number.isFinite(shot.pelletCount) ? shot.pelletCount : 1,
      at: current.lastShotAt,
    });
  });

  socket.on('grenade', (grenade = {}) => {
    const current = players.get(socket.id);
    if (!current) return;
    socket.to(lobbyRoom(current.lobby)).emit('grenade', {
      id: `${socket.id}-${Date.now()}`,
      ownerId: socket.id,
      origin: sanitizeVector(grenade.origin, current.position),
      velocity: sanitizeVector(grenade.velocity, { x: 0, y: 6, z: -12 }),
      at: Date.now(),
    });
  });

  socket.on('voteMode', (mode) => {
    if (mode !== 'battle' && mode !== 'coop') return;
    votes.set(socket.id, mode);
    const current = players.get(socket.id);
    io.to(lobbyRoom(current && current.lobby)).emit('roundState', publicRound(current && current.lobby));
  });

  socket.on('voteMap', (mapName) => {
    if (!isValidMap(mapName)) return;
    mapVotes.set(socket.id, mapName);
    currentMap = getWinningMap();
    const current = players.get(socket.id);
    io.to(lobbyRoom(current && current.lobby)).emit('roundState', publicRound(current && current.lobby));
    io.to(lobbyRoom(current && current.lobby)).emit('mapState', currentMap);
  });

  socket.on('hit', ({ targetId, damage, weapon, headshot } = {}) => {
    const attacker = players.get(socket.id);
    const target = players.get(targetId);
    if (!attacker || !target || targetId === socket.id) return;

    let hitDamage = Math.max(0, Math.min(Number(damage) || 0, 100));
    if (headshot) {
      hitDamage *= 2;
    }
    target.health = Math.max(0, target.health - hitDamage);

    if (target.health <= 0) {
      attacker.score += 1;
      target.health = 100;
      target.position = randomSpawnForMap(lobbyConfig(target.lobby).map || currentMap);
      io.to(lobbyRoom(attacker.lobby)).emit('playerRespawned', {
        id: targetId,
        by: socket.id,
        weapon,
        score: attacker.score,
        position: target.position,
        killerName: attacker.name,
        victimName: target.name,
        headshot,
      });
      io.to(lobbyRoom(attacker.lobby)).emit('killFeed', {
        killerId: socket.id,
        victimId: targetId,
        killerName: attacker.name,
        victimName: target.name,
        weapon,
        headshot,
      });
      socket.emit('creditsEarned', { amount: 25, reason: 'player eliminated' });
    }

    io.to(lobbyRoom(attacker.lobby)).emit('healthUpdate', {
      id: targetId,
      health: target.health,
      attackerId: socket.id,
      attackerScore: attacker.score,
      damage: hitDamage,
      isHeadshot: Boolean(headshot),
    });
  });

  socket.on('hitZombie', ({ zombieId, damage } = {}) => {
    const zombie = zombies.get(zombieId);
    const attacker = players.get(socket.id);
    if (!zombie || !attacker) return;
    zombie.health -= Math.max(0, Math.min(Number(damage) || 0, 160));
    if (zombie.health <= 0) {
      zombies.delete(zombieId);
      attacker.score += 1;
      io.to(lobbyRoom(attacker.lobby)).emit('zombieKilled', { id: zombieId, by: socket.id, score: attacker.score });
      io.to(lobbyRoom(attacker.lobby)).emit('killFeed', {
        killerId: socket.id,
        victimId: zombieId,
        killerName: attacker.name,
        victimName: 'Zombie',
        weapon: 'zombie',
      });
      socket.emit('creditsEarned', { amount: 10, reason: 'zombie eliminated' });
    }
  });

  socket.on('disconnect', () => {
    const current = players.get(socket.id);
    const lobby = current ? current.lobby : DEFAULT_LOBBY;
    players.delete(socket.id);
    friendRequests.delete(socket.id);
    lobbyInvites.delete(socket.id);
    for (const pending of friendRequests.values()) pending.delete(socket.id);
    friends.delete(socket.id);
    for (const [friendId, friendSet] of friends) {
      if (friendSet.delete(socket.id)) emitFriends(friendId);
    }
    votes.delete(socket.id);
    mapVotes.delete(socket.id);
    const config = lobbyConfig(lobby);
    if (config.hostId === socket.id) {
      const replacement = playersInLobby(lobby).find((candidate) => candidate.id !== socket.id);
      config.hostId = replacement ? replacement.id : null;
    }
    io.to(lobbyRoom(lobby)).emit('playerLeft', socket.id);
    emitLobbyState(lobby);
    io.to(lobbyRoom(lobby)).emit('lobbyState', publicLobby(lobby));
    emitLobbyDirectory();
  });
});

let tickCounter = 0;
setInterval(() => {
  updateRound();
  updateZombies(1 / TICK_RATE);
  tickCounter += 1;
  emitAllLobbyStates(tickCounter % TICK_RATE !== 0);
}, 1000 / TICK_RATE);

function updateRound() {
  const now = Date.now();
  if (round.phase === 'voting' && now >= round.endsAt) {
    let battle = 0;
    let coop = 0;
    for (const vote of votes.values()) {
      if (vote === 'coop') coop += 1;
      if (vote === 'battle') battle += 1;
    }
    startRound(coop > battle ? 'coop' : 'battle');
  }

  if (round.phase === 'playing' && round.mode === 'battle' && now >= round.endsAt) {
    const mega = lobbySettings.get('mega-server');
    if (mega && mega.started && playersInLobby('mega-server').length > 0) {
      mega.map = randomMap();
      startRound(mega.mode || getWinningVote(), mega.map);
      io.to(lobbyRoom('mega-server')).emit('lobbyState', publicLobby('mega-server'));
      return;
    }
    if (votes.size > 0) {
      startRound(getWinningVote());
    } else {
      startVoting();
    }
  }

  if (round.phase === 'playing' && round.mode === 'coop' && zombies.size === 0) {
    spawnWave();
  }
}

function sanitizeName(input, fallback) {
  const clean = String(input || '')
    .replace(/[^\w .-]/g, '')
    .trim()
    .slice(0, 18);
  return clean || fallback;
}

function moveToLobby(socket, player, nextLobby) {
  const previousLobby = player.lobby || DEFAULT_LOBBY;
  if (previousLobby === nextLobby) return;
  socket.leave(lobbyRoom(previousLobby));
  socket.to(lobbyRoom(previousLobby)).emit('playerLeft', player.id);
  player.lobby = nextLobby;
  socket.join(lobbyRoom(nextLobby));
  const previousConfig = lobbyConfig(previousLobby);
  if (previousConfig.hostId === player.id) {
    const replacement = playersInLobby(previousLobby).find((candidate) => candidate.id !== player.id);
    previousConfig.hostId = replacement ? replacement.id : null;
  }
  emitLobbyState(previousLobby);
}

function startVoting() {
  votes.clear();
  zombies.clear();
  round = {
    phase: 'voting',
    mode: null,
    endsAt: Date.now() + VOTE_SECONDS * 1000,
    wave: 0,
  };
  emitAllLobbyStates();
  for (const lobby of activeLobbies()) io.to(lobbyRoom(lobby)).emit('zombies', []);
}

function startRound(mode, forcedMap = null) {
  zombies.clear();
  votes.clear();
  currentMap = forcedMap || getWinningMap();
  round = {
    phase: 'playing',
    mode,
    endsAt: Date.now() + BATTLE_SECONDS * 1000,
    wave: 0,
  };
  emitAllLobbyStates();
  for (const lobby of activeLobbies()) io.to(lobbyRoom(lobby)).emit('mapState', currentMap);
  if (mode === 'coop') spawnWave();
}

function getWinningVote() {
  let battle = 0;
  let coop = 0;
  for (const vote of votes.values()) {
    if (vote === 'coop') coop += 1;
    if (vote === 'battle') battle += 1;
  }
  return coop > battle ? 'coop' : 'battle';
}

function getWinningMap() {
  let hydro = 0;
  let arcade = 0;
  let citadel = 0;
  for (const vote of mapVotes.values()) {
    if (vote === 'hydro') hydro += 1;
    if (vote === 'arcade') arcade += 1;
    if (vote === 'citadel') citadel += 1;
  }
  if (citadel > hydro && citadel >= arcade) return 'citadel';
  return arcade > hydro ? 'arcade' : 'hydro';
}

function randomMap() {
  const maps = ['hydro', 'arcade', 'citadel'];
  return maps[Math.floor(Math.random() * maps.length)];
}

function isValidMap(mapName) {
  return mapName === 'hydro' || mapName === 'arcade' || mapName === 'citadel';
}

function sanitizeMap(mapName) {
  return isValidMap(mapName) ? mapName : 'hydro';
}

function spawnWave() {
  if (round.mode !== 'coop') return;
  if (round.wave >= 6) {
    startVoting();
    return;
  }
  round.wave += 1;
  const count = Math.min(6 + round.wave * 2, 20);
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.6;
    const distance = 62 + Math.random() * 48;
    const type = round.wave >= 3 && i % 6 === 0 ? 'brute' : i % 4 === 0 ? 'runner' : 'walker';
    const zombie = {
      id: `z${++zombieCounter}`,
      type,
      health: (type === 'brute' ? 125 : type === 'runner' ? 42 : 62) + round.wave * 12,
      position: { x: Math.cos(angle) * distance, y: 0, z: Math.sin(angle) * distance },
      velocity: { x: 0, y: 0, z: 0 },
      attackAt: 0,
    };
    zombies.set(zombie.id, zombie);
  }
  emitAllLobbyStates();
}

function updateZombies(delta) {
  if (round.mode !== 'coop' || zombies.size === 0 || players.size === 0) return;
  const now = Date.now();
  for (const zombie of zombies.values()) {
    let nearest = null;
    let nearestDistance = Infinity;
    for (const player of players.values()) {
      const dx = player.position.x - zombie.position.x;
      const dz = player.position.z - zombie.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance < nearestDistance) {
        nearest = player;
        nearestDistance = distance;
      }
    }
    if (!nearest) continue;

    const speedBase = zombie.type === 'runner' ? 3.65 : zombie.type === 'brute' ? 1.75 : 2.45;
    const speed = speedBase + Math.min(round.wave * 0.2, 1.2);
    const dx = nearest.position.x - zombie.position.x;
    const dz = nearest.position.z - zombie.position.z;
    const length = Math.max(0.001, Math.hypot(dx, dz));
    zombie.velocity.x = (dx / length) * speed;
    zombie.velocity.z = (dz / length) * speed;

    if (nearestDistance > 1.8) {
      zombie.position.x += zombie.velocity.x * delta;
      zombie.position.z += zombie.velocity.z * delta;
    } else if (now - zombie.attackAt > 850) {
      zombie.attackAt = now;
      const damage = zombie.type === 'brute' ? 18 : zombie.type === 'runner' ? 7 : 10;
      nearest.health = Math.max(0, nearest.health - damage);
      if (nearest.health <= 0) {
        nearest.health = 100;
        nearest.position = randomSpawnForMap(lobbyConfig(nearest.lobby).map || currentMap);
        io.to(lobbyRoom(nearest.lobby)).emit('playerRespawned', {
          id: nearest.id,
          by: 'zombie',
          weapon: 'claws',
          score: nearest.score,
          position: nearest.position,
          killerName: 'Zombie',
          victimName: nearest.name,
        });
        io.to(lobbyRoom(nearest.lobby)).emit('killFeed', {
          killerId: 'zombie',
          victimId: nearest.id,
          killerName: 'Zombie',
          victimName: nearest.name,
          weapon: 'claws',
        });
      }
      io.to(lobbyRoom(nearest.lobby)).emit('healthUpdate', {
        id: nearest.id,
        health: nearest.health,
        attackerId: 'zombie',
        attackerScore: 0,
      });
    }
  }
}

function sanitizeVector(input, fallback) {
  return {
    x: finiteOr(input && input.x, fallback.x),
    y: finiteOr(input && input.y, fallback.y),
    z: finiteOr(input && input.z, fallback.z),
  };
}

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Smoke test online`);
});
