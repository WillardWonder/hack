/**
 * HACKNET BATTLE SERVER
 * Local:   node server.js  →  http://localhost:3000
 * Railway: deploy repo, open the generated URL — works automatically
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

// ── HTTP server (serves the client HTML) ──────────────────────────────────────
const httpServer = http.createServer((req, res) => {
  let filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);
  const mimeTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
    res.end(data);
  });
});

// ── Game State ────────────────────────────────────────────────────────────────
const GAME_STATES = { LOBBY: 'LOBBY', ACTIVE: 'ACTIVE', OVER: 'OVER' };

let game = createFreshGame();

function createFreshGame() {
  return {
    state: GAME_STATES.LOBBY,
    players: {},          // id -> player object
    log: [],              // global event log
    startTime: null,
    hostId: null,
  };
}

function createPlayer(id, alias, ws) {
  // Assign a fake IP in 10.0.x.x range
  const ip = `10.0.${randInt(1,254)}.${randInt(2,254)}`;
  const port = [22,80,443,3306,8080,8443,6379][randInt(0,6)];
  return {
    id, alias, ws,
    ip, openPort: port,
    hp: 100, maxHp: 100,
    shield: 0,           // set at game start based on join order
    maxShield: 0,
    energy: 100, maxEnergy: 100,
    kills: 0,
    alive: true,
    difficulty: 1,       // set at game start
    joinOrder: 0,
    attackCooldowns: {},  // atkId -> timestamp
    isBot: false,
  };
}

// ── Attacks Definition ────────────────────────────────────────────────────────
const ATTACKS = {
  probe: {
    id: 'probe', name: 'PORT SCAN', cmd: 'nmap',
    damage: [6, 12], cost: 8, cooldownMs: 3000, durationMs: 2500,
    hint: 'nmap -sV <target_ip>',
    phases: (t) => [
      `$ nmap -sV -T4 ${t.ip}`,
      `Starting Nmap 7.94 ( https://nmap.org )`,
      `Scanning ${t.ip} [1000 ports]`,
      `Discovered open port ${t.openPort}/tcp on ${t.ip}`,
      `PORT     STATE SERVICE  VERSION`,
      `${String(t.openPort).padEnd(8)} open  ${randomService()}`,
      `Nmap done: 1 IP scanned in 2.34s`,
    ]
  },
  sqli: {
    id: 'sqli', name: 'SQL INJECTION', cmd: 'sqlmap',
    damage: [14, 22], cost: 20, cooldownMs: 6000, durationMs: 4000,
    hint: 'sqlmap -u <target_ip>/login --dump',
    phases: (t) => [
      `$ sqlmap -u http://${t.ip}/api/login --level=3 --risk=2`,
      `[*] testing connection to target URL`,
      `[*] testing if POST parameter 'user' is dynamic`,
      `[+] POST parameter 'user' is dynamic`,
      `[*] heuristic (basic) test shows parameter 'user' might be injectable`,
      `[+] parameter 'user' is vulnerable — payload: ' OR 1=1--`,
      `[*] fetching database names`,
      `available databases: [users, sessions, logs]`,
      `[+] dumping table 'users' — ${randInt(40,200)} entries extracted`,
    ]
  },
  bof: {
    id: 'bof', name: 'BUFFER OVERFLOW', cmd: 'exploit',
    damage: [22, 38], cost: 35, cooldownMs: 10000, durationMs: 5500,
    hint: 'exploit --target <target_ip> --payload bof',
    phases: (t) => [
      `$ python3 exploit.py --host ${t.ip} --port ${t.openPort}`,
      `[*] Fuzzing buffer size: 64 128 256 512 1024...`,
      `[*] CRASH at offset 268! EIP overwrite confirmed`,
      `[*] Bad chars: \\x00 \\x0a \\x0d`,
      `[*] Searching for JMP ESP in loaded modules...`,
      `[+] Found: 0x625011af  (shell32.dll — no ASLR)`,
      `[*] Generating shellcode: msfvenom -p linux/x86/shell_reverse_tcp`,
      `\\x90\\x90\\x90\\x90\\x31\\xc0\\x50\\x68\\x2f\\x2f\\x73\\x68\\x68\\x2f\\x62\\x69\\x6e`,
      `[+] Sending payload (${randInt(320,512)} bytes)...`,
      `[*] Waiting for shell...`,
      `$ whoami`,
      `root`,
    ]
  },
  ddos: {
    id: 'ddos', name: 'DDoS FLOOD', cmd: 'flood',
    damage: [10, 18], cost: 22, cooldownMs: 8000, durationMs: 3500,
    hint: 'flood --type syn --target <target_ip> --pps 50000',
    phases: (t) => [
      `$ hping3 -S --flood -V -p ${t.openPort} ${t.ip}`,
      `HPING ${t.ip} (eth0 ${t.ip}): S set, 40 headers + 0 data bytes`,
      `[flood mode]: sending packets as fast as possible`,
      `${randInt(80000,200000)} packets transmitted, 0 received`,
      `round-trip min/avg/max = 0.1/847.3/∞ ms`,
      `[!] Target ${t.ip} UNREACHABLE — packet loss 100%`,
    ]
  },
  mitm: {
    id: 'mitm', name: 'MiTM INTERCEPT', cmd: 'arpspoof',
    damage: [18, 30], cost: 30, cooldownMs: 9000, durationMs: 4500,
    hint: 'arpspoof -i eth0 -t <target_ip> <gateway>',
    phases: (t) => {
      const gw = `10.0.${randInt(1,5)}.1`;
      const mac1 = randMac(); const mac2 = randMac();
      return [
        `$ arpspoof -i eth0 -t ${t.ip} ${gw}`,
        `${mac1} ${t.ip} is-at ${mac2}`,
        `${mac2} ${gw} is-at ${mac1}`,
        `[*] ARP cache poisoned on ${t.ip}`,
        `[*] Intercepting traffic — enabling IP forwarding`,
        `[*] Capturing packets via tcpdump...`,
        `${t.ip}.${randInt(1024,65535)} > ${gw}.443: Flags [S]`,
        `[+] SSL STRIPPING active — credentials exposed`,
        `[+] Captured: ${randHex(32)} (session token)`,
      ];
    }
  },
  rootkit: {
    id: 'rootkit', name: 'ROOTKIT', cmd: 'implant',
    damage: [35, 55], cost: 60, cooldownMs: 20000, durationMs: 7000,
    hint: 'implant --host <target_ip> --type lkm --persist',
    phases: (t) => [
      `$ python3 c2.py --deploy rootkit --target ${t.ip}`,
      `[*] Uploading LKM payload via SCP...`,
      `[*] Bypassing SELinux: setenforce 0`,
      `[*] Loading kernel module: insmod /tmp/.x32`,
      `[+] Module loaded — hooking sys_call_table at 0x${randHex(8)}`,
      `[*] Hiding process: PID ${randInt(1000,9999)}`,
      `[*] Installing persistence: /etc/cron.d/.update`,
      `[*] C2 beacon established: ${randInt(185,195)}.${randInt(100,254)}.${randInt(10,99)}.${randInt(2,99)}:4444`,
      `[+] ROOTKIT ACTIVE — full kernel-level access`,
      `[+] Target ${t.ip} permanently compromised`,
    ]
  },
};

// ── WebSocket Server ──────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  const id = generateId();
  ws.playerId = id;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      handleMessage(id, ws, msg);
    } catch(e) { console.error('Bad message', e); }
  });

  ws.on('close', () => {
    if (game.players[id]) {
      const alias = game.players[id].alias;
      delete game.players[id].ws;
      if (game.state === GAME_STATES.LOBBY) {
        delete game.players[id];
      } else {
        game.players[id].alive = false;
      }
      broadcast({ type: 'playerLeft', id, alias });
      broadcastGameState();
    }
  });

  // Send current state to new connection
  ws.send(JSON.stringify({ type: 'welcome', id, gameState: game.state }));
});

function handleMessage(id, ws, msg) {
  switch (msg.type) {

    case 'join': {
      if (game.state !== GAME_STATES.LOBBY) {
        ws.send(JSON.stringify({ type: 'error', msg: 'Game already in progress.' }));
        return;
      }
      const alias = sanitize(msg.alias || 'H4CK3R').toUpperCase().slice(0, 14);
      const player = createPlayer(id, alias, ws);
      player.joinOrder = Object.keys(game.players).length;
      if (player.joinOrder === 0) game.hostId = id;
      game.players[id] = player;
      broadcast({ type: 'playerJoined', id, alias, ip: player.ip, isHost: id === game.hostId });
      broadcastGameState();
      break;
    }

    case 'startGame': {
      if (id !== game.hostId) return;
      if (Object.keys(game.players).length < 2) {
        ws.send(JSON.stringify({ type: 'error', msg: 'Need at least 2 players.' }));
        return;
      }
      startGame();
      break;
    }

    case 'attack': {
      if (game.state !== GAME_STATES.ACTIVE) return;
      const attacker = game.players[id];
      if (!attacker || !attacker.alive) return;

      const { atkId, targetId } = msg;
      const atk = ATTACKS[atkId];
      const target = game.players[targetId];

      if (!atk || !target || !target.alive || targetId === id) return;

      // Check cooldown
      const now = Date.now();
      const lastUsed = attacker.attackCooldowns[atkId] || 0;
      if (now - lastUsed < atk.cooldownMs) {
        const remaining = Math.ceil((atk.cooldownMs - (now - lastUsed)) / 1000);
        ws.send(JSON.stringify({ type: 'cooldownError', atkId, remaining }));
        return;
      }

      // Check energy
      if (attacker.energy < atk.cost) {
        ws.send(JSON.stringify({ type: 'energyError', need: atk.cost, have: attacker.energy }));
        return;
      }

      // Deduct energy, set cooldown
      attacker.energy -= atk.cost;
      attacker.attackCooldowns[atkId] = now;

      // Generate log phases
      const phases = atk.phases(target);

      // Send animation phases to attacker
      ws.send(JSON.stringify({ type: 'hackBegin', atkId, atkName: atk.name, targetAlias: target.alias, targetIp: target.ip, phases, durationMs: atk.durationMs }));

      // After duration, resolve damage
      setTimeout(() => {
        if (!game.players[id] || !game.players[id].alive) return;
        if (!target.alive) return;

        const raw = randInt(atk.damage[0], atk.damage[1]);
        const armorMult = 1 / (1 + (target.difficulty - 1) * 0.28);
        const dmg = Math.max(1, Math.round(raw * armorMult));

        let shieldAbsorb = Math.min(target.shield, dmg);
        target.shield = Math.max(0, target.shield - shieldAbsorb);
        const hpDmg = dmg - shieldAbsorb;
        target.hp = Math.max(0, target.hp - hpDmg);

        const event = {
          type: 'attackResult',
          attackerId: id,
          attackerAlias: attacker.alias,
          targetId,
          targetAlias: target.alias,
          targetIp: target.ip,
          atkId,
          atkName: atk.name,
          totalDmg: dmg,
          shieldDmg: shieldAbsorb,
          hpDmg,
          targetHp: target.hp,
          targetShield: target.shield,
        };

        game.log.push(event);
        broadcast(event);

        if (target.hp <= 0) {
          eliminatePlayer(target, attacker);
        }

        broadcastGameState();
        checkWin();
      }, atk.durationMs);

      broadcastGameState();
      break;
    }

    case 'chat': {
      const p = game.players[id];
      if (!p) return;
      const text = sanitize(msg.text || '').slice(0, 80);
      broadcast({ type: 'chat', alias: p.alias, ip: p.ip, text });
      break;
    }

    case 'resetGame': {
      if (id !== game.hostId) return;
      game = createFreshGame();
      broadcast({ type: 'gameReset' });
      break;
    }
  }
}

function startGame() {
  game.state = GAME_STATES.ACTIVE;
  game.startTime = Date.now();

  // Assign difficulty & shields by join order
  const players = Object.values(game.players);
  players.sort((a,b) => a.joinOrder - b.joinOrder);
  players.forEach((p, i) => {
    p.difficulty = i + 1;
    p.maxShield = 60 + i * 30;
    p.shield = p.maxShield;
    p.hp = 100; p.maxHp = 100;
    p.energy = 100;
    p.alive = true;
    p.kills = 0;
    p.attackCooldowns = {};
  });

  broadcast({ type: 'gameStarted', players: serializePlayers() });
  broadcastGameState();

  // Energy regen tick
  setInterval(() => {
    if (game.state !== GAME_STATES.ACTIVE) return;
    Object.values(game.players).forEach(p => {
      if (!p.alive) return;
      p.energy = Math.min(p.maxEnergy, p.energy + 3);
      // slow shield regen
      if (p.shield < p.maxShield) p.shield = Math.min(p.maxShield, p.shield + 0.5);
    });
    broadcastGameState();
  }, 1000);
}

function eliminatePlayer(player, killer) {
  player.alive = false;
  player.hp = 0;
  player.shield = 0;
  killer.kills++;

  const event = { type: 'playerEliminated', id: player.id, alias: player.alias, ip: player.ip, killerId: killer.id, killerAlias: killer.alias };
  game.log.push(event);
  broadcast(event);

  // Notify eliminated player
  if (player.ws && player.ws.readyState === 1) {
    player.ws.send(JSON.stringify({ type: 'youEliminated', killerAlias: killer.alias }));
  }
}

function checkWin() {
  const alive = Object.values(game.players).filter(p => p.alive);
  if (alive.length === 1) {
    game.state = GAME_STATES.OVER;
    broadcast({ type: 'gameOver', winnerId: alive[0].id, winnerAlias: alive[0].alias });
  }
}

function broadcastGameState() {
  broadcast({ type: 'gameState', state: game.state, players: serializePlayers(), startTime: game.startTime });
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  Object.values(game.players).forEach(p => {
    if (p.ws && p.ws.readyState === 1) p.ws.send(data);
  });
}

function serializePlayers() {
  return Object.values(game.players).map(p => ({
    id: p.id, alias: p.alias, ip: p.ip, openPort: p.openPort,
    hp: p.hp, maxHp: p.maxHp,
    shield: Math.round(p.shield), maxShield: p.maxShield,
    energy: Math.round(p.energy), maxEnergy: p.maxEnergy,
    kills: p.kills, alive: p.alive, difficulty: p.difficulty,
    joinOrder: p.joinOrder,
  }));
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function randInt(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
function randHex(n) { let s=''; for(let i=0;i<n;i++) s+=Math.floor(Math.random()*16).toString(16); return s; }
function randMac() { return Array.from({length:6},()=>randHex(2)).join(':'); }
function generateId() { return randHex(8); }
function sanitize(s) { return s.replace(/[<>&"']/g,''); }
function randomService() {
  const svcs = ['ssh OpenSSH 8.2','http Apache 2.4.51','https nginx 1.21','mysql MySQL 8.0','redis Redis 6.2','ftp vsftpd 3.0'];
  return svcs[randInt(0, svcs.length-1)];
}

// ── Start ─────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, '0.0.0.0', () => {
  const railwayUrl = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : `http://localhost:${PORT}`;
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║   HACKNET BATTLE SERVER ONLINE       ║`);
  console.log(`║   ${railwayUrl.padEnd(38)}║`);
  console.log(`║   Share URL so players can join      ║`);
  console.log(`╚══════════════════════════════════════╝\n`);
});
