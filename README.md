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

**Whisky-Blindtasting:** Der Admin legt ein Tasting mit Datum an und wählt
die Teilnehmer aus den freigeschalteten Usern (neue Personen legt er vorher
auf der Admin-Seite an). Jedes Tasting hat genau einen festen Link der Form
`/tasting/<adjektiv>-<tier>` (z. B. `/tasting/fluffy-otter`), den alle
Teilnehmer gemeinsam nutzen. Wer welcher Teilnehmer ist, ergibt sich aus
dem Login – wer nicht am Tasting teilnimmt, sieht nichts. Die Phase ergibt
sich aus dem Tasting-Datum (Berliner Zeit):

| Zeitraum | Alle Teilnehmer sehen |
|---|---|
| bis 18 Uhr am Tasting-Tag | nur die eigenen Flaschen |
| ab 18 Uhr am Tasting-Tag | nur die Tastingreihenfolge der Synonyme |
| ab 9 Uhr am Folgetag | die komplette Auflösung |

Die Admin-Seite eines Tastings zeigt in keiner Phase Inhalte, nur
Teilnehmer, Eingabefortschritt und Verwaltung. Der Admin verkostet mit
und sieht Reihenfolge und Auflösung als Teilnehmer des Tastings.

Der Admin kann beide Schritte nacheinander per Knopfdruck vorziehen:
erst „Reihenfolge jetzt freigeben“ statt 18 Uhr, danach „Jetzt
auflösen“ statt 9 Uhr. Das lässt sich nicht rückgängig machen, und alle
Teilnehmer sehen danach, wann der Admin das getan hat.

Zu jeder Flasche kann optional eine Präsentation (meist PowerPoint,
höchstens 30 MB) hochgeladen werden. Die Datei wird unverändert
gespeichert, im Volume unter dem Namen
`Tasting_<YYYY-MM-DD>_<Synonym>.<Endung>`. Ab der Reihenfolge können
alle Teilnehmer sie herunterladen, damit die Folien beim Tasting gezeigt
werden können – bis zur Auflösung unter diesem neutralen Namen, danach
unter dem Originalnamen. Vorher sieht niemand die Datei, auch nicht ihren
Namen.

Blind für alle: Auch der Admin sieht vor 18 Uhr keine fremden Eingaben.

User, die an einem Tasting teilgenommen haben, werden beim Löschen nur
deaktiviert: Sie können sich nicht mehr anmelden, bleiben in ihren
Tastings aber als „<Username> (inaktiv)“ sichtbar.

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
Persistente Daten liegen in zwei named Docker Volumes: die SQLite-DB
unter `/data` und die hochgeladenen Präsentationen unter `/media`
(`glenidunno-media`, Pfad per `MEDIA_PATH`). Beide gehören ins Backup.

```bash
docker compose up -d
```

DB-Migrationen laufen automatisch beim Container-Start, ebenso der
Admin-Bootstrap.

## Lizenz

[AGPL-3.0-only](./LICENSE)
