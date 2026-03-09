# HACKNET BATTLE ARENA v2.0

Real-time multiplayer hacking battle game for 2-6 players.

---

## DEPLOY TO RAILWAY (free, permanent URL)

### Step 1 - Push to GitHub
1. Create a free account at https://github.com
2. Create a new repository (e.g. "hacknet-battle")
3. Upload all files into the repo - drag and drop on GitHub works fine

Your repo should look like:
```
hacknet-battle/
  server.js
  package.json
  package-lock.json
  railway.toml
  public/
    index.html
```

### Step 2 - Deploy on Railway
1. Go to https://railway.app and sign up (free, no credit card needed)
2. Click "New Project" -> "Deploy from GitHub repo"
3. Select your hacknet-battle repo
4. Railway auto-detects Node.js and deploys in ~60 seconds
5. Click your deployment -> "Settings" -> "Generate Domain"
6. You get a URL like: https://hacknet-battle-production.up.railway.app

### Step 3 - Play!
Share that URL with everyone. Players just open it, enter an alias, and join.
No IP addresses, no port forwarding needed.

---

## RUN LOCALLY (same WiFi)

Requirements: Node.js 16+ from https://nodejs.org

```bash
npm install
node server.js
```

Find your IP: run "ipconfig" (Windows) or "ifconfig" (Mac/Linux)
Share: http://YOUR_LOCAL_IP:3000

---

## HOW TO PLAY

Left panel    - Network map + node cards. Click a node to target it.
Terminal      - Type commands. Tab autocompletes. Up/Down = history.
Right panel   - Stats, exploit buttons, packet stream, activity log.

ATTACK COMMANDS
  nmap -sV <ip>           Port Scan        8 energy   6-12 dmg
  sqlmap -u <ip>/login    SQL Injection    20 energy  14-22 dmg
  exploit --target <ip>   Buffer Overflow  35 energy  22-38 dmg
  flood --type syn <ip>   DDoS Flood       22 energy  10-18 dmg
  arpspoof -t <ip>        MiTM Intercept   30 energy  18-30 dmg
  implant --host <ip>     Rootkit Deploy   60 energy  35-55 dmg

OTHER COMMANDS: help, scan, status, target <alias>, whois <alias>,
                ifconfig, netstat, hex, chat <msg>, history, clear

PROGRESSIVE DIFFICULTY
  Player 1 (host): 60 shield, no armor bonus
  Player 2: 90 shield, 28% damage reduction
  Player 3: 120 shield, 56% damage reduction  (etc.)

Win by eliminating every other node.
