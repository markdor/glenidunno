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

### Destillerie-Recherche lokal testen

Land, Region und Kapazität der Destillerien recherchiert die App per Claude
API, sobald `ANTHROPIC_API_KEY` in `.env.local` gesetzt ist: beim Start der
Startup-Job „Destillerie-Daten“, täglich um 21:00 und nach „Jetzt auflösen“.
Jeder Lauf kostet Geld, die Schätzung steht auf `/admin` im Abschnitt
„Destillerien“. Ohne Key läuft die App normal, der Job meldet dann einen
Fehler. Unit- und E2E-Tests brauchen keinen Key, Playwright setzt ihn
ausdrücklich leer.

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

Für die Destillerie-Recherche braucht `.env` auf dem VPS einen
`ANTHROPIC_API_KEY` (nicht im `Dockerfile`). Ohne ihn startet die App
trotzdem, recherchiert aber nichts.

## Historien-Import

Tastings aus der Zeit vor Glen Idunno kommen einmalig per Skript in die
App: als aufgelöste Archiv-Tastings samt Präsentationen, ohne Rauch, Fass
und Kaliber und damit ohne Reihenfolge und Charts. Optional bringt die
Datei auch Land, Region und Kapazität der Destillerien mit, die sonst die
Destillerie-Recherche ermittelt.

```bash
# Dry-Run: prüft alles, auch gegen die DB, und schreibt nichts
DB_PATH=<kopie>/glenidunno.db MEDIA_PATH=<leerer-ordner> npm run db:import-history -- <pfad/history.json>

# Import: alle Tastings in einer einzigen Transaktion
DB_PATH=<kopie>/glenidunno.db MEDIA_PATH=<leerer-ordner> npm run db:import-history -- <pfad/history.json> --apply
```

Ohne die beiden Variablen gelten `DB_PATH` und `MEDIA_PATH` aus `.env`
bzw. `.env.local` (unter PowerShell vorher `$env:DB_PATH = '…'` setzen).
Das Skript meldet alle Fehler auf einmal, jeweils mit Tasting-Datum und
Index. Es legt nie User an und migriert nie: Es bricht ab, wenn der
Migrationsstand der DB nicht zum ausgecheckten Stand passt oder ein
Tasting mit demselben Datum schon existiert.

### Format

Ein vollständiges Beispiel mit allen Feldern steht in
[`history-import-sample.json`](./history-import-sample.json). Namen, Werte
und Links darin sind Beispiele; importieren lässt sich die Datei nur mit
passenden Usern und einer Präsentation am angegebenen Pfad.

Ein fehlendes optionales Feld zählt wie `null`. Leere Strings und
Leerzeichen am Rand sind Fehler (statt `""` immer `null`), unbekannte
Felder ebenfalls – meist sind es Tippfehler.

| Feld | Pflicht | Regel |
|---|---|---|
| `version` | ja | `1` oder `2`, `distilleries` nur mit `2` |
| `tastings[].date` | ja | `YYYY-MM-DD`, spätestens vorgestern (Berliner Zeit), damit das Tasting aufgelöst ist; eindeutig in der Datei und in der DB |
| `tastings[].name` | ja | 1–60 Zeichen |
| `tastings[].motto` | nein | 1–120 Zeichen |
| `tastings[].bottles` | ja | mindestens eine Flasche; 2–12 verschiedene Teilnehmer (`broughtBy`), höchstens 6 Flaschen pro Teilnehmer, der Slot folgt der Reihenfolge im Array |
| `broughtBy` | ja | Username eines bestehenden Users (Groß-/Kleinschreibung egal), auch eines deaktivierten |
| `alias` | ja | Synonym, 1–30 Zeichen, eindeutig im Tasting |
| `distillery` | ja | 1–60 Zeichen; „Blend“ und „Unbekannt“ sind Platzhalter |
| `bottler` | nein | unabhängiger Abfüller, 1–60 Zeichen; `null` = Originalabfüllung |
| `bottling` | nein | 1–120 Zeichen, ohne eine Altersangabe, die schon in `age` steht |
| `age` | nein | ganze Zahl 1–80; `null` = NAS |
| `abv` | ja | 35–75 % vol., höchstens eine Nachkommastelle |
| `whiskybaseUrl` | nein | `https`-Link zu whiskybase.com, höchstens 300 Zeichen |
| `presentation` | nein | Pfad relativ zur JSON-Datei, innerhalb ihres Ordners; dieselbe Datei darf an mehreren Flaschen hängen (jede bekommt eine eigene Kopie), über 30 MB gibt es nur eine Warnung |
| `distilleries[].name` | ja | Destillerie einer Flasche derselben Datei (Groß-/Kleinschreibung egal), höchstens einmal, kein Platzhalter |
| `distilleries[].country` | nein | Land auf Deutsch, 1–60 Zeichen; Schottland, England, Wales und Nordirland zählen als Länder |
| `distilleries[].region` | nein | `Islay`, `Campbeltown`, `Inseln`, `Speyside`, `Highlands` oder `Lowlands`, nur mit `country` `Schottland` im selben Eintrag |
| `distilleries[].capacity` | nein | Liter reiner Alkohol pro Jahr, ganze Zahl 1–1.000.000.000 |
| `distilleries[].countrySource`, `regionSource`, `capacitySource` | nein | `http(s)`-Link als Quelle des Werts, nur zusammen mit ihm, höchstens 2048 Zeichen |

Importierte Destillerie-Werte gelten als recherchiert und werden nie neu
gesucht; einen fehlenden Wert ermittelt später die Destillerie-Recherche.
Werte, die in der DB schon recherchiert oder vom Admin gesetzt sind,
überschreibt der Import nie, der Dry-Run meldet sie als Warnung.

### Ablauf in Prod

1. Prod auf das Release bringen, dessen Stand lokal ausgecheckt wird: Die
   Migrationsstände müssen übereinstimmen.
2. Den Container `app` stoppen, die Volumes sichern und die DB-Datei
   (`glenidunno.db*`) aus dem Volume kopieren.
3. Lokal denselben Release-Tag auschecken, den Dry-Run gegen die Kopie und
   einen leeren Medienordner laufen lassen, Fehler in der JSON beheben,
   dann mit `--apply` importieren.
4. Das Ergebnis mit `npm run dev` gegen eine **zweite** Kopie ansehen, nicht
   gegen die, die zurück nach Prod geht: Der Dev-Start legt Admin, Sessions
   und Rate-Limit-Zeilen an.
5. Die DB-Datei zurück ins Volume kopieren (ein altes `-wal`/`-shm` dort
   vorher entfernen), den Inhalt des Medienordners ins Volume
   `glenidunno-media` kopieren und den Container starten.

## Lizenz

[AGPL-3.0-only](./LICENSE)
