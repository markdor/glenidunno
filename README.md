# Glen Idunno

Selbst gehostete Web-App (PWA) mit Magic-Link-Login und Nutzerverwaltung.

## Architektur

Eine SvelteKit-App im Repo-Root, ein Docker-Container hinter Traefik v3,
dazu Gotenberg für den Präsentations-Viewer (nur intern erreichbar):

```
Browser (PWA) ◄──► app (SvelteKit) ──► gotenberg (Office → PDF)
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
| Präsentations-Viewer | pdf.js, Gotenberg (LibreOffice) |
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

PDFs und Office-Dateien (PowerPoint, Word, OpenDocument) lassen sich ab der
Reihenfolge außerdem direkt in der App ansehen, Folie für Folie, auch auf dem
Smartphone ohne Office-App. Office-Dateien wandelt Gotenberg dafür einmal in
PDF um, das Ergebnis liegt als Cache im Medien-Volume. Animationen und Videos
gibt es nur in der heruntergeladenen Datei.

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

### Präsentations-Viewer lokal testen

Original-PDFs zeigt der Viewer auch ohne weitere Dienste an, zum Ausprobieren
reicht z. B. `tests/fixtures/slides.pdf`. Office-Dateien (PowerPoint, Word,
OpenDocument) wandelt Gotenberg in PDF um; ohne Gotenberg zeigt der Viewer
für sie den Fehlerzustand mit Download-Link.

Gotenberg per Docker starten (Docker Desktop muss laufen):

```bash
docker run --rm -p 3001:3000 gotenberg/gotenberg:8.37.0-libreoffice
```

Dann in `.env.local` setzen und `npm run dev` (neu) starten:

```env
GOTENBERG_URL=http://localhost:3001
```

Der `gotenberg`-Service aus `compose.yaml` veröffentlicht bewusst keinen
Port und ist deshalb für `npm run dev` nicht erreichbar. Seine Flags braucht
es lokal nicht; ohne `--api-timeout=120s` bricht Gotenberg allerdings nach
30 s ab, sehr große Präsentationen können dann fehlschlagen.

## Deployment

Docker Compose auf Hetzner VPS, TLS via Traefik + Let's Encrypt.
Persistente Daten liegen in zwei named Docker Volumes: die SQLite-DB
unter `/data` und die hochgeladenen Präsentationen unter `/media`
(`glenidunno-media`, Pfad per `MEDIA_PATH`). Beide gehören ins Backup.

Der zweite Service `gotenberg` (gepinntes Image ohne Chromium, siehe
`compose.yaml`) wandelt Office-Präsentationen für den Viewer in PDF um. Die
App erreicht ihn über `GOTENBERG_URL` (Default `http://gotenberg:3000`), von
außen ist er nicht erreichbar. Die App startet auch ohne ihn; dann lassen
sich nur Original-PDFs ansehen. Das Prod-Compose auf dem VPS braucht den
Service ebenfalls.

```bash
docker compose up -d
```

DB-Migrationen laufen automatisch beim Container-Start, ebenso der
Admin-Bootstrap.

## Lizenz

[AGPL-3.0-only](./LICENSE)
