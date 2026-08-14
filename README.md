<p align="center">
  <img src="frontend/public/favicon.svg" width="72" alt="HomeLab OS icon" />
</p>

<h1 align="center">HomeLab OS</h1>

<p align="center">
  A premium, production-quality <b>self-hosted Infrastructure Operating System</b> — a live
  Network Operations Center (NOC) dashboard for your homelab. Not a homepage, not a link-aggregator.
  A real-time observability surface with animated telemetry, optional hardware sensors, and an
  architecture designed to swap mock data for real integrations (Proxmox, Docker, Uptime Kuma,
  Node Exporter, Prometheus) without redesign.
</p>

<p align="center">
  <b>v1.0.15</b> ·
  <img src="https://img.shields.io/badge/React_18-TS_5-Vite_6-34D399" alt="React 18 · TypeScript · Vite" />
  <img src="https://img.shields.io/badge/Express-WS-SQLite-34D399" alt="Express · WebSocket · SQLite" />
  <img src="https://img.shields.io/badge/Tailwind-Framer_Motion-ECharts-34D399" alt="Tailwind · Framer Motion · ECharts" />
</p>

---

## Screenshots

| | |
| --- | --- |
| ![Dashboard](img/dashboard.png) | ![Network map](img/network-map.png) |
| ![Server overview](img/server-overview.png) | ![Link status & hosts](img/link-status_and_hosts.png) |
| ![Alert feed](img/alert-page.png) | ![Login](img/login-page.png) |

---

## Screens

| Route | Purpose |
| --- | --- |
| `/` | **Dashboard** — greeting, live clock, infrastructure health score, quick statistics, quick actions, animated network map, recent alerts, server overview |
| `/servers` | Fleet grid with per-server animated sparklines |
| `/servers/:id` | Server detail — ECharts performance history, live metrics, resource breakdown, hardware telemetry |
| `/alerts` | Full notification feed with severity filters and read state |
| `/network` | Topology, link table (latency/throughput/loss/jitter) and host inventory |
| `/settings` | Access, security, features, quick actions, users, integrations, backups, audit log, account, and **Theme** |

Global **search (⌘K / Ctrl+K)** reaches servers, alerts and quick actions from anywhere.

---

## Tech Stack

**Frontend** — React 18 · TypeScript · Vite · TailwindCSS · Framer Motion · TanStack Query · Apache ECharts · React Router · Lucide Icons · Zustand

**Backend** — Node.js · Express · `ws` (WebSocket) · `better-sqlite3`

**Deploy** — Docker + docker-compose, nginx reverse proxy for SPA + API + WS

---

## Design Language

A dark, premium NOC aesthetic:

- Background `#0A0A0A`, cards `#181818`, subtle borders, huge whitespace
- **Theme system** — Dark (default) and Light appearances plus six saturated accents:
  **Green** (default `#34D399`), Purple, Blue, Orange, Red, Pink. Persisted locally; status colors
  (`success` / `warning` / `critical`) always stay semantic regardless of the chosen accent
- Inter + Space Grotesk + JetBrains Mono, soft shadows, soft glow, rounded corners
- Everything animates: numbers count up, charts tween, cards hover, statuses fade, updates arrive every **2 s** over WebSocket — never a hard jump
- Settings mutations open centered popup modals (create / edit / delete / credentials / security) — the Settings page stays a clean, scannable overview

---

## Architecture

```
┌────────────────────────────┐        ┌────────────────────────────────────────┐
│   Frontend (Vite + React)   │        │             Backend (Express)           │
│                             │  REST  │                                        │
│  pages · components         │◀──────▶│  routes/  (servers · stats · history   │
│  store/  (zustand)          │        │           · network · notifications ·  │
│  api/    (client · ws)      │        │           · search · health · admin)   │
│  lib/sensors (registry)     │  WS    │  ws/  ── broadcast every 2 s ──┐       │
│  charts  (ECharts)          │◀──────▶│  providers/  (abstraction)      │       │
└────────────────────────────┘        │  telemetry/engine (simulation) ──┘       │
                                       │  telemetry/notification-generator       │
                                       │  db/ (SQLite · history + notifications) │
                                       │  security/  (auth · 2FA · SMTP · locks) │
                                       └────────────────────────────────────────┘
```

### Live data flow

1. On load the frontend hydrates from `GET /api/servers` and `GET /api/notifications`.
2. A **WebSocket** (`/ws`) pushes `{ type: 'telemetry', data: MetricSnapshot[] }` every 2 s and `{ type: 'notifications', data: Notification[] }` when events fire.
3. Snapshots update the zustand store; sparkline ring-buffers append; every value is animated via Framer Motion.
4. Historical charts read `GET /api/servers/:id/history?range=15m|1h|6h|24h` (SQLite, bucketed).

### How servers are discovered — no agent required

HomeLab OS is **pull-based**: the backend asks infrastructure APIs directly. There is **no agent to install**
on your hosts. Discovery is entirely a backend concern:

- `MetricsProvider` (`backend/src/providers/types.ts`) is the single contract for data:
  servers, history, global health, stats and network topology.
- The default `MockMetricsProvider` returns a believable 5-host fleet (PVE0, Docker01, NAS01, Gateway, Switch01)
  so the whole UI works out of the box.
- **Proxmox VE is a first-class live provider** (`backend/src/providers/proxmoxMetricsProvider.ts`). Set
  `MOCK_MODE=false` and provide a Proxmox API token (see `SETUP.md`). The backend then discovers every node,
  VM and container automatically and feeds the dashboard with real CPU/RAM/disk/network/temperature data —
  including optional `lm-sensors` telemetry when the host exposes it. Nothing is installed on Proxmox itself.
- Other backends (Docker Engine API, Node Exporter, Uptime Kuma…) can implement the same `MetricsProvider`
  contract; the REST + WebSocket pipeline, fleet grid, charts, network map and alerts all stay identical.

---

## Hardware Telemetry (optional sensors)

The platform models sensors as **optional capabilities** — the UI must never show fabricated `0` or placeholder values.

- Each server declares the sensors it actually exposes (`spec.sensors` in `backend/src/mock-data/servers.ts`).
- The engine simulates them per tick (fan RPM tracks temperature, power tracks CPU, GPU sensors on `PVE0` only, etc.) and occasionally simulates a **read failure** (`available: false`).
- The frontend renders the **full sensor registry** (`frontend/src/lib/sensors.ts`) in a fixed grid, grouped by *GPU / Cooling / Power / Storage / Chipset*.
  - Sensor present + live → animated value with warning/critical coloring from the sensor's own thresholds.
  - Sensor present but failed → **"Unavailable"**.
  - Sensor not declared by the host → **"Not Available"** — same tile, same layout, no reflow.

Adding a sensor type in a future release is one entry in `SENSOR_REGISTRY` + one `SensorConfig` on the servers that have it. The panel design never changes.

---

## Getting Started

### Prerequisites
- Node.js ≥ 20, npm ≥ 9

### Development (both apps, hot reload)

```bash
npm install
npm run dev
```

- Frontend: http://localhost:5173 (proxies `/api` and `/ws` to backend)
- Backend: http://localhost:4000 · WebSocket: `ws://localhost:4000/ws`

Or run them separately: `npm run dev -w backend` / `npm run dev -w frontend`.

> Note: the backend has **no hot reload**. After editing backend code, restart it with
> `npx tsx src/index.ts` from `backend/`.

### Production build

```bash
npm run build        # tsc + vite build for both apps
npm run start -w backend
```

---

## Homelab Deployment Guide

> **For a complete, step-by-step installation walkthrough** — including Proxmox API token setup,
> enabling the live provider, Telegram and email configuration, and going live — read [`SETUP.md`](./SETUP.md).

### 1. Docker Compose (recommended)

```bash
docker compose up --build -d
```

- Frontend: http://localhost:3000 (nginx serves the SPA and proxies `/api` + `/ws`)
- Backend: http://localhost:4000
- SQLite volume `homelab-data` persists history, notifications, backups and settings

### 2. Reverse proxy + HTTPS

Put nginx (or Caddy / Traefik) in front and terminate TLS. The frontend container already serves the SPA
and proxies `/api` + `/ws`, so you only need to forward the hostname:

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

        # WebSocket upgrade for live telemetry
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

When serving over HTTPS set `NODE_ENV=production` and `COOKIE_SECURE=true` on the backend.

### 3. First sign-in

On first boot the backend creates a **super admin** and writes its credentials to
`DATA_DIR/.admin-initial-password` (e.g. `admin / <generated-password>`). Sign in at `/login`.
To pin your own password instead, set `ADMIN_INITIAL_PASSWORD` in the backend environment.

### 4. Telegram notifications

- **Configuration → Integrations → New → Telegram**
- Enable the `telegram_notifications` feature flag first if it is not already on
  (**Configuration → Features**).
- Enter a name, bot token (stored **encrypted** — never returned to the UI) and chat ID.
- Use **Test** to verify the stored credentials.

> **Status:** the Telegram integration stores credentials safely and supports connection testing,
> but actual message delivery is under development. It is listed as a supported integration kind and
> gated behind its feature flag — treat delivery as a roadmap item.

### 5. SMTP email (verification codes + recovery)

- **Configuration → Integrations → New → Email** (feature flag `email_notifications`).
- Configure the SMTP server (host, port, user, password, from-address).
- Users with an email address can then receive OTP verification codes and account-recovery emails
  (2FA must be enabled and SMTP must be configured).

> **Status:** SMTP settings are also manageable as a security setting; the built-in dependency-free
> SMTP client supports plaintext, implicit TLS (465) and STARTTLS (587).

### 6. Going live with real servers

Follow `SETUP.md` to enable the **built-in Proxmox VE provider**: set `MOCK_MODE=false`, create an API token
in the Proxmox web UI, and drop the host + token into `.env`. The backend then discovers all nodes, VMs and
containers automatically — there is no agent component to deploy on your hosts. Everything else (fleet grid,
charts, network map, sensors, alerts) lights up with real data with no frontend changes.

---

## Security & Recovery

### Roles & permissions

| Role | Capabilities |
| --- | --- |
| `SUPER_ADMIN` | Everything — users, integrations, access modes, security, backups, audit log |
| `OPERATOR` | Operational settings + integrations, no user administration |
| `VIEWER` | Read-only dashboard + settings views |
| `GUEST` | Unauthenticated read-only exposure (off by default, scoped in Configuration → Access) |

The backend enforces authorization on every mutation — modals never bypass the permission model,
and read-only / safe / emergency-lock modes block changes server-side.

### Guest mode

Guest mode enables public **read-only** dashboard access for unauthenticated visitors.
It is off by default and controlled in **Configuration → Access** (with per-scope
exposure controls). The dashboard itself (servers, telemetry, network, alerts) remains
readable to signed-in viewers without any admin permissions.

### Two-factor authentication & recovery

Users can enable **2FA** from the Account tab. Because 2FA is disabled system-wide by default,
the setup flow surfaces a clear "disabled system-wide" notice until it is enabled. Recovery uses
security questions and an optional recovery email (SMTP required for email codes).

### Recovering a lost admin password

The `dashboardctl` CLI talks directly to the SQLite database (no HTTP) and works even
when the API is down, locked, or the password is unknown:

```bash
# Reset to a random password (printed to stdout)…
docker compose exec backend node dist/cli/dashboardctl.js reset-admin

# …or set a specific one
docker compose exec backend node dist/cli/dashboardctl.js reset-admin --password 'NewPassw0rd!'
```

Outside Docker, point it at the same data dir as the backend:

```bash
DATA_DIR=/path/to/homelab/data npm run dashboardctl -w backend -- reset-admin
```

Other recovery commands: `status`, `emergency-unlock`, `reset-settings`,
`verify-db`, `repair-db`, `backup`, `restore <file>`, `disable-feature <id>`.

---

## Configuration

| Env var | Default | Description |
| --- | --- | --- |
| `PORT` | `4000` | Backend HTTP/WS port |
| `HOST` | `0.0.0.0` | Bind address |
| `CORS_ORIGIN` | `http://localhost:5173` | Comma-separated allowed origins |
| `DATA_DIR` | `./data` | SQLite file location, backups, secrets |
| `MOCK_MODE` | `true` | `true` = simulated telemetry, `false` = live Proxmox provider |
| `TELEMETRY_INTERVAL_MS` | `2000` | Simulation tick / WS push cadence |
| `HISTORY_RETENTION_HOURS` | `24` | Seeded history window |
| `PROXMOX_HOST` | — | Proxmox API host (with port: `https://192.168.1.10:8006`) |
| `PROXMOX_TOKEN_ID` | — | Proxmox API token ID (`<user>@<realm>!<token>`), e.g. `root@pam!homelab` |
| `PROXMOX_TOKEN_SECRET` | — | Proxmox API token secret |
| `PROXMOX_VERIFY_TLS` | `false` | Validate the Proxmox TLS chain (self-signed by default) |
| `PROXMOX_POLL_INTERVAL_MS` | `5000` | How often the backend polls Proxmox |
| `SECRET_ENCRYPTION_KEY` | — | Encrypts stored secrets; set a long random string |
| `ADMIN_INITIAL_PASSWORD` | — | First-boot super admin password (auto-generated if empty) |
| `COOKIE_SECURE` | `false` | Session cookie `Secure` flag (with `NODE_ENV=production`) |
| `NODE_ENV` | `development` | Runtime environment |
| `VITE_BACKEND_URL` | `/api` | Frontend API base |
| `VITE_WS_URL` | auto (`ws(s)://host/ws`) | Frontend WS endpoint |

A full `.env.example` with placeholders is committed at the repo root. **Never commit real secrets.**

---

## API Reference

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | Status, mock flag, provider name, last poll error, boot stats |
| GET | `/api/servers` | All servers with live runtime |
| GET | `/api/servers/:id` | Single server |
| GET | `/api/servers/:id/history?range=` | Bucketed history points |
| GET | `/api/health/global` | Aggregate health score |
| GET | `/api/stats` | Quick-stat values |
| GET | `/api/network` | Topology nodes + links |
| GET | `/api/notifications?limit=&offset=` | Notification feed |
| GET | `/api/notifications/unread-count` | Unread count |
| POST | `/api/notifications/read` | `{ ids: string[] }` |
| POST | `/api/notifications/read-all` | Mark everything read |
| GET | `/api/search?q=` | Global search (servers, alerts, actions) |
| POST | `/api/auth/login` · `/logout` · `/me` | Authentication |
| POST | `/api/auth/2fa/*` | 2FA setup / verify / disable |
| GET/POST | `/api/admin/users`, `/integrations`, `/backups`, `/settings` | Administration |

### WebSocket protocol

```json
{ "type": "connected",      "data": { "timestamp": 1786000000000 } }
{ "type": "telemetry",      "data": [ MetricSnapshot, ... ] }
{ "type": "notifications",  "data": [ Notification, ... ] }
```

---

## Mock Data

The simulation (`backend/src/telemetry/engine.ts`) drives five believable hosts — **PVE0** (Proxmox hypervisor), **Docker01** (64 containers), **NAS01** (ZFS storage), **Gateway** (OPNsense), **Switch01** (UniFi):

- CPU from smooth waves + noise + bursts; RAM drifts toward baseline; temperature follows CPU load
- Network bursts on random intervals; load, processes and uptime evolve realistically
- Health degrades with stress (high CPU / RAM / temperature)
- Notifications derived from live telemetry (high CPU, temperature warnings) plus ambient events (backups, container updates, cert renewals, SSH brute-force blocks)
- History seeded for the retention window at boot; every metric changes every 2–5 s

---

## Project Structure

```
├── backend
│   ├── src
│   │   ├── config.ts              env + typed config
│   │   ├── app.ts                 express wiring
│   │   ├── index.ts               bootstrap
│   │   ├── db/                    better-sqlite3 schema + queries
│   │   ├── mock-data/             servers, network, notification templates
│   │   ├── providers/             MetricsProvider / NotificationsProvider contracts + mocks
│   │   ├── routes/                REST endpoints (public + admin)
│   │   ├── security/              auth, 2FA, SMTP, settings, secrets, session
│   │   ├── telemetry/             engine, notification generator, random helpers
│   │   └── ws/                    WebSocket broadcast server
│   └── Dockerfile
└── frontend
    ├── public/                    favicon
    └── src
        ├── api/                   fetch client, endpoints, websocket
        ├── components/
        │   ├── charts/            ECharts wrapper + metric charts
        │   ├── config/            Settings panels (users, integrations, account, theme…)
        │   ├── dashboard/         greeting, health, stats, actions, map, overview
        │   ├── hardware/          SensorTile + HardwareTelemetry panel
        │   ├── layout/            Sidebar, Topbar, AppLayout
        │   ├── notifications/     toast queue
        │   ├── search/            ⌘K command palette
        │   ├── server/            ServerCard
        │   └── ui/                primitives (Card, Button, Sparkline, Modal…)
        ├── hooks/                 useTelemetry, useNotifications, useClock…
        ├── lib/                   utils, constants, sensor registry, version
        ├── pages/                 Dashboard, Servers, ServerDetail, Alerts, Network, Settings
        ├── store/                 zustand stores (telemetry, notifications, theme, auth…)
        └── types/                 shared domain types
```

---

## Extending

### Add a real integration (e.g. another Proxmox-free backend)
1. Create `backend/src/providers/<name>MetricsProvider.ts` implementing `MetricsProvider` — the Proxmox
   provider (`proxmoxMetricsProvider.ts`) is a complete reference (API client, poll loop, sensor mapping,
   network topology from guests).
2. Select it in `backend/src/index.ts` where the mock/proxmox branch lives.
3. The whole UI, charts and WS pipeline keep working unchanged.

> Proxmox VE ships as a built-in provider — see `SETUP.md` to enable it.

### Add a new hardware sensor
1. Add the kind to `SensorKind` (backend `types`) and a `SensorConfig` on the hosts that have it.
2. Add a `SENSOR_REGISTRY` entry + position in `SENSOR_ORDER` (frontend `lib/sensors.ts`).
3. Done — the tile appears with correct "Not Available" handling on hosts without the sensor.

### Add a new quick action
Append to `QUICK_ACTIONS` in `backend/src/routes/index.ts` and it flows into `⌘K` search and the Quick Actions panel.

---

## Roadmap

- Additional provider backends (Docker Engine, Node Exporter, Prometheus, Uptime Kuma)
- Actual Telegram message delivery and email notification delivery (integration stubs are in place)
- Alert routing rules and escalation
- Additional hardware sensor kinds

---

## License

MIT — do whatever you want with it.

---

<p align="center">
  <sub>v1.0.15 · HomeLab OS</sub>
  <br />
  <sub>
    Author: <a href="https://github.com/johnvexcoder">John Vex Coder</a> :octocat:
  </sub>
</p>
