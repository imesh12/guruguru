# Kurukuru Monitor Deployment Assets

## Purpose

This folder contains initial production deployment assets for Ubuntu installation.
The files here are safe templates intended for:

- Ubuntu main server setup
- Ubuntu standby server setup
- nginx reverse proxy configuration
- systemd service registration
- basic health and failover readiness checks

These files are not application runtime code changes.

## Main Server and Standby Server

Kurukuru Monitor production is planned with:

- Main server: Ubuntu PC 1
- Standby server: Ubuntu PC 2

The standby server is a Cold/Warm Standby fallback.
It is not active-active, not daily synced, and not meant for latest development builds.
It should keep the same verified stable release as the main server so operators can switch quickly during trouble.

## Production Paths

Recommended production paths:

- Application root: `/opt/kurukuru-monitor`
- Secret env file: `/etc/kurukuru-monitor/.env.production`
- Logs: `/var/log/kurukuru-monitor`

Additional common paths:

- Frontend static files: `/opt/kurukuru-monitor/frontend`
- MediaMTX config: `/opt/kurukuru-monitor/mediamtx/mediamtx.yml`
- Deployment helper scripts: `/opt/kurukuru-monitor/scripts`

## Files in This Folder

- `nginx/kurukuru-monitor.conf`
  - nginx site template for browser map and API/WebSocket proxy
- `systemd/kurukuru-api.service`
  - systemd template for Fastify API
- `systemd/kurukuru-mediamtx.service`
  - systemd template for MediaMTX
- `scripts/health-check.sh`
  - basic API and MediaMTX health check helper
- `scripts/failover-check.sh`
  - standby readiness check helper

## Installation Overview

Typical manual installation flow:

1. Copy application build/runtime files to `/opt/kurukuru-monitor`
2. Create `/etc/kurukuru-monitor/.env.production`
3. Copy nginx template to `/etc/nginx/sites-available/`
4. Enable nginx site and reload nginx
5. Copy systemd templates to `/etc/systemd/system/`
6. Run `systemctl daemon-reload`
7. Enable and start `kurukuru-api` and `kurukuru-mediamtx`
8. Copy helper scripts into `/opt/kurukuru-monitor/scripts`
9. Run health and failover checks

## Manual Copy / Install Summary

Example commands on Ubuntu:

```bash
sudo mkdir -p /opt/kurukuru-monitor /etc/kurukuru-monitor /var/log/kurukuru-monitor
sudo cp deployment/nginx/kurukuru-monitor.conf /etc/nginx/sites-available/kurukuru-monitor.conf
sudo cp deployment/systemd/kurukuru-api.service /etc/systemd/system/
sudo cp deployment/systemd/kurukuru-mediamtx.service /etc/systemd/system/
sudo cp deployment/scripts/health-check.sh /opt/kurukuru-monitor/scripts/
sudo cp deployment/scripts/failover-check.sh /opt/kurukuru-monitor/scripts/
sudo chmod +x /opt/kurukuru-monitor/scripts/health-check.sh /opt/kurukuru-monitor/scripts/failover-check.sh
```

Site enable example:

```bash
sudo ln -s /etc/nginx/sites-available/kurukuru-monitor.conf /etc/nginx/sites-enabled/kurukuru-monitor.conf
sudo nginx -t
sudo systemctl daemon-reload
sudo systemctl enable kurukuru-api kurukuru-mediamtx nginx
sudo systemctl restart kurukuru-api kurukuru-mediamtx nginx
```

## Security Warning

- Never commit `.env.production`
- Never commit real API tokens
- Never commit admin passwords or hashes that are in active use
- Never commit real map keys if repository policy does not allow them

Only safe placeholders should exist in version-controlled deployment templates.

## Notes

- Adjust `server_name`, paths, and ports for the client environment
- Review MediaMTX port usage for the actual camera/network design
- Review firewall rules before production rollout
- Apply the same verified stable release to the standby server after the main server is validated
