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
const zombies = new Map();
let zombieCounter = 0;
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
  };
}

function publicRound() {
  const counts = { battle: 0, coop: 0 };
  const voters = [];
  for (const vote of votes.values()) {
    if (counts[vote] !== undefined) counts[vote] += 1;
  }
  for (const [id, vote] of votes) {
    const player = players.get(id);
    voters.push({
      id,
      name: player ? player.name : `Player ${id.slice(0, 4)}`,
      vote,
    });
  }
  return {
    phase: round.phase,
    mode: round.mode,
    endsAt: round.endsAt,
    wave: round.wave,
    votes: counts,
    voters,
  };
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
    color: randomColor(),
    weapon: 'assault',
    health: 100,
    score: 0,
    position: { x: (Math.random() - 0.5) * 30, y: 2, z: (Math.random() - 0.5) * 30 },
    rotation: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    shooting: false,
    lastShotAt: 0,
  };

  players.set(socket.id, player);

  socket.emit('init', {
    id: socket.id,
    players: Array.from(players.values()).map(publicPlayer),
    round: publicRound(),
    zombies: Array.from(zombies.values()).map(publicZombie),
  });

  socket.broadcast.emit('playerJoined', publicPlayer(player));
  io.emit('playerCount', players.size);

  socket.on('playerUpdate', (state = {}) => {
    const current = players.get(socket.id);
    if (!current) return;

    if (state.position) current.position = sanitizeVector(state.position, current.position);
    if (state.rotation) current.rotation = sanitizeVector(state.rotation, current.rotation);
    if (state.velocity) current.velocity = sanitizeVector(state.velocity, current.velocity);
    if (typeof state.weapon === 'string') current.weapon = state.weapon;
    current.shooting = Boolean(state.shooting);
  });

  socket.on('setName', (name) => {
    const current = players.get(socket.id);
    if (!current) return;
    current.name = sanitizeName(name, current.name);
    io.emit('playerRenamed', { id: socket.id, name: current.name });
    io.emit('roundState', publicRound());
  });

  socket.on('shoot', (shot = {}) => {
    const current = players.get(socket.id);
    if (!current) return;

    current.weapon = typeof shot.weapon === 'string' ? shot.weapon : current.weapon;
    current.shooting = true;
    current.lastShotAt = Date.now();

    socket.broadcast.emit('remoteShot', {
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
    socket.broadcast.emit('grenade', {
      id: `${socket.id}-${Date.now()}`,
      ownerId: socket.id,
      origin: sanitizeVector(grenade.origin, current.position),
      velocity: sanitizeVector(grenade.velocity, { x: 0, y: 6, z: -12 }),
      at: Date.now(),
    });
  });

  socket.on('voteMode', (mode) => {
    if (round.phase !== 'voting') return;
    if (mode !== 'battle' && mode !== 'coop') return;
    votes.set(socket.id, mode);
    io.emit('roundState', publicRound());
  });

  socket.on('hit', ({ targetId, damage, weapon } = {}) => {
    const attacker = players.get(socket.id);
    const target = players.get(targetId);
    if (!attacker || !target || targetId === socket.id) return;

    const hitDamage = Math.max(0, Math.min(Number(damage) || 0, 100));
    target.health = Math.max(0, target.health - hitDamage);

    if (target.health <= 0) {
      attacker.score += 1;
      target.health = 100;
      target.position = {
        x: (Math.random() - 0.5) * 70,
        y: 2,
        z: (Math.random() - 0.5) * 70,
      };
      io.emit('playerRespawned', {
        id: targetId,
        by: socket.id,
        weapon,
        score: attacker.score,
        position: target.position,
        killerName: attacker.name,
        victimName: target.name,
      });
      io.emit('killFeed', {
        killerId: socket.id,
        victimId: targetId,
        killerName: attacker.name,
        victimName: target.name,
        weapon,
      });
    }

    io.emit('healthUpdate', {
      id: targetId,
      health: target.health,
      attackerId: socket.id,
      attackerScore: attacker.score,
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
      io.emit('zombieKilled', { id: zombieId, by: socket.id, score: attacker.score });
      io.emit('killFeed', {
        killerId: socket.id,
        victimId: zombieId,
        killerName: attacker.name,
        victimName: 'Zombie',
        weapon: 'zombie',
      });
    }
  });

  socket.on('disconnect', () => {
    players.delete(socket.id);
    votes.delete(socket.id);
    io.emit('playerLeft', socket.id);
    io.emit('playerCount', players.size);
    io.emit('roundState', publicRound());
  });
});

setInterval(() => {
  updateRound();
  updateZombies(1 / TICK_RATE);
  io.emit('state', Array.from(players.values()).map(publicPlayer));
  if (round.mode === 'coop') io.emit('zombies', Array.from(zombies.values()).map(publicZombie));
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
    startVoting();
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
  io.emit('roundState', publicRound());
  io.emit('zombies', []);
}

function startRound(mode) {
  zombies.clear();
  round = {
    phase: 'playing',
    mode,
    endsAt: Date.now() + BATTLE_SECONDS * 1000,
    wave: 0,
  };
  io.emit('roundState', publicRound());
  if (mode === 'coop') spawnWave();
}

function spawnWave() {
  if (round.mode !== 'coop') return;
  round.wave += 1;
  const count = Math.min(8 + round.wave * 3, 38);
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.6;
    const distance = 62 + Math.random() * 48;
    const zombie = {
      id: `z${++zombieCounter}`,
      health: 70 + round.wave * 12,
      position: { x: Math.cos(angle) * distance, y: 0, z: Math.sin(angle) * distance },
      velocity: { x: 0, y: 0, z: 0 },
      attackAt: 0,
    };
    zombies.set(zombie.id, zombie);
  }
  io.emit('roundState', publicRound());
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

    const speed = 3.3 + Math.min(round.wave * 0.28, 2.2);
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
        io.emit('playerRespawned', {
          id: nearest.id,
          by: 'zombie',
          weapon: 'claws',
          score: nearest.score,
          position: nearest.position,
          killerName: 'Zombie',
          victimName: nearest.name,
        });
        io.emit('killFeed', {
          killerId: 'zombie',
          victimId: nearest.id,
          killerName: 'Zombie',
          victimName: nearest.name,
          weapon: 'claws',
        });
      }
      io.emit('healthUpdate', {
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
  console.log("Server is now open to the network on port 3000. Players can connect using your local IP address.");
});