# Local Production Deployment

This is the supported single-node production profile for a trusted HomeLab LAN. It is not an HA or Internet-facing deployment.

## 1. Configure

```bash
cp .env.example .env
chmod 600 .env
```

Set at minimum:

```dotenv
DEPLOYMENT_PROFILE=lan
DASHBOARD_BIND_ADDRESS=0.0.0.0
DASHBOARD_PORT=3000
MOCK_MODE=false
DEMO_RESET_ADMIN=false
COOKIE_SECURE=false
SECRET_ENCRYPTION_KEY=<at-least-32-random-characters>
ADMIN_INITIAL_PASSWORD=<unique-long-initial-password>
```

`COOKIE_SECURE=false` is intentional only for private-LAN HTTP. If a reverse proxy provides HTTPS, set it to `true`. The hardened profile refuses mock telemetry, insecure cookies, short encryption keys, and unverified Proxmox TLS.

The host firewall must permit TCP/3000 only from the trusted LAN or management VLAN. Do not forward this port from the router and do not expose backend port 4000.

The dashboard no longer mounts `/var/run/docker.sock`. Install HomeLab Agent on Docker hosts instead. This prevents a dashboard compromise from becoming direct control of its Docker host.

## 2. Deploy

```bash
docker compose config
docker compose build --pull
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:3000/api/health
```

Delete `ADMIN_INITIAL_PASSWORD` from `.env` after the first successful login; the existing account is not rewritten. Delete `/data/.admin-initial-password` if the generated-password workflow was used.

## 3. Verify

- Log in and change the initial password.
- Enable TOTP for administrator accounts.
- Confirm `/api/diagnostics` returns 401 without a session.
- Confirm port 4000 is not reachable from another host.
- Confirm the dashboard is unreachable from guest/IoT VLANs.
- Connect one agent and verify live telemetry and alert delivery.
- Create a manual backup, copy it off-host, and perform a restore exercise.

## 4. Update and rollback

```bash
docker compose exec backend node dist/cli/dashboardctl.js backup create --note pre-upgrade
git fetch --tags
git checkout <reviewed-version-tag>
docker compose build --pull
docker compose up -d
```

Retain the previous image IDs and an off-host database backup until validation completes. Never upgrade directly from an unreviewed moving branch on the production server.

## HTTPS profile

Place Caddy, Nginx, or Traefik in front of port 3000, redirect HTTP to HTTPS, then set:

```dotenv
DEPLOYMENT_PROFILE=hardened
COOKIE_SECURE=true
MOCK_MODE=false
PROXMOX_VERIFY_TLS=true
```

Only the reverse proxy should be reachable by clients. The backend remains private HTTP inside the Compose network.
