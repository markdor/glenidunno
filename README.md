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

Closed App – keine anonyme Nutzung, mit genau einer Ausnahme. Initial ist
nur die in `.env` hinterlegte Admin-Mailadresse freigeschaltet; weitere
User legt der Admin auf einer eigenen Admin-Seite an. Login erfolgt per
Magic Link, ohne Passwort.

**Ausnahme Whisky-Blindtasting:** Der Admin legt ein Tasting mit Datum
und Teilnehmern an. Jeder Teilnehmer trägt seine Flaschen ohne Login
über einen persönlichen Link (`/tasting/<token>`) ein. Das ist die
einzige anonym erreichbare Route, und ein Link gibt nur Zugriff auf die
eigenen Eingaben in diesem einen Tasting. Die Phase ergibt sich aus dem
Tasting-Datum (Berliner Zeit):

| Zeitraum | Alle Links und der Admin sehen |
|---|---|
| bis 18 Uhr am Tasting-Tag | nur die eigenen Flaschen (der Admin nur den Eingabefortschritt) |
| ab 18 Uhr am Tasting-Tag | nur die Ausschankreihenfolge der Synonyme |
| ab 9 Uhr am Folgetag | die komplette Auflösung |

Der Admin kann beide Schritte per Knopfdruck vorziehen („Reihenfolge
jetzt freigeben“ statt 18 Uhr, „Jetzt auflösen“ statt 9 Uhr). Das lässt
sich nicht rückgängig machen, und alle Links zeigen danach, wann der
Admin das getan hat.

Blind für alle: Auch der Admin sieht vor 18 Uhr keine fremden Eingaben.
Die Links zeigt die App dem Admin genau einmal (nach dem Anlegen bzw.
„Link neu generieren“), gespeichert wird nur ein Hash. Wer einen Link
hat, sieht und ändert die Eingaben dieses Teilnehmers – Links deshalb
einzeln verschicken, nicht in die Gruppe.

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
