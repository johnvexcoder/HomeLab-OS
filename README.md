<div align="center">

<img src="frontend/public/favicon.svg" width="110" height="110" alt="HomeLab OS icon" />

# HomeLab OS

**Self-Hosted Infrastructure Operating System — a live Network Operations Center (NOC) dashboard for your homelab.**

Not a homepage. Not a link aggregator. A real-time observability surface with animated telemetry, optional hardware sensors, and an architecture designed to swap mock data for real integrations (Proxmox, Docker, Node Exporter, Prometheus) without a redesign.

**v1.0.17**

[![React 18](https://img.shields.io/static/v1?style=for-the-badge&label=React%2018&message=TypeScript%205%20%7C%20Vite%206&color=34D399)](https://react.dev)
[![Express](https://img.shields.io/static/v1?style=for-the-badge&label=Express&message=WebSocket%20%7C%20SQLite&color=34D399)](https://expressjs.com)
[![Tailwind](https://img.shields.io/static/v1?style=for-the-badge&label=Tailwind&message=Framer%20Motion%20%7C%20ECharts&color=34D399)](https://tailwindcss.com)
[![License](https://img.shields.io/static/v1?style=for-the-badge&label=License&message=GPLv3&color=blue&logo=gnu&logoColor=white)](LICENSE)

</div>

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Screens](#screens)
- [System Architecture](#system-architecture)
- [How Servers Are Discovered](#how-servers-are-discovered)
- [Tech Stack](#tech-stack)
- [Design Language](#design-language)
- [Quick Start](#quick-start)
- [Deployment & Reverse Proxy](#deployment--reverse-proxy)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Security & Recovery](#security--recovery)
- [Hardware Telemetry](#hardware-telemetry)
- [Maintenance](#maintenance)
- [Updating](#updating)
- [Extending](#extending)
- [Roadmap](#roadmap)
- [Author & Credits](#author--credits)
- [License](#license)

---

## Overview

HomeLab OS turns your infrastructure into a **live Network Operations Center**. The dashboard renders a fleet of servers with CPU, memory, storage, temperature and network telemetry, a network topology map, an alert feed, and deep per-server detail views — all updated in real time over WebSocket.

It ships in **demo mode** with a simulated 6-host fleet so the whole UI works out of the box, and it switches to **live Proxmox VE** data (and optionally the HomeLab Agent) with a couple of environment variables — no frontend changes required.

---

## Features

- **Real-time telemetry** — WebSocket pushes every 2s; numbers animate, charts tween, statuses fade. Never a hard jump.
- **Fleet grid & server detail** — per-server sparklines, live metric cards, and per-metric line graphs (CPU, Memory, Storage, Temperature, Network) with a time-range selector.
- **Network operations** — animated topology map, link table (latency / throughput / loss / jitter), and host inventory.
- **Alert feed** — severity filters, read state, and event timeline.
- **Global command palette** — `⌘K` / `Ctrl+K` search across servers, alerts, and quick actions.
- **Hardware telemetry panel** — optional sensor tiles (GPU / Cooling / Power / Storage / Chipset) that never show fabricated values.
- **Docker profiles** — per-VM container cards with status, image, ports, and bandwidth.
- **Live bandwidth** — reads Linux `/proc/net/dev` every 3 seconds for real download/upload throughput.
- **Full admin** — users & roles, integrations (Telegram, SMTP), backups, audit log, themes, 2FA, emergency locks, and guest mode.
- **Hardened security** — role-based permissions, encrypted secrets, 2FA, and a `dashboardctl` CLI for offline recovery.

---

## Screens

| Route | Purpose |
| --- | --- |
| `/` | **Dashboard** — greeting, live clock, health score, 8 quick-stat cards, quick actions, animated network map, hosts panel, recent alerts, Docker profile cards |
| `/servers` | Fleet grid with per-server animated sparklines and Docker container profiles |
| `/servers/:id` | Server detail — locked header card, 4 live metric cards, per-metric line graphs, resource breakdown, network throughput, hardware telemetry |
| `/alerts` | Full notification feed with severity filters and read state |
| `/network` | Topology, link table, and host inventory |
| `/settings` | Access, security, features, users, integrations, backups, audit log, account, theme |

---

## System Architecture

```
┌──────────────────────────┐      ┌──────────────────────────────────────────────┐
│  Frontend (Vite + React) │      │            Backend (Express)                 │
│  pages · components      │      │  routes/ servers · stats · history ·         │
│  store/  (zustand)       │      │          network · notifications ·           │
│  api/    (client · ws)   │      │          search · health · admin · agent     │
│  lib/    sensors registry│      │  ws/   broadcast every 2 s ──────────────┐   │
│  charts  (ECharts)       │      │  providers/ (abstraction)               │    │
└──────────────────────────┘      │    └─ ProxmoxMetricsProvider            │    │
                                  │    └─ MockMetricsProvider               │    │
┌──────────────────────────┐      │  telemetry/engine (simulation)◀──────────┘   │
│ HomeLab Agent (optional) │      │  telemetry/notification-generator            │
│ plugin-based · per-plugin│      │  db/   SQLite history + notifications        │
│ poll intervals      auth │      │  security/ auth · 2FA · SMTP · locks         │
└──────────────────────────┘      │  services/ networkBandwidth reader           │
                                  └──────────────────────────────────────────────┘
```

### Live data flow

1. On load the frontend hydrates from `GET /api/servers` and `GET /api/notifications`.
2. A **WebSocket** (`/ws`) pushes `{ type: 'telemetry', data: MetricSnapshot[] }` every 2s and `{ type: 'notifications', data: Notification[] }` when events fire.
3. Snapshots update the zustand store; sparkline ring-buffers append; every value animates via Framer Motion.
4. Historical charts read `GET /api/servers/:id/history?range=15m|1h|6h|24h` (SQLite, bucketed).
5. Network bandwidth is read from `/proc/net/dev` every 3s and pushed via QuickStats.

---

## How Servers Are Discovered

HomeLab OS is **pull-based** — the backend asks infrastructure APIs directly, and the core dashboard works with **no agent installed**. Discovery is entirely a backend concern:

- `MetricsProvider` (`backend/src/providers/types.ts`) is the single contract for data: servers, history, global health, stats, and network topology.
- The default `MockMetricsProvider` returns a believable 6-host fleet (PVE0, Docker01, Docker02, NAS01, Gateway, Switch01) so the whole UI works out of the box.
- **Proxmox VE is a first-class live provider.** Set `MOCK_MODE=false` and provide a Proxmox API token — the backend auto-discovers every node, VM, and container.
- **[HomeLab Agent](https://github.com/johnvexcoder/HomeLab-Agent)** (optional) adds node-local telemetry the Proxmox API does not expose (CPU temp, fans, SMART, Docker, kernel, services, UPS). The backend merges agent + Proxmox data into a single unified model.
- Other backends (Docker Engine, Node Exporter, Uptime Kuma…) implement the same `MetricsProvider` contract — the REST + WebSocket pipeline stays identical.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 · TypeScript · Vite · TailwindCSS · Framer Motion · TanStack Query · Apache ECharts · React Router · Lucide Icons · Zustand |
| Backend | Node.js · Express · `ws` (WebSocket) · `better-sqlite3` |
| Deploy | Docker + docker-compose, nginx reverse proxy for SPA + API + WS |

---

## Design Language

A dark, premium NOC aesthetic:

- Background `#0A0A0A`, cards `#181818`, subtle borders, generous whitespace.
- **Theme system** — Dark (default) and Light, plus six saturated accents: Green (default `#34D399`), Purple, Blue, Orange, Red, Pink. Status colors always stay semantic.
- Inter + Space Grotesk + JetBrains Mono, soft shadows, soft glow, rounded corners.
- Everything animates; updates arrive every **2s** over WebSocket.
- Settings mutations open centered popup modals.

---

## Quick Start

### Prerequisites

- Node.js ≥ 20, npm ≥ 9 (for local dev), or Docker + docker-compose (recommended).
- A valid **TMDB-free** stack — no external metadata service is required.

### Option A — Docker Compose (recommended)

```bash
docker compose up --build -d
```

- Frontend: http://localhost:3000 (nginx serves the SPA and proxies `/api` + `/ws`)
- Backend: http://localhost:4000 (WebSocket `ws://localhost:4000/ws`)
- SQLite volume `homelab-data` persists history, notifications, backups, and settings.

By default the app boots in **demo mode** (`MOCK_MODE=true`) with a simulated fleet. To go live, set `MOCK_MODE=false` and configure Proxmox env vars (see [SETUP.md](./SETUP.md)).

### Option B — Local development

```bash
npm install
npm run dev          # runs both apps with hot reload
```

Or run them separately: `npm run dev -w backend` / `npm run dev -w frontend`.

> The backend has **no hot reload** — after editing backend code, restart it with `npx tsx src/index.ts` from `backend/`.

### Production build

```bash
npm run build        # tsc + vite build for both apps
npm run start -w backend
```

---

## Deployment & Reverse Proxy

Place nginx (or Caddy / Traefik) in front and terminate TLS. The frontend container already serves the SPA and proxies `/api` + `/ws`, so you only forward the hostname:

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
| `PROXMOX_HOST` | — | Proxmox API host (e.g. `https://192.168.1.10:8006`) |
| `PROXMOX_TOKEN_ID` | — | Proxmox token ID (`<user>@<realm>!<token>`) |
| `PROXMOX_TOKEN_SECRET` | — | Proxmox API token secret |
| `PROXMOX_VERIFY_TLS` | `false` | Validate Proxmox TLS chain (self-signed by default) |
| `PROXMOX_POLL_INTERVAL_MS` | `5000` | Backend Proxmox poll interval |
| `DOCKER_ENABLED` | `false` | Enable Docker container monitoring |
| `DOCKER_HOST` | `/var/run/docker.sock` | Docker socket or `tcp://host:port` |
| `DOCKER_POLL_INTERVAL_MS` | `10000` | Docker polling interval |
| `DOCKER_HOST_GUEST` | `docker` | Name substring matching the PVE guest hosting Docker |
| `SECRET_ENCRYPTION_KEY` | — | Encrypts stored secrets — set a long random string |
| `ADMIN_INITIAL_PASSWORD` | — | First-boot super admin password (auto-generated if empty) |
| `COOKIE_SECURE` | `false` | Session cookie `Secure` flag (with `NODE_ENV=production`) |
| `NODE_ENV` | `development` | Runtime environment |
| `VITE_BACKEND_URL` | `/api` | Frontend API base |
| `VITE_WS_URL` | auto | Frontend WebSocket endpoint |

A full `.env.example` with placeholders is committed at the repo root. **Never commit real secrets.**

---

## API Reference

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | Status, mock flag, provider name, boot stats |
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
| GET | `/api/docker/containers` | Flat container list with ports |
| GET | `/api/docker/hosts` | Per-host container profiles with IPs |
| POST | `/api/auth/login` · `/logout` · `/me` | Authentication |
| POST | `/api/auth/2fa/*` | 2FA setup / verify / disable |
| GET/POST | `/api/admin/users`, `/integrations`, `/backups`, `/settings` | Administration |

**WebSocket protocol:**

```json
{ "type": "connected",      "data": { "timestamp": 1786000000000 } }
{ "type": "telemetry",      "data": [ MetricSnapshot, ... ] }
{ "type": "notifications",  "data": [ Notification, ... ] }
```

---

## Security & Recovery

### Roles & permissions

| Role | Capabilities |
| --- | --- |
| `SUPER_ADMIN` | Everything — users, integrations, access modes, security, backups, audit log |
| `OPERATOR` | Operational settings + integrations, no user administration |
| `VIEWER` | Read-only dashboard + settings views |
| `GUEST` | Unauthenticated read-only exposure (off by default, scoped in Configuration → Access) |

The backend enforces authorization on every mutation — modals never bypass the permission model, and read-only / safe / emergency-lock modes block changes server-side.

### Guest mode

Off by default, controlled in **Configuration → Access** with per-scope exposure controls. When enabled it exposes public **read-only** dashboard access.

### Two-factor authentication & recovery

Users can enable 2FA from the Account tab, with recovery via security questions and an optional recovery email (SMTP required for email codes).

### Recovering a lost admin password

The `dashboardctl` CLI talks directly to SQLite (no HTTP) and works even when the API is down, locked, or the password is unknown:

```bash
# Reset to a random password (printed to stdout)
docker compose exec backend node dist/cli/dashboardctl.js reset-admin

# …or set a specific one
docker compose exec backend node dist/cli/dashboardctl.js reset-admin --password 'NewPassw0rd!'
```

Outside Docker, point it at the same data dir as the backend:

```bash
DATA_DIR=/path/to/homelab/data npm run dashboardctl -w backend -- reset-admin
```

Other recovery commands: `status`, `emergency-unlock`, `reset-settings`, `verify-db`, `repair-db`, `backup`, `restore <file>`, `disable-feature <id>`.

---

## Hardware Telemetry

Sensors are modeled as **optional capabilities** — the UI never shows fabricated `0` or placeholder values:

- Each server declares the sensors it exposes (`spec.sensors` in `backend/src/mock-data/servers.ts`).
- The engine simulates them per tick and occasionally simulates a read failure (`available: false`).
- The frontend renders the full sensor registry in a fixed grid, grouped by *GPU / Cooling / Power / Storage / Chipset*.
  - Present + live → animated value with warning/critical coloring from thresholds.
  - Present but failed → **"Unavailable"**.
  - Not declared → **"Not Available"** — same tile, same layout, no reflow.

Adding a sensor type is one `SENSOR_REGISTRY` entry plus one `SensorConfig`; the panel design never changes.

---

## Maintenance

### Data & persistence

- **Database:** SQLite at `DATA_DIR` (volume `homelab-data` in Docker) — holds history, notifications, backups, and settings.
- **Secrets:** integration tokens are encrypted at rest with `SECRET_ENCRYPTION_KEY`.
- **Backups:** use the API (`/api/admin/backups`) or `dashboardctl backup` / `restore <file>`.
- **Logs:**

```bash
docker compose logs -f backend
docker compose logs -f frontend
```

### Health checks

```bash
docker compose ps
curl http://localhost:4000/api/health
```

### First sign-in

- **Demo mode:** `admin` / `homelab-demo` (reset on every backend start).
- **Production mode:** on first boot the backend creates a super admin and writes credentials to `DATA_DIR/.admin-initial-password`. Set `ADMIN_INITIAL_PASSWORD` to pin your own.

---

## Updating

```bash
git pull origin main
docker compose up --build -d
```

SQLite schema migrations run automatically at boot. If you keep local changes, stash them before pulling (`git stash`) and re-apply after — see `git log --oneline` for the changelog.

---

## Extending

### Add a real integration

1. Create `backend/src/providers/<name>MetricsProvider.ts` implementing `MetricsProvider` — the Proxmox provider is a complete reference.
2. Select it in `backend/src/index.ts`.
3. The whole UI, charts, and WS pipeline keep working unchanged.

### Add a new hardware sensor

1. Add the kind to `SensorKind` (backend `types`) and a `SensorConfig` on the relevant hosts.
2. Add a `SENSOR_REGISTRY` entry + position in `SENSOR_ORDER` (frontend `lib/sensors.ts`).
3. Done — the tile appears with correct "Not Available" handling.

### Add a new quick action

Append to `QUICK_ACTIONS` in `backend/src/routes/index.ts` and it flows into `⌘K` search and the Quick Actions panel.

---

## Roadmap

- Additional provider backends (Docker Engine, Node Exporter, Prometheus, Uptime Kuma)
- HomeLab Agent: Podman support, GPU monitoring, local log aggregation
- Telegram/email message delivery (integration stubs in place)
- Alert routing rules and escalation
- Additional hardware sensor kinds
- Multi-host Docker monitoring
- Per-VM resource metrics via the Proxmox guest agent

---

## Author & Credits

Built with care by **[John Vex Coder](https://github.com/johnvexcoder)** ✨

[![GitHub](https://img.shields.io/static/v1?style=for-the-badge&label=GitHub&message=@johnvexcoder&color=181717&logo=github&logoColor=white)](https://github.com/johnvexcoder)
[![Ko-Fi](https://img.shields.io/static/v1?style=for-the-badge&label=Support%20me&message=Ko-Fi&color=FF5E5B&logo=kofi&logoColor=white)](https://ko-fi.com/johnvexcoder)

**Part of the HomeLab OS ecosystem** — [HomeLab Agent](https://github.com/johnvexcoder/HomeLab-Agent), the companion node telemetry agent.

**Special thanks** to the open-source projects this platform builds upon: React, Vite, Express, Tailwind CSS, Apache ECharts, TanStack Query, Framer Motion, and better-sqlite3.

---

## License

This project is licensed under the **GNU General Public License v3.0 (GPL-3.0-or-later)**.

You are free to use, modify, and distribute it, provided all derivative works are also distributed under the GPLv3. This project is intended for self-hosted infrastructure management.

See the full text in the [LICENSE](LICENSE) file, or at [gnu.org/licenses/gpl-3.0.html](https://www.gnu.org/licenses/gpl-3.0.html).

---

<div align="center">
<p>Made with ❤️ for self-hosters.</p>
</div>
