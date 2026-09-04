# HomeLab OS — Step-by-Step Setup Guide

This guide takes you from a fresh server to a fully running HomeLab OS dashboard that shows **your real
Proxmox nodes, VMs and containers** — no agents installed anywhere.

> **In a hurry?** Everything in 30 seconds: install Docker, `docker compose up -d`, open `http://<host>:3000`,
> sign in with the password printed in the container logs. The dashboard boots in **demo mode** (simulated
> data) so you can look around. Then follow [Part 2](#part-2-connect-your-real-proxmox-servers) to switch it
> to your real servers.

---

## How it works (read once, it saves time)

```
┌───────────────────────────────┐        ┌──────────────────────────────────────────────┐
│  Your Proxmox server          │        │  HomeLab OS (Docker)                          │
│                               │  HTTPS │                                              │
│  Proxmox VE (port 8006) ◀─────┼────────┼─ backend (:4000)  ──►  SQLite history         │
│  · nodes / qemu / lxc         │  API   │      │ polls every 5s                          │
│  · rrddata (cpu/net/load)     │  token │      ▼                                       │
│  · sensors (lm-sensors)       │        │  provider  ──►  REST /api + WebSocket /ws     │
│                               │        │                    │                          │
│                               │        │                    ▼                          │
│  No agent is installed here   │        │  Frontend SPA (:3000, nginx) ◀── your browser │
└───────────────────────────────┘        └──────────────────────────────────────────────┘
```

- **Pull-based, no agent.** HomeLab OS only *reads* from the Proxmox REST API. Nothing is installed on your
  Proxmox host and you never open its SSH port to the dashboard.
- The backend discovers **all nodes** (the "servers" in the UI) and **all VMs/containers** automatically,
  and shows live CPU, RAM, disk, network and (when available) temperature/fan/power sensors.
- In **demo mode** (`MOCK_MODE=true`, the default) the same UI runs on a believable simulated fleet so you
  can evaluate the app before touching your hypervisor.

---

## Prerequisites

| Requirement | Minimum | Notes |
| --- | --- | --- |
| A Linux server / VM | 1 CPU, 1 GB RAM, 5 GB disk | Can be a container on your Proxmox host |
| Docker Engine + Compose plugin | Docker 24+, Compose v2 | `docker compose version` must work |
| Proxmox VE | 6.x, 7.x or 8.x | The API we poll is the same across versions |
| A browser | Any modern browser | Chrome / Firefox / Edge / Safari |

> **Not using Docker?** Jump to [Appendix A — Run without Docker](#appendix-a--run-without-docker).

Check your tools:

```bash
docker --version && docker compose version
```

---

## Part 1 — Install the dashboard

### 1.1 Get the source

```bash
cd /opt
git clone https://github.com/johnvexcoder/HomeLab-OS.git
cd HomeLab-OS
```

> The GitHub **Releases** page always carries the exact source snapshot of the version you run, so you can
> rebuild or downgrade later. See [Part 7 — Updating](#part-7--updating).

### 1.2 Configure `.env`

```bash
cp .env.example .env
```

Edit `.env` and set a **strong admin password** you will use on first login:

```dotenv
ADMIN_INITIAL_PASSWORD=ChangeMe_To_A_Long_Random_Password
SECRET_ENCRYPTION_KEY=ChangeMe_Too_A_Long_Random_String_Of_32Plus_Characters
```

- `ADMIN_INITIAL_PASSWORD` — password of the `admin` account created on first boot.
- `SECRET_ENCRYPTION_KEY` — encrypts stored credentials (integration tokens, recovery email). Use a long
  random string and **keep it safe** — losing it means stored credentials can’t be decrypted.

### 1.3 Start the stack

```bash
docker compose up --build -d
```

Then grab the container logs to confirm both services are healthy:

```bash
docker compose ps
docker compose logs backend | head -20
```

You should see `[homelab] backend listening on http://0.0.0.0:4000` and `mock mode: true`.

### 1.4 Sign in (demo mode)

Open **http://<your-host>:3000** and sign in:

| Field | Value |
| --- | --- |
| Username | `admin` |
| Password | the `ADMIN_INITIAL_PASSWORD` you set (if you left it empty, read `docker compose exec backend cat /data/.admin-initial-password`) |

You now have a fully working dashboard showing a **simulated** fleet — every tab (Dashboard, Servers, Network
Map, Sensors, Alerts, Settings) works. Look around; the real data comes next.

> **Delete the initial password file** after first login:
> `docker compose exec backend rm -f /data/.admin-initial-password`

---

## Part 2 — Connect your real Proxmox servers

The dashboard reads Proxmox through an **API token**. The token only needs *read* access — create it with
the **PVEAuditor** role (view everything, change nothing). The dashboard reads *four* kinds of data, and the
token needs read privileges for each:

| Data | PVE endpoint | Required privilege |
|---|---|---|
| Node CPU / RAM / uptime / OS | `GET /nodes`, `GET /nodes/{node}/status` | `Sys.Audit` |
| VMs & containers (map + quick stats) | `GET /nodes/{node}/qemu`, `GET /nodes/{node}/lxc` | `VM.Audit` |
| Network interfaces / IPs | `GET /nodes/{node}/network` | `Sys.Audit` |
| Sensors + RRD history | `GET /nodes/{node}/sensors`, `.../rrddata` | `Sys.Audit` |

**PVEAuditor** includes all of the above. If a metric row shows zeros while the node itself is listed
as online, the token is missing one of these privileges (see *Troubleshooting* in §2.5).

### 2.1 Create an API token in Proxmox

1. Open the **Proxmox web UI** (https://your-proxmox:8006) and log in.
2. Select **Datacenter** in the left tree.
3. Click **Permissions → API Tokens** in the left panel.
4. Click **Add**:
   - **User ID**: pick a user with access to your nodes. `root@pam` works if you use it elsewhere, but the
     cleaner option is a dedicated user. If you create a new user (`Permissions → Users → Add`) give it the
     **PVEAuditor** role and no password (API-token only).
   - **Token ID**: `homelab` (or anything you like).
   - **Privilege Separation**: leave it **unticked** unless you know you need it. If you do tick it, the
     separated token has *no* privileges until you add ACL entries — grant at least `Sys.Audit` and `VM.Audit`
     on the datacenter/node path, otherwise the dashboard shows zeroed metrics (see Troubleshooting).
5. Click **Add**.
6. Proxmox shows the token secret **once**:
   ```
   Token ID:     root@pam!homelab
   Secret:       5f3a8e1b-...-xxxxxxxx
   ```
   Copy both — the secret cannot be recovered later (only regenerated).

### 2.2 Point the backend at Proxmox

Edit `.env` and fill in the Proxmox block:

```dotenv
# Turn OFF simulated data
MOCK_MODE=false

# Your Proxmox host: https://<host-or-ip>:8006
PROXMOX_HOST=192.168.1.10:8006

# From step 2.1 — user@realm!tokenname
PROXMOX_TOKEN_ID=root@pam!homelab

# The secret shown once when the token was created
PROXMOX_TOKEN_SECRET=5f3a8e1b-...-xxxxxxxx

# Proxmox uses a self-signed certificate by default.
# Leave false (accept self-signed); set true only with a real CA cert.
PROXMOX_VERIFY_TLS=false

# Poll cadence in milliseconds (5s is fine)
PROXMOX_POLL_INTERVAL_MS=5000

# --- Optional: Docker container monitoring (see §2.6) ---
# DOCKER_ENABLED=false
# DOCKER_HOST=/var/run/docker.sock   # unix socket, or tcp://host:2375
# DOCKER_HOST_GUEST=docker           # name of the PVE guest that hosts Docker
```

### 2.3 Restart the backend

```bash
docker compose up -d backend
docker compose logs backend --tail=20
```

You should see:

```
[homelab] proxmox provider active (192.168.1.10:8006)
[homelab] backend listening on http://0.0.0.0:4000
[homelab] mock mode: false
```

### 2.4 Verify real data

1. In the dashboard, open **Servers**. Your Proxmox **nodes** are now the servers (e.g. `pve1`, `pve2`).
2. Open the **Network Map** — you'll see `Internet → your nodes → each VM/container` (green = running,
   grey/red = stopped).
    > **Where's "docker"?** Two layers:
    > - `docker01` (a VM) appears as a child of its node once the PVE token has `VM.Audit` (see §2.5).
    > - The `docker01 → containers` layer needs the Docker provider — enable it with `DOCKER_ENABLED=true`
    >   (see §2.6) and turn on the **Docker Monitoring** feature flag in Configuration → Features.
3. The **Dashboard** stats switch to Nodes / VMs & CTs / Avg CPU / Memory / Network — all live.
4. Check the public liveness endpoint:

   ```bash
   curl -s http://localhost:3000/api/health
   # {"status":"ok","mockMode":false,"demoCredentials":false,...}
   ```

> **Not seeing your nodes?** If `mockMode` is still `true`, the `.env` change didn’t reach the container —
> restart with `docker compose up -d backend` (the `-d` flag is required to apply environment changes), or
> re-create with `docker compose up -d --force-recreate backend`.

### 2.5 Troubleshooting — node online but all metrics are zero

Symptom: the Servers page lists your node as **online**, but RAM/Disk show `0 GB`, the CPU model says
`Unknown CPU`, uptime is `0`, and the Network Map only shows the node — no VMs/containers.

Cause: the node list endpoint (`/nodes`) is readable with minimal privileges, but the *per-node* endpoints
that carry CPU model, memory, disk, uptime, guests and sensors need `Sys.Audit` / `VM.Audit`. A
privilege-separated token (or a token whose user lacks `PVEAuditor`) gets exactly this partial view.

1. Sign in and inspect the provider diagnostics banner on the **Servers** or **Network** page. Detailed
   diagnostics are served by authenticated `/api/diagnostics`; the public `/api/health` endpoint intentionally
   exposes only coarse liveness information.
2. In Proxmox open **Datacenter → Permissions → API Tokens**, edit the token:
   - **Privilege Separation**: untick it, **or**
   - Add ACL entries granting `Sys.Audit` and `VM.Audit` on `/` (or on the specific node path).
3. Give the token's user the **PVEAuditor** role at the datacenter level if it isn’t already.
4. Wait for the next poll (default 5 s) or restart the backend (`docker compose restart backend`).

### 2.6 Optional — Docker container monitoring

For production, install HomeLab Agent on the Docker host. The supplied dashboard Compose file deliberately
does not mount `/var/run/docker.sock`, because access to that socket is equivalent to host control. Leave the
backend's direct `DOCKER_ENABLED=false`; agent reports are merged into the same topology and container cards.

The legacy direct provider remains available for development, but it must use a constrained socket proxy or
mutually authenticated TLS endpoint. Never expose an unauthenticated Docker TCP socket.

### 2.7 Optional — temperature / fan sensors

Proxmox exposes `lm-sensors` telemetry only if the host has it installed. On each Proxmox node (SSH):

```bash
apt install lm-sensors
sensors-detect --auto
```

After the next poll, the **Sensors** tab and the per-server sensor grid show real CPU temperature, fan RPM
and power draw. Nodes without sensors simply show "Not Available" — no fake zeros. (If the PVE server
reports `501` for `/nodes/<node>/sensors`, its API simply has no sensor endpoint — the provider disables
that endpoint automatically instead of reporting an error.)

---

## Part 3 — Secure access (HTTPS + reverse proxy)

The dashboard ships ready to sit behind a reverse proxy (nginx, Caddy or Traefik). The frontend container
already serves the app and proxies `/api` + `/ws`, so you only forward a hostname.

### 3.1 Example nginx config (with Let's Encrypt)

```nginx
server {
    listen 443 ssl http2;
    server_name dashboard.example.com;

    ssl_certificate     /etc/letsencrypt/live/dashboard.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dashboard.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Required for live telemetry (WebSocket)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### 3.2 Tell the backend it's behind HTTPS

In `.env`:

```dotenv
NODE_ENV=production
COOKIE_SECURE=true
```

Then restart: `docker compose up -d backend`.

> Without this, login still works but the session cookie is sent without the `Secure` flag. Behind HTTPS
> you should always enable it.

---

## Part 4 — Telegram notifications (optional)

> **Honest status:** the Telegram integration stores and encrypts your bot token and lets you **test** the
> connection, but **real automated message delivery is still under development**. Completing this section
> gets you a fully configured integration; delivery arrives in a future release.

### 4.1 Create a bot

1. Open Telegram, search for **@BotFather** and start a chat.
2. Send `/newbot`, follow the prompts, and copy the **bot token** (`1234567890:AAH...`).
3. Optionally send `/setcommands` — the bot responds to nothing yet; this is preparation for delivery.

### 4.2 Create an integration in the dashboard

1. Go to **Configuration → Integrations → New integration**.
2. Choose **Telegram**, name it (e.g. `homelab-bot`).
3. Paste the bot token from BotFather.
4. Save. The token is encrypted at rest with `SECRET_ENCRYPTION_KEY`.
5. Click **Test** — a connection check runs against Telegram's API and reports success/failure.

> Never put the token in `.env` or any file that gets committed; the Settings UI is the right place.

---

## Part 5 — Email / SMTP (OTP + recovery codes)

Email is the delivery channel for **2FA one-time passwords** and **account recovery links**. This one is
fully functional today.

### 5.1 Enable the email feature

1. **Configuration → Integrations → New integration → Email** (feature flag `email_notifications`).
2. Fill in your SMTP server:
   - Host, port (`587` STARTTLS, `465` implicit TLS, or `25` plaintext)
   - Username + password (app passwords for Gmail work)
   - From-address (e.g. `homelab@example.com`)
3. Save and click **Test** — it performs a real SMTP connectivity check (server reachable + SMTP greeting);
   the "send a test email" delivery path is pending. Alert delivery is not wired up yet.

### 5.2 Optional — 2FA & recovery

1. Set a **security question** and **recovery email** for your account (Configuration → Security / your
   account page).
2. Enable **two-factor authentication** — OTP codes arrive by email when SMTP is configured.
3. If you ever get locked out, the recovery email is used to regain access.

---

## Part 6 — Roles, guest mode & backups

- **Roles** — `SUPER_ADMIN` (everything), `OPERATOR` (ops settings + integrations), `VIEWER` (read-only),
  `GUEST` (unauthenticated read-only, off by default). Managed in **Configuration → Users**.
- **Guest mode** — if you want a public read-only dashboard, enable it in **Configuration → Access** and
  scope exactly which data is exposed.
- **Backups** — **Configuration → Backups** snapshots the SQLite database (settings, history, credentials).
  Restore from a `.bak` file anytime.

---

## Part 7 — Updating

The backend keeps an **original source snapshot for every release**, so updates are safe and reversible.

```bash
cd /opt/HomeLab-OS
git fetch --tags
git checkout vX.Y.Z          # the version you want (see GitHub Releases)
docker compose up -d --build
```

- Want the **first release's source** back? `git checkout v1.0.15` and rebuild.
- To go back to a previous version, check out its tag and run the same two commands.
- History is stored in the `homelab-data` volume, so charts and settings survive rebuilds.

---

## Part 8 — Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `/api/health` shows `mockMode: true` | `.env` change didn't reach the container | `docker compose up -d --force-recreate backend` |
| Provider diagnostics show `lastPollError` | Token wrong, host unreachable, or 401 | Check the authenticated diagnostics banner; recreate the token; verify `PROXMOX_HOST` includes port 8006 |
| All nodes show **offline** | Backend can't reach Proxmox (network/firewall) | Allow the dashboard's IP to reach port 8006 on Proxmox (`pve-firewall` / datacenter firewall) |
| `401 unable to authenticate` | Token ID/secret mismatch | Token IDs are `user@realm!name`; recreate the token to get a fresh secret |
| VMs/CTs missing from Network Map | Guests stopped | Stopped guests still appear (grey); if entire map is empty, check `lastPollError` |
| No sensors shown | `lm-sensors` not installed on the node | `apt install lm-sensors` on the Proxmox node (2.5) |
| Login fails after update | Session cookie pre-dates the secret key | Re-login; cookies from an old `SECRET_ENCRYPTION_KEY` are invalidated |
| Locked out / forgot admin password | — | `docker compose exec backend node dist/cli/dashboardctl.js reset-admin` (dev: `npm run dashboardctl -w backend -- reset-admin`) |

### Known limitations (current version)

- **Telegram**: integration + connection test work; real message delivery is in development.
- Sensors appear only when the Proxmox host exposes them via `lm-sensors`.
- The provider polls — there is no "live SSH" or agent push; data refreshes every `PROXMOX_POLL_INTERVAL_MS`.

---

## Appendix A — Run without Docker

Needs Node.js ≥ 24 and npm ≥ 11 on the machine.

```bash
git clone https://github.com/johnvexcoder/HomeLab-OS.git && cd HomeLab-OS
npm install
cp .env.example .env          # edit values as in Part 1 / Part 2
npm run build                  # compiles backend + frontend
npm run start -w backend       # backend on :4000
```

Then serve the built frontend (`frontend/dist`) from any static server with `/api` and `/ws` proxied to
`http://127.0.0.1:4000` (the `frontend/nginx.conf` in the repo shows the exact proxy rules). For
development with hot reload: `npm run dev` (frontend at :5173, proxies to backend).

---

## Appendix B — Environment reference

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | Backend port |
| `HOST` | `0.0.0.0` | Backend bind address |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed browser origins |
| `DEPLOYMENT_PROFILE` | `development` | `development`, private-LAN `lan`, or TLS `hardened` |
| `DASHBOARD_BIND_ADDRESS` | `127.0.0.1` | Published Compose bind address; use `0.0.0.0` only with a LAN firewall |
| `DATA_DIR` | `./data` | SQLite, backups, secrets |
| `MOCK_MODE` | `true` | `true` demo data · `false` live Proxmox |
| `DEMO_RESET_ADMIN` | `false` | Explicit disposable-demo admin reset; development profile only |
| `TELEMETRY_INTERVAL_MS` | `2000` | Demo-mode tick rate |
| `HISTORY_RETENTION_HOURS` | `24` | Demo history window |
| `PROXMOX_HOST` | — | Proxmox API host (`host:8006`) |
| `PROXMOX_TOKEN_ID` | — | Proxmox API token ID |
| `PROXMOX_TOKEN_SECRET` | — | Proxmox API token secret |
| `PROXMOX_VERIFY_TLS` | `false` | Validate Proxmox TLS chain |
| `PROXMOX_POLL_INTERVAL_MS` | `5000` | Poll cadence (ms) |
| `DOCKER_ENABLED` | `false` | Read containers from the Docker Engine |
| `DOCKER_HOST` | `/var/run/docker.sock` | Docker socket path or `tcp://host:2375` |
| `DOCKER_HOST_GUEST` | `docker` | PVE guest name hosting Docker (map placement) |
| `DOCKER_POLL_INTERVAL_MS` | `10000` | Docker poll cadence (ms) |
| `SECRET_ENCRYPTION_KEY` | — | Encrypts stored credentials (set it!) |
| `ADMIN_INITIAL_PASSWORD` | — | First-boot admin password (random if empty) |
| `COOKIE_SECURE` | `false` | `Secure` session cookie (behind HTTPS) |
| `NODE_ENV` | `production` | Runtime optimization flag; transport policy is controlled separately |

Full list with comments: `.env.example` at the repo root.
