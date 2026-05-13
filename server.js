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
const DEFAULT_LOBBY = 'public';
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
  const maps = { hydro: 0, arcade: 0 };
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

function emitLobbyState(lobby = DEFAULT_LOBBY) {
  const room = lobbyRoom(lobby);
  const lobbyPlayers = playersInLobby(lobby);
  io.to(room).emit('state', lobbyPlayers.map(publicPlayer));
  io.to(room).emit('playerCount', lobbyPlayers.length);
  io.to(room).emit('roundState', publicRound(lobby));
  if (round.mode === 'coop') io.to(room).emit('zombies', Array.from(zombies.values()).map(publicZombie));
}

function activeLobbies() {
  const lobbies = new Set(Array.from(players.values()).map((player) => player.lobby || DEFAULT_LOBBY));
  if (!lobbies.size) lobbies.add(DEFAULT_LOBBY);
  return lobbies;
}

function emitAllLobbyStates() {
  for (const lobby of activeLobbies()) emitLobbyState(lobby);
}

function publicZombie(zombie) {
  return {
    id: zombie.id,
    health: zombie.health,
    position: zombie.position,
    velocity: zombie.velocity,
    attackAt: zombie.attackAt,
  };
}

function randomColor() {
  const hue = Math.floor(Math.random() * 360);
  return `hsl(${hue}, 72%, 58%)`;
}

io.on('connection', (socket) => {
  const player = {
    id: socket.id,
    name: `Player ${socket.id.slice(0, 4)}`,
    lobby: DEFAULT_LOBBY,
    color: randomColor(),
    weapon: 'assault',
    health: 100,
    score: 0,
    position: { x: (Math.random() - 0.5) * 30, y: 2, z: (Math.random() - 0.5) * 30 },
    rotation: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    shooting: false,
    lastShotAt: 0,
    updatedAt: Date.now(),
  };

  players.set(socket.id, player);
  socket.join(lobbyRoom(player.lobby));

  socket.emit('init', {
    id: socket.id,
    players: playersInLobby(player.lobby).map(publicPlayer),
    round: publicRound(player.lobby),
    zombies: Array.from(zombies.values()).map(publicZombie),
    lobby: player.lobby,
  });

  socket.to(lobbyRoom(player.lobby)).emit('playerJoined', publicPlayer(player));
  emitLobbyState(player.lobby);

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
  });

  socket.on('joinLobby', (lobbyName, callback) => {
    const current = players.get(socket.id);
    if (!current) return;
    const previousLobby = current.lobby || DEFAULT_LOBBY;
    const nextLobby = sanitizeLobby(lobbyName);
    if (previousLobby !== nextLobby) {
      socket.leave(lobbyRoom(previousLobby));
      socket.to(lobbyRoom(previousLobby)).emit('playerLeft', socket.id);
      current.lobby = nextLobby;
      socket.join(lobbyRoom(nextLobby));
      emitLobbyState(previousLobby);
    }
    socket.emit('init', {
      id: socket.id,
      players: playersInLobby(nextLobby).map(publicPlayer),
      round: publicRound(nextLobby),
      zombies: Array.from(zombies.values()).map(publicZombie),
      lobby: nextLobby,
    });
    socket.to(lobbyRoom(nextLobby)).emit('playerJoined', publicPlayer(current));
    emitLobbyState(nextLobby);
    if (typeof callback === 'function') callback({ lobby: nextLobby, players: playersInLobby(nextLobby).length });
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
    if (mapName !== 'hydro' && mapName !== 'arcade') return;
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
      target.position = {
        x: (Math.random() - 0.5) * 70,
        y: 2,
        z: (Math.random() - 0.5) * 70,
      };
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
    }
  });

  socket.on('disconnect', () => {
    const current = players.get(socket.id);
    const lobby = current ? current.lobby : DEFAULT_LOBBY;
    players.delete(socket.id);
    votes.delete(socket.id);
    mapVotes.delete(socket.id);
    io.to(lobbyRoom(lobby)).emit('playerLeft', socket.id);
    emitLobbyState(lobby);
  });
});

setInterval(() => {
  updateRound();
  updateZombies(1 / TICK_RATE);
  emitAllLobbyStates();
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

function startRound(mode) {
  zombies.clear();
  votes.clear();
  currentMap = getWinningMap();
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
  for (const vote of mapVotes.values()) {
    if (vote === 'hydro') hydro += 1;
    if (vote === 'arcade') arcade += 1;
  }
  return arcade > hydro ? 'arcade' : 'hydro';
}

function spawnWave() {
  if (round.mode !== 'coop') return;
  if (round.wave >= 6) {
    startVoting();
    return;
  }
  round.wave += 1;
  const count = Math.min(5 + round.wave * 2, 18);
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.6;
    const distance = 62 + Math.random() * 48;
    const zombie = {
      id: `z${++zombieCounter}`,
      health: 58 + round.wave * 10,
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

    const speed = 2.35 + Math.min(round.wave * 0.22, 1.4);
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
      nearest.health = Math.max(0, nearest.health - 9);
      if (nearest.health <= 0) {
        nearest.health = 100;
        nearest.position = {
          x: (Math.random() - 0.5) * 40,
          y: 2,
          z: (Math.random() - 0.5) * 40,
        };
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
