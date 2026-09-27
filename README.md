# Dahamm

Selbst gehostete Web-App (PWA) mit Magic-Link-Login und Nutzerverwaltung.

## Architektur

Monorepo via npm Workspaces, ein Docker-Container hinter Traefik v3:

```
packages/
├── app/        SvelteKit PWA + Auth
└── shared/     Geteilte Validierungs-Konstanten
```

```
Browser (PWA) ◄──► app (SvelteKit)
                     │
                     ▼
                   SQLite (Drizzle ORM, named Docker Volume)
```

## Stack

| Bereich | Technologie |
|---|---|
| Frontend + Backend | SvelteKit (PWA-fähig) |
| Datenbank | SQLite via Drizzle ORM (better-sqlite3) |
| Auth | Better Auth (Magic Link, kein Sign-up) |
| Mail | nodemailer (Hetzner SMTP) |
| Deployment | Docker Compose + Traefik v3 (Hetzner VPS) |
| Monorepo | npm Workspaces |

## Zugriff

Closed App – keine anonyme Nutzung. Initial ist nur die in `.env`
hinterlegte Admin-Mailadresse freigeschaltet; weitere User legt der Admin
auf einer eigenen Admin-Seite an. Login erfolgt per Magic Link, ohne
Passwort.

## Entwicklung

```bash
# Repo klonen
git clone <repo-url> dahamm && cd dahamm

# Workspace-Dependencies installieren
npm install

# App im Dev-Mode starten (Magic Link wird in die Konsole geloggt,
# SMTP-Konfiguration nicht nötig)
npm run dev --workspace packages/app
```

`.env` aus `.env.example` ableiten und mindestens `BETTER_AUTH_SECRET`,
`ADMIN_EMAIL`, `ADMIN_USERNAME` setzen.

## Deployment

Docker Compose auf Hetzner VPS, TLS via Traefik + Let's Encrypt.
Persistente Daten (SQLite) liegen in einem named Docker Volume.

```bash
docker compose up -d
```

DB-Migrationen laufen automatisch beim Container-Start, ebenso der
Admin-Bootstrap.

## Lizenz

[AGPL-3.0-only](./LICENSE)
