# Glen Idunno

Selbst gehostete Web-App (PWA) mit Magic-Link-Login und Nutzerverwaltung.

## Architektur

Eine SvelteKit-App im Repo-Root, ein Docker-Container hinter Traefik v3:

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

## Zugriff

Closed App – keine anonyme Nutzung. Initial ist nur die in `.env`
hinterlegte Admin-Mailadresse freigeschaltet; weitere User legt der Admin
auf einer eigenen Admin-Seite an. Login erfolgt per Magic Link, ohne
Passwort.

## Entwicklung

```bash
# Repo klonen
git clone git@github.com:markdor/glenidunno.git && cd glenidunno

# Dependencies installieren
npm install

# App im Dev-Mode starten (Magic Link wird in die Konsole geloggt,
# SMTP-Konfiguration nicht nötig)
npm run dev
```

`.env` aus `.env.example` ableiten und mindestens `AUTH_SECRET`,
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
