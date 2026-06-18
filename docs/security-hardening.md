# Security Hardening

This guide covers the practical local-deployment protections added for the municipal demo environment.

## What Is Protected

- Camera passwords can be encrypted at rest with AES-256-GCM
- Existing plaintext camera passwords are migrated when a valid encryption key is available
- `GET /cameras` no longer returns raw camera passwords
- Admin API routes can be protected with a local `API_TOKEN`
- The API binds to `127.0.0.1` by default through `API_HOST`
- Camera settings UI keeps existing passwords unless a new password is entered
- Field-test reports do not include passwords
- Security checks can verify local deployment basics before demo day

## What Is Not Protected Yet

- There is no full user login or role-based access control yet
- Camera credentials are still available to the local desktop app for playback
- SQLite file permissions still depend on the host OS and service user configuration
- There is no remote audit trail or centralized secret manager

## Generate An Encryption Key

Run:

```bash
./scripts/generate-encryption-key.sh
```

Put the generated base64 value into:

```bash
CREDENTIAL_ENCRYPTION_KEY="<generated-base64-key>"
```

The preferred format is base64 that decodes to 32 bytes for AES-256-GCM.
For backward compatibility, a 64-character hex key is also accepted.

## Rotate Camera Credentials

1. Set or update `CREDENTIAL_ENCRYPTION_KEY` in `.env`
2. Restart the API and desktop services
3. Open the Settings page
4. Enter a new camera password only for the cameras you want to rotate
5. Save the camera settings

Plaintext passwords from older deployments are migrated automatically once a valid key is present and the camera is loaded for use.

## Local API Token Setup

To protect admin routes locally:

```bash
API_HOST="127.0.0.1"
API_TOKEN="<long-random-token>"
```

When `API_TOKEN` is set:

- desktop admin requests send `Authorization: Bearer ...`
- settings, field-test, and camera status update routes require the token
- public local health/status reads can still work without full admin access where configured

## Startup Validation

- If `CREDENTIAL_ENCRYPTION_KEY` is missing, the API and Electron app warn clearly at startup
- Development mode still works without a key
- Production or systemd deployments should set the key before demo or handover

## Security Check Script

Run:

```bash
./scripts/security-check.sh
```

It checks:

- `.env` exists
- `CREDENTIAL_ENCRYPTION_KEY` is set
- `API_HOST` is `127.0.0.1` unless intentionally changed
- `API_TOKEN` is set for production mode
- sample RTSP password fields are blank
