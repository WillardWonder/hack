const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

// ── HTTP server ───────────────────────────────────────────────────────────────
const httpServer = http.createServer((req, res) => {
  let filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain' });
    res.end(data);
  });
});

// ── Game state ────────────────────────────────────────────────────────────────
let game = freshGame();

function freshGame() {
  return { state: 'LOBBY', players: {}, hostId: null, startTime: null };
}

function makePlayer(id, alias, ws) {
  const ip = `10.0.${ri(1,254)}.${ri(2,254)}`;
  const port = [22,80,443,3306,8080,8443][ri(0,5)];
  return { id, alias, ws, ip, openPort: port,
    hp:100, maxHp:100, shield:0, maxShield:0,
    energy:100, maxEnergy:100, kills:0, alive:true,
    difficulty:1, joinOrder:0, cooldowns:{} };
}

// ── Attacks ───────────────────────────────────────────────────────────────────
const ATTACKS = {
  probe:   { dmg:[6,12],   cost:8,  cd:3000,  dur:2500,
    phases: t => [`$ nmap -sV -T4 ${t.ip}`,`Starting Nmap 7.94`,`Scanning ${t.ip} [1000 ports]`,`Discovered open port ${t.openPort}/tcp`,`PORT     STATE SERVICE`,`${String(t.openPort).padEnd(8)} open  ${rSvc()}`,`Nmap done: 1 IP in 2.34s`] },
  sqli:    { dmg:[14,22],  cost:20, cd:6000,  dur:4000,
    phases: t => [`$ sqlmap -u http://${t.ip}/api/login --level=3`,`[*] testing connection`,`[*] POST parameter 'user' is dynamic`,`[+] 'user' injectable — payload: ' OR 1=1--`,`[*] fetching databases`,`available: [users, sessions, logs]`,`[+] dumping 'users' — ${ri(40,200)} entries extracted`] },
  bof:     { dmg:[22,38],  cost:35, cd:10000, dur:5500,
    phases: t => [`$ python3 exploit.py --host ${t.ip} --port ${t.openPort}`,`[*] Fuzzing: 64 128 256 512 1024`,`[*] CRASH at offset 268! EIP overwrite confirmed`,`[*] Bad chars: \\x00 \\x0a \\x0d`,`[*] JMP ESP: 0x625011af (shell32.dll — no ASLR)`,`[*] Shellcode: msfvenom linux/x86/shell_reverse_tcp`,`\\x90\\x90\\x31\\xc0\\x50\\x68\\x2f\\x2f\\x73\\x68\\x89\\xe3`,`[+] Sending ${ri(320,512)} bytes...`,`$ whoami`,`root`] },
  ddos:    { dmg:[10,18],  cost:22, cd:8000,  dur:3200,
    phases: t => [`$ hping3 -S --flood -p ${t.openPort} ${t.ip}`,`HPING ${t.ip}: S set, 40 headers + 0 data bytes`,`[flood mode]: sending as fast as possible`,`${ri(80000,220000)} packets tx, 0 received`,`round-trip: 0.1/847/∞ ms`,`[!] Target UNREACHABLE — packet loss 100%`] },
  mitm:    { dmg:[18,30],  cost:30, cd:9000,  dur:4400,
    phases: t => { const gw=`10.0.${ri(1,4)}.1`; return [`$ arpspoof -i eth0 -t ${t.ip} ${gw}`,`${rMac()} ${t.ip} is-at ${rMac()}`,`[*] ARP cache poisoned`,`[*] Intercepting — IP forwarding enabled`,`[+] SSL STRIPPING active`,`[+] Captured: ${rHex(32)} (session token)`]; } },
  rootkit: { dmg:[35,55],  cost:60, cd:20000, dur:7000,
    phases: t => [`$ python3 c2.py --deploy rootkit --target ${t.ip}`,`[*] Uploading LKM payload...`,`[*] Bypassing SELinux: setenforce 0`,`[*] insmod /tmp/.x32`,`[+] Hooked sys_call_table at 0x${rHex(8)}`,`[*] Hiding PID ${ri(1000,9999)}`,`[*] Persistence: /etc/cron.d/.update`,`[*] C2: ${ri(185,195)}.${ri(100,254)}.${ri(10,99)}.${ri(2,99)}:4444`,`[+] ROOTKIT ACTIVE`] },
};

// ── WebSocket ─────────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', ws => {
  const id = rHex(8);
  ws.playerId = id;

  ws.on('message', raw => {
    try { onMsg(id, ws, JSON.parse(raw)); } catch(e) { console.error(e); }
  });

  ws.on('close', () => {
    if (!game.players[id]) return;
    const alias = game.players[id].alias;
    delete game.players[id].ws;
    if (game.state === 'LOBBY') delete game.players[id];
    else game.players[id].alive = false;
    bcast({ type:'playerLeft', id, alias });
    bcastState();
  });

  ws.send(JSON.stringify({ type:'welcome', id, gameState: game.state }));
});

function onMsg(id, ws, msg) {
  const send = obj => ws.send(JSON.stringify(obj));

  switch (msg.type) {
    case 'join': {
      if (game.state !== 'LOBBY') { send({ type:'error', msg:'Game in progress.' }); return; }
      const alias = (msg.alias||'H4CK3R').replace(/[<>&"']/g,'').toUpperCase().slice(0,14);
      const p = makePlayer(id, alias, ws);
      p.joinOrder = Object.keys(game.players).length;
      if (p.joinOrder === 0) game.hostId = id;
      game.players[id] = p;
      bcast({ type:'playerJoined', id, alias, ip:p.ip, isHost: id===game.hostId });
      bcastState();
      break;
    }

    case 'startGame': {
      if (id !== game.hostId) return;
      if (Object.keys(game.players).length < 2) { send({ type:'error', msg:'Need at least 2 players.' }); return; }
      startGame();
      break;
    }

    case 'attack': {
      if (game.state !== 'ACTIVE') return;
      const attacker = game.players[id];
      if (!attacker?.alive) return;
      const { atkId, targetId } = msg;
      const atk = ATTACKS[atkId];
      const target = game.players[targetId];
      if (!atk || !target?.alive || targetId === id) return;

      const now = Date.now();
      const lastUsed = attacker.cooldowns[atkId] || 0;
      if (now - lastUsed < atk.cd) {
        send({ type:'cooldownError', atkId, remaining: Math.ceil((atk.cd-(now-lastUsed))/1000) }); return;
      }
      if (attacker.energy < atk.cost) {
        send({ type:'energyError', need:atk.cost, have:attacker.energy }); return;
      }

      attacker.energy -= atk.cost;
      attacker.cooldowns[atkId] = now;
      const phases = atk.phases(target);
      send({ type:'hackBegin', atkId, atkName:atkId, targetAlias:target.alias, targetIp:target.ip, phases, durationMs:atk.dur });
      bcastState();

      setTimeout(() => {
        if (!game.players[id]?.alive || !target.alive) return;
        const dmg = Math.max(1, Math.round(ri(atk.dmg[0],atk.dmg[1]) / (1+(target.difficulty-1)*0.28)));
        const shieldDmg = Math.min(target.shield, dmg);
        target.shield = Math.max(0, target.shield - shieldDmg);
        target.hp = Math.max(0, target.hp - (dmg - shieldDmg));

        bcast({ type:'attackResult', attackerId:id, attackerAlias:attacker.alias,
          targetId, targetAlias:target.alias, targetIp:target.ip,
          atkId, atkName:atkId, totalDmg:dmg, shieldDmg, hpDmg:dmg-shieldDmg,
          targetHp:target.hp, targetShield:target.shield });

        if (target.hp <= 0) elimPlayer(target, attacker);
        bcastState();
        checkWin();
      }, atk.dur);
      break;
    }

    case 'chat': {
      const p = game.players[id];
      if (!p) return;
      bcast({ type:'chat', alias:p.alias, ip:p.ip, text:(msg.text||'').replace(/[<>&"']/g,'').slice(0,80) });
      break;
    }

    case 'resetGame': {
      if (id !== game.hostId) return;
      game = freshGame();
      bcast({ type:'gameReset' });
      break;
    }
  }
}

function startGame() {
  game.state = 'ACTIVE';
  game.startTime = Date.now();
  const players = Object.values(game.players).sort((a,b) => a.joinOrder - b.joinOrder);
  players.forEach((p,i) => {
    p.difficulty = i+1;
    p.maxShield = 60 + i*30;
    p.shield = p.maxShield;
    p.hp = 100; p.maxHp = 100;
    p.energy = 100; p.alive = true; p.kills = 0; p.cooldowns = {};
  });
  bcast({ type:'gameStarted', players: serialized() });
  bcastState();

  setInterval(() => {
    if (game.state !== 'ACTIVE') return;
    Object.values(game.players).forEach(p => {
      if (!p.alive) return;
      p.energy = Math.min(p.maxEnergy, p.energy+3);
      if (p.shield < p.maxShield) p.shield = Math.min(p.maxShield, p.shield+0.5);
    });
    bcastState();
  }, 1000);
}

function elimPlayer(player, killer) {
  player.alive = false; player.hp = 0; player.shield = 0;
  killer.kills++;
  bcast({ type:'playerEliminated', id:player.id, alias:player.alias, ip:player.ip, killerId:killer.id, killerAlias:killer.alias });
  if (player.ws?.readyState === 1) player.ws.send(JSON.stringify({ type:'youEliminated', killerAlias:killer.alias }));
}

function checkWin() {
  const all = Object.values(game.players);
  const alive = all.filter(p => p.alive);
  // Need at least 2 total players and exactly 1 left alive
  if (all.length < 2 || alive.length !== 1) return;
  game.state = 'OVER';
  bcast({ type:'gameOver', winnerId:alive[0].id, winnerAlias:alive[0].alias });
}

function bcastState() {
  bcast({ type:'gameState', state:game.state, players:serialized(), startTime:game.startTime });
}

function bcast(msg) {
  const data = JSON.stringify(msg);
  Object.values(game.players).forEach(p => {
    if (p.ws?.readyState === 1) p.ws.send(data);
  });
}

function serialized() {
  return Object.values(game.players).map(p => ({
    id:p.id, alias:p.alias, ip:p.ip, openPort:p.openPort,
    hp:p.hp, maxHp:p.maxHp,
    shield:Math.round(p.shield), maxShield:p.maxShield,
    energy:Math.round(p.energy), maxEnergy:p.maxEnergy,
    kills:p.kills, alive:p.alive, difficulty:p.difficulty, joinOrder:p.joinOrder,
  }));
}

function ri(a,b) { return Math.floor(Math.random()*(b-a+1))+a; }
function rHex(n) { let s=''; for(let i=0;i<n;i++) s+=Math.floor(Math.random()*16).toString(16); return s; }
function rMac() { return Array.from({length:6},()=>rHex(2)).join(':'); }
function rSvc() { return ['ssh OpenSSH 8.2','http Apache 2.4.51','https nginx 1.21','mysql MySQL 8.0','redis 6.2','ftp vsftpd 3.0'][ri(0,5)]; }

httpServer.listen(PORT, '0.0.0.0', () => {
  const url = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${PORT}`;
  console.log(`\nHACKNET SERVER ONLINE → ${url}\n`);
});
