# Glen Idunno – CLAUDE.md

Selbst gehostete Web-App (PWA) mit Magic-Link-Login, Nutzerverwaltung und Startseite.

Anzeigename überall „Glen Idunno" (mit Leerzeichen); technische Bezeichner (Paket, Image, Container, Volumes, DB-Datei, Domain) lauten `glenidunno`.

---

## Architektur-Überblick

Eine einzelne SvelteKit-App (PWA + Auth) direkt im Repo-Root – kein Monorepo, keine npm Workspaces:

```
src/        # SvelteKit-App (Routen, Komponenten, $lib, $lib/server)
static/     # Statische Assets (Icons, Manifest)
tests/      # Playwright-E2E
drizzle/    # Versionierte SQL-Migrationen
```

Docker Compose, deployed auf Hetzner VPS hinter Traefik v3.

---

## Stack

| Bereich | Technologie |
|---|---|
| Frontend + Backend | SvelteKit (PWA-fähig) |
| Datenbank | SQLite via Drizzle ORM |
| Auth | Magic Link via nodemailer (Hetzner SMTP) |
| Deployment | Docker Compose + Traefik v3 (Hetzner VPS) |

---

## Services (Docker Compose)

### `app` – SvelteKit
- Startseite, Login und Admin-Seite (Nutzerverwaltung)
- Auth: Magic Link per Mail (nodemailer + Hetzner SMTP)
- Session-Dauer: 30 Tage Cookie
- SQLite-Datei liegt in einem Named Docker Volume unter `/data/glenidunno.db` (`DB_PATH`)

---

## UI Design

- Klar und minimalistisch, kein visuelles Rauschen
- **Mobile-first** – primäres Endgerät ist das Smartphone, Touch-Targets großzügig
- Desktop-Layout darf vorhanden sein, hat aber niedrigere Priorität
- Farbschema aus den Logo-Farben: `slate`-Skala als Creme→Dunkelbraun überschrieben (`slate-50` = Creme `#f3ebdd` als Seitenhintergrund, `slate-900` = Dunkelbraun `#2b1a0d` als Text), `brand` = Bernstein `#7d5212` für die Hauptaktion, alles in `layout.css`. Semantische Akzente nur für Status und als Tailwind-Defaults: red für Fehler, emerald für Erfolg, **sky für Info** (nicht amber – wäre von Bernstein nicht unterscheidbar). Gold `#c9973f` nur dekorativ (als Text oder mit weißer Schrift unter AA).
  - `slate-400` wird als Text auf Weiß genutzt (Placeholder, Admin-Metadaten) und ist deshalb bewusst dunkler als üblich (AA auf Weiß) – ein Off-White-Override von `--color-white` würde das kippen.
  - Die Creme steht zusätzlich in `src/app.html` (`theme-color`) und `static/site.webmanifest` – alle drei Stellen zusammen ändern.
- Logo und Fass-Mark liegen als SVG-Dateien in `src/lib/assets/` und werden per `$lib/assets`-Import als `<img>` eingebunden (gehashte Dateinamen, immutable Caching) – nicht inline und nicht über Lucide. `glen-idunno-logo.svg` weicht bewusst vom Original aus Issue #6 ab: `viewBox` auf den Inhalt zugeschnitten (der leere Creme-Rand kostete auf dem Smartphone Platz) und Untertitel „Blind Tasting" ×1,5 samt nach außen gerückter Goldlinien (sonst unlesbar); die eingebettete C2PA-Signatur ist entfernt, weil sie nach der Bearbeitung nicht mehr zum Inhalt passte – bei einem Re-Export des Logos alles wieder anwenden.

### Icons

- **`@lucide/svelte`** (nicht das deprecated `lucide-svelte`) für alle Icons, keine handgeschriebenen Inline-`<svg>`s mehr. Farbe läuft weiterhin ausschließlich über `currentColor` + bestehende Tailwind-Textfarbklassen, keine hartkodierten Farben.
- Feste Größen-/Stroke-Konvention statt Ad-hoc-Werten pro Vorkommen:

  | Verwendung | Beispiele | `size` | `strokeWidth` |
  |---|---|---|---|
  | Primäre Buttons | `Plus` | `20` | `2` |
  | Sekundär (Dropdown-Indikator) | `ChevronDown` | `16` | `2` |
  | Inline-Status (klein, kräftig) | `Check` | `14` | `3` |
  | Toast-Leiticon (visueller Anker) | `CircleAlert`, `CircleCheck`, `Info` | `20` | `2` |
  | Toast-Schließen-Button | `X` | `16` | `2` |
- Keine eigene Icon-Wrapper-Komponente – bei der aktuell überschaubaren Anzahl an Vorkommen reicht die direkte `size`/`strokeWidth`-Prop-Vergabe an der jeweiligen Nutzungsstelle; eine Abstraktion erst einführen, falls sich das Muster wiederholt.

### Startseite (`/`)

Reine Begrüßungsseite, keine Arbeitsfläche. Aufbau von oben nach unten:

1. **Header** – Fass-Mark (dekorativ, `alt=""`) + App-Name links als gemeinsamer Link auf `/`, Username-Dropdown rechts (Logout, ggf. Admin)
2. **Begrüßung** „Hallo {username} 👋"
3. **Leerzustand-Hinweis** – eine gedämpfte Zeile (`text-slate-500`), keine Module oder Karten

### Komponenten-Konventionen

- **Route-Komponenten nur mit `data`/`form` als Props**: `svelte/valid-prop-names-in-kit-pages` erlaubt in Routen-Komponenten keine eigenen Props. Test-Seams (z. B. eine konfigurierbare Verzögerung) kommen deshalb nicht in eine Prop, sondern in ein eigenes Modul mit Getter und Test-Setter, analog zum `MAGIC_LINK_DEBUG_PATH`-Seam in `auth.ts`.
- **Klickbare Karte = `<div role="link">`**, kein `<section>` – das löst sonst den A11y-Lint `a11y_no_noninteractive_element_to_interactive_role` aus. Interaktive Elemente in der Karte rufen `event.stopPropagation()`, damit ihr Klick nicht zusätzlich navigiert.
- **Bestätigungsdialoge in `use:enhance`-Formularen** über `cancel()` im Submit-Callback (`use:enhance={({ cancel }) => { if (!confirm(…)) cancel(); }}`), nie über `preventDefault()` im `onsubmit`: `enhance` prüft `defaultPrevented` nicht und schickt den Request sonst trotzdem ab (so geschehen beim Löschen auf der Admin-Seite).

### Toast / Status-Hinweise

- Globale Komponente `src/lib/components/Toast.svelte` + Store `src/lib/components/toastStore.svelte.ts` (`toast.show(variant, message, durationMs?)`), einmalig in `+layout.svelte` gemountet – einzige Quelle für kurzzeitige Status-Hinweise (Error/Success/Info), löst alle Ad-hoc-Boxen ab.
- `toastStore.svelte.ts` (nicht `toast.svelte.ts`: kollidiert TS-seitig case-insensitive mit `Toast.svelte`, sobald ohne Extension importiert – `forceConsistentCasingInFileNames` schlägt plattformunabhängig zu) ist der erste modul-globale `$state`-Runes-Store im Projekt (kein Svelte-Store-API, sondern reines `$state` + Getter auf Modulebene).
- **Fallstrick:** Wird `toast.show(...)` aus einem `$effect` heraus aufgerufen (z. B. um einen Server-Fehler aus `data`/`form` zu melden), muss der Aufruf in `untrack(() => …)` (aus `'svelte'`) gewrappt werden – sonst hängt der Effect transitiv vom internen State des Stores ab (der Store liest beim Schreiben seinen eigenen Zustand) und läuft in eine Endlosschleife (`effect_update_depth_exceeded`).

---

## Authentifizierung

- **Closed App – keine anonyme Nutzung.** Jeder nicht eingeloggte Request wird auf `/login` umgeleitet. Außer der `/login`-Route, `/health`, den Better-Auth-Endpoints unter `/auth/*` und statischen Assets ist nichts öffentlich erreichbar – auch `/api/*` nicht, das keine Sonderbehandlung hat.
  - Implementierung als globaler Auth-Guard in `hooks.server.ts`: Session prüfen, sonst `throw redirect(302, '/login')`.
  - Die Login-Seite ist die de-facto-Startseite für nicht eingeloggte User; nach erfolgreichem Login geht es auf `/` (Startseite).
  - **Ausnahme `/health`**: rein technischer Liveness-Check (Docker-Healthcheck, siehe Compose-Konventionen) – öffentlich wie `/login`/`/auth/*`, kein Redirect. Response bleibt bewusst leer/status-only (kein Stacktrace, keine Versions-/Config-Details), da der Pfad ungeschützt erreichbar ist.
- Im Header (nur sichtbar für eingeloggte User) steht der Username als Drop-Down-Trigger: "Logout" und – falls Admin – zusätzlich "Admin".
- Der Login erfolgt via Angabe der Mailadresse an die dann ein Magic Link geschickt wird.
- Eine Registrierung im herkömmlichen Sinne gibt es nicht – Initial ist nur der `.env`-Admin freigeschaltet, weitere User legt der Admin manuell an.
- Es gibt genau einen Admin User, dieser wird über das .env File mit Username und Mailadresse angegeben
  - Dieser Admin User ist in der DB als für den Login freigebener User aufgeführt (Whitelist) und kann sich im Login Formular anmelden
  - der Admin Boot Strap soll bei jedem Containerstart durchgeführt werden, damit der User sich nicht versehentlich aussperren kann
  - Idempotenz beim Boostrap: Upsert auf E-Mail, der Admin-Flag wird immer auf true gezwungen, alle anderen Felder bleiben unangetastet.
- das Whitelisting von Usern die sich anmelden dürfen erfolgt über Custom-Fields direkt am Better-Auth-user-Table, keine separate Whitelist-Tabelle.
- Es gibt eine Admin-Seite, auf der der Admin weitere Mail-Adressen (mit Username) angeben kann, auch diese können sich dann in Zukunft einloggen
  - diese Admin-Seite kann nur von eingeloggten Usern aufgerufen werden, für die ein Admin Flag in der DB existiert
  - die Admin Seite erlaubt Full CRUD, also anlegen, löschen und ändern
  - Pflichtfelder beim Anlegen: **E-Mail und Username**.
  - Ein Admin kann seinen eigenen Eintrag nicht löschen und sich nicht den Admin-Flag entziehen, andere Felder schon.
  - Beim Löschen eines Users werden alle seine aktiven Sessions sofort mitgelöscht (forced logout) – das Session-Cookie wird beim nächsten Request ungültig.
- Magic Link Flow mit Better-Auth-Plugin `magic-link`, konfiguriert mit **`disableSignUp: true`** – Better Auth legt niemals selbst User an, der einzige Weg in die `user`-Tabelle ist Admin-Bootstrap oder die Admin-Seite
  - Nutzer gibt E-Mail-Adresse ein
  - es erscheint eine Meldung, dass wenn die Mailadresse gültig ist, eine Mail gesendet wurde
  - befindet sich die Adresse nicht in der Whitelist in der DB, dann passiert nichts. Ansonsten fahre fort.
  - SvelteKit generiert signierten Token, speichert ihn in SQLite
  - nodemailer schickt Link via Hetzner SMTP. Läuft der Server lokal (dev aus $app/environment als einziger Schalter), dann wird der Magic Link in der Konsole geloggt und keine Mail gesendet, damit SMTP nicht konfiguriert sein muss
  - Klick auf Link → Session Cookie (30 Tage), Magic Link wird invalidiert
  - der Magic Link ist 24 Stunden lang gültig
- als Frameworks bzw. Infrastruktur nutze
  - Datenbank: better-sqlite3 mit der DB auf einem named Volume in der compose.yaml
  - ORM Mapper: Drizzle
  - Authentifizierung: better-auth
- **DB-Migrationen** via Drizzle Kit, automatisch beim App-Start – kein separater Deploy-Schritt
  - Schema in `src/lib/server/db/schema.ts` → `npx drizzle-kit generate` erzeugt versioniertes SQL-File in `./drizzle/`
  - Migration-Files werden committed (reviewbar im PR)
  - Boot-Reihenfolge im Container: `migrate()` → Admin-Bootstrap → SvelteKit-Server
  - Drizzle pflegt eine `__drizzle_migrations`-Tabelle, bereits angewendete Migrationen werden übersprungen (idempotent)
  - **Nicht** verwendet: `drizzle-kit push` – kein Audit-Trail, kann in Prod still destruktiv sein
- **`/login`-Route** als Heimat des Mail-Eingabe-Formulars und der Fehleranzeige – gleichzeitig die Landing-Page für nicht eingeloggte User (siehe Auth-Guard oben).
- **Rate-Limiting** über das eingebaute Better-Auth-Modul, persistiert in derselben SQLite-DB (kein Eigenbau, keine zweite Storage-Schicht):
  - pro IP auf `/sign-in/magic-link`: **5 Requests / 15 min** (Startwert, tunable) – bremst breite Enumeration und SMTP-Missbrauch
  - pro Mail-Adresse auf demselben Endpoint: **3 Requests / 1 h** (Startwert, tunable) – verhindert Flutung eines einzelnen Postfachs trotz IP-Rotation
  - alle anderen Auth-Routen: Better-Auth-Default (10 req / 10 s) reicht
  - **Hinter Traefik unbedingt** den Client-IP-Header korrekt durchreichen (`X-Forwarded-For`), in SvelteKit über `ADDRESS_HEADER` des Node-Adapters – sonst zählen alle Requests als dieselbe IP
- **Timing-Equalization gegen E-Mail-Enumeration** – Whitelist-Hit vs. Miss darf nicht über die Response-Zeit erkennbar sein:
  - **Mail-Versand fire-and-forget**: `transporter.sendMail()` nicht awaiten, sofort 200 zurück; SMTP-Fehler landen im Server-Log, nicht in der Response. Damit fällt die SMTP-Latenz (200–2000 ms) als dominanter Zeit-Faktor komplett raus
  - **Identischer Code-Pfad bei Hit und Miss**: auch bei unbekannter Mail eine Dummy-Token-Berechnung ausführen (`crypto.randomBytes(32)` + Zeitstempel, nicht persistieren); Netz-Jitter überdeckt den verbleibenden Mikro-Sekunden-Unterschied
  - **Kein** künstliches `await sleep(800ms)` – bricht, sobald SMTP langsamer wird, und kostet UX
  - Response-Text immer identisch: „Wenn die Adresse registriert ist, wurde ein Link verschickt." – egal ob Hit oder Miss
- **Magic-Link-Fehlerbehandlung beim Klick** via Better Auths `callbackURL` / `errorCallbackURL`:
  - Erfolg → Redirect zu `/`, Session-Cookie ist gesetzt, Header zeigt Username
  - Fehler → Redirect zu `/login?error=expired|invalid|used`
  - Die `/login`-Seite liest den Query-Param und zeigt über dem Formular eine Info-Box: „Dieser Link ist abgelaufen oder wurde bereits verwendet. Gib deine E-Mail erneut ein, um einen neuen zu erhalten."
  - Alle drei Error-Codes zeigen denselben Text (keine Zusatz-Info für Angreifer), Unterscheidung nur im Server-Log

---

## Environment Variables

```env
# SMTP (Hetzner Mail) – in Dev nicht nötig, Magic Link wird dann in der Konsole geloggt
SMTP_HOST=mail.your-server.de
SMTP_PORT=465
SMTP_USER=
SMTP_PASS=
SMTP_FROM=glenidunno@your-server.de

# App
DB_PATH=/data/glenidunno.db
BASE_URL=https://glenidunno.markdor.net   # öffentliche Basis-URL der App, dient sowohl
                                          # Better Auth (Magic-Link-Erzeugung) als auch
                                          # SvelteKit (origin / CSRF) als einzige Quelle

# Auth
AUTH_SECRET=        # zufälliger langer String (z. B. `openssl rand -hex 32`)
ADMIN_EMAIL=               # E-Mail des initialen Admin-Users (Bootstrap)
ADMIN_USERNAME=            # Username des initialen Admin-Users (nur beim ersten Anlegen verwendet)
```

---

## Konventionen

- **Sprache:** Deutsch im UI, Englisch im Code (Variablen, Funktionen, Kommentare)
- **Geteilte Validierungs-Constraints** liegen als Konstanten in `src/lib/validation.ts` (`$lib/validation`), nicht je Schicht dupliziert: `EMAIL_LENGTH`/`EMAIL_REGEX` (+ Helper `isValidEmail()`) und `USERNAME_RE` sind die einzige Quelle für Login-Formular und Admin-Nutzerverwaltung, damit Client- und Server-Validierung nicht auseinanderdriften. Bewusst **nicht** unter `$lib/server`, weil `login/+page.svelte` `isValidEmail()` im Browser nutzt – das Modul bleibt deshalb frei von Server-Importen.
- **Kein Monorepo** – eine SvelteKit-App im Repo-Root, keine npm Workspaces, kein Nx/Turborepo
- **Kein Postgres** – SQLite ist für diesen Use Case ausreichend, einfacher zu backupen
- **Named Docker Volume** für SQLite, kein Bind Mount

---

## Deployment

- Hetzner VPS mit Docker + Traefik v3
- Bestehendes Traefik-Netzwerk: `traefik` (external)
- TLS via Let's Encrypt (DNS-01 Challenge mit Hetzner DNS)
- App erreichbar unter `glenidunno.markdor.net`
### Compose-Konventionen

Aufbau analog zu den App-Stacks in `C:\Users\Markus\git\vps-config`, insbesondere
`vps-config/tandoor/compose.yaml` (Multi-Service-Stack mit DB-Volume, internem
Netzwerk und Traefik). Konkret:

- **Volumes** als named external Volumes oben deklariert:
  ```yaml
  volumes:
    db:
      external: true
      name: glenidunno-db
  ```
- **Netzwerk:** `web: external: true` – das vorhandene Traefik-Netzwerk
- **Pro Service:** `container_name`, `restart: unless-stopped`, `image` (bzw. `build`),
  `env_file: .env`, `volumes`, `networks`, ggf. `depends_on` mit `condition: service_healthy`.
- **Labels:**
  - `docker-volume-backup.stop-during-backup=true` auf Services mit persistentem Volume
  - Traefik-Labels nach diesem Muster (nur der nach außen erreichbare Service – hier `app`):
    ```yaml
    - "traefik.enable=true"
    - "traefik.http.routers.glenidunno.rule=Host(`glenidunno.markdor.net`)"
    - "traefik.http.routers.glenidunno.entrypoints=websecure"
    - "traefik.http.routers.glenidunno.tls.certresolver=le-resolver"
    - "traefik.http.services.glenidunno.loadbalancer.server.port=3000"
    ```
- **Healthcheck:** Der `app`-Service hat einen eigenen Healthcheck (`GET /health`,
  siehe Authentifizierung) für Docker-Sichtbarkeit und `depends_on`-Nutzung.
  - **Command ohne curl/wget**: Die Runtime-Stage im `Dockerfile` ist
    `node:24-slim` (Debian) ohne `curl`/`wget` – ein Zusatzpaket nur für den
    Healthcheck wäre unnötiger Image-Bloat. Stattdessen Node-eigenes,
    globales `fetch` per `node -e "fetch(...).then(...).catch(...)"`.
    `127.0.0.1` statt `localhost` in der URL, da Node `localhost` je nach
    Resolver zuerst zu `::1` (IPv6) auflösen kann, während der Server nur auf
    `0.0.0.0`/IPv4 lauscht – Vorbild für weitere Node-basierte Services
    auf ähnlich schlanken Images.

---

## Qualität & Tooling

Aufbau analog zu `C:\Users\Markus\git\gritshot`.

### Teststrategie

- **Viele Unit-Tests, Coverage-Gate > 85 %**, wenige E2E-Tests (Playwright nur für kritische Flows).
- **Vitest** mit zwei Projekten (vgl. `gritshot/vite.config.ts`):
  - `client` – `vitest-browser-svelte` + Playwright/Chromium headless, Pattern `**/*.svelte.{test,spec}.ts`
  - `server` – Node-Environment, Pattern `**/*.{test,spec}.ts`, Server-Code (`src/lib/server/**`)
- Coverage via `@vitest/coverage-v8`, Reporter: `text`, `lcov`, `html`, `json`, `json-summary`.
- `expect: { requireAssertions: true }` aktiv – Tests ohne Assertion schlagen fehl.
- E2E via Playwright (`tests/`), nur Smoke- und Critical-Path-Tests.
- **E2E-Login via Setup-Project + `storageState`** (Playwright-Standardmuster, https://playwright.dev/docs/auth): ein `auth.setup.ts`-Project loggt sich einmal per echtem Magic-Link-Flow als der `ADMIN_EMAIL`-Testuser ein und speichert die Session in `playwright/.auth/admin.json`. Das `e2e`-Project hängt per `dependencies: ['setup']` daran und startet alle weiteren Specs bereits eingeloggt – kein Login-Boilerplate pro Testdatei.
  - **Ein geteilter Admin-Account** für alle E2E-Tests (kein Per-Worker-Isolation-Setup). Ausreichend, solange E2E auf wenige Smoke-/Critical-Path-Tests beschränkt bleibt; Per-Worker-Accounts erst nötig, falls parallel laufende Tests sich gegenseitig über geteilten Server-State stören.
  - Tests, die explizit unauthentifiziert starten müssen (Closed-App-Guard, der Login-Flow selbst), resetten den State lokal mit `test.use({ storageState: { cookies: [], origins: [] } })`.
  - Tokens werden gehasht gespeichert, das Klartext-Magic-Link landet nur in der `MAGIC_LINK_DEBUG_PATH`-Capture-Datei (Test-Seam, siehe `auth.ts`). Lokal (`test:e2e`, Vite Preview) liegt diese Datei direkt auf dem Host. Gegen den Container (`docker:test`) macht `compose.e2e.yaml` sie per Bind-Mount host-sichtbar und isoliert den Lauf zusätzlich auf ein eigenes DB-Volume (`glenidunno-data-e2e`, vor jedem Lauf per `down -v` geleert) statt der echten Dev-Volume `glenidunno-data`.
  - Derselbe `MAGIC_LINK_DEBUG_PATH`-Schalter lockert in `auth.ts` beide Rate-Limits, weil ein lokaler Preview-/Docker-Lauf keine echte Client-IP hat und alle Requests im selben Bucket landen. **Asymmetrisch bewusst gewählt:** der Pro-IP-Limiter geht auf `max: 1000` (soll im Test nie greifen), der Pro-Mail-Limiter nur auf `max: 20` – niedrig genug, dass ein E2E-Fall ihn mit echten Requests ausschöpfen und das Über-Quota-Verhalten prüfen kann. Der Wert ist in `tests/e2e/magic-link.ts` als `MAGIC_LINK_EMAIL_TEST_LIMIT` gespiegelt (bewusste Duplikation: E2E-Tests importieren grundsätzlich keine Server-Module) – beide Stellen zusammen ändern.
  - Der Rate-Limit-E2E-Fall verbrennt das Kontingent des geteilten Admin-Accounts und muss deshalb der **letzte Test in `auth-login.e2e.ts`** bleiben (Playwright führt Tests innerhalb einer Datei seriell aus; `fullyParallel` ist bewusst nicht gesetzt).
  - **E2E-DB-Reset im `webServer`-Command, nicht in `globalSetup`**: Playwright startet den `webServer` *vor* `globalSetup`. Der Preview-Server hält die alte `e2e.db` dann schon offen, unter Windows scheitert das Löschen, und der Lauf erbt den Zustand des vorigen (u. a. das vom Rate-Limit-Fall verbrauchte Kontingent). Deshalb läuft `playwright.reset-e2e.ts` als erster Teil des `webServer.command`.
- **E2E-Klicks auf Karten** zielen auf die Kartenüberschrift, nicht auf die Karte als Ganzes: Ein Klick auf die Kartenmitte (Playwright-Default) kann auf einem interaktiven Kindelement landen und die Navigation über dessen `stopPropagation()` verschlucken (siehe Komponenten-Konventionen).

### Lint-Scope

- `npm run lint` (Prettier + ESLint) läuft im Repo-Root, zielt aber nur auf den App-Code: Markdown, `.github/`, `.claude/`, `compose*.yaml` und `.releaserc.json` stehen bewusst in `.prettierignore` und werden in ihrem eigenen Stil gepflegt.
- Beide Tools lesen zusätzlich die Root-`.gitignore` (ESLint per `includeIgnoreFile`). Ein zu breites Muster dort nimmt getrackten App-Code still aus dem Lint – `git ls-files -ci --exclude-standard` muss leer bleiben.

### Magic-Link-Callback (Enumeration-Schutz)

- Die sicherheitskritische Logik hinter `sendMagicLink` liegt **nicht** in `auth.ts`, sondern als `handleSendMagicLink()` in `src/lib/server/magicLinkCallback.ts`. Grund: `auth.ts` ist reine Wiring-/Config-Datei und steht in `coverage.exclude`; der ausgelagerte Callback fällt dagegen unter das 85 %-Gate.
- Alle Abhängigkeiten (DB, Throttle-Funktion, Mailer, `dev`, `magicLinkDebugPath`, Logger, File-Writer) kommen als `MagicLinkCallbackDeps`-Objekt herein statt aus dem Modul-Scope. Erste Stelle im Projekt mit einem Deps-Objekt statt einzelner Positions-Parameter – ab ~8 Abhängigkeiten sonst nicht mehr lesbar; bei 2–4 bleibt das bisherige Muster (`consumeEmailRateLimit(db, email, opts, now)`) die Vorgabe.
- Drei Eigenschaften sind Sicherheitsverhalten, kein Zufall, und je durch einen Unit-Test abgesichert (beide Regressionswächter wurden per Mutation verifiziert):
  - **Fire-and-forget:** kein `await` vor `sendMagicLinkMail(...)`, sonst leakt die SMTP-Latenz die Whitelist-Zugehörigkeit. Test hält das Mailer-Promise offen und prüft, dass der Callback vorher resolved.
  - **Branch-Reihenfolge:** `consumeEmailRateLimit` läuft vor dem Whitelist-Check, damit auch ein Miss Kontingent verbraucht und Enumeration nicht gratis ist.
  - **Whitelist-Miss und Rate-Limit-Miss** führen zu identischem Verhalten (kein Mailversand, unveränderte Response).

### GitHub Actions (`.github/workflows/ci.yml`)

Trigger: `on: push` (alle Branches) + `workflow_dispatch`. Drei Jobs, analog gritshot:

1. **`test`** – Node 24, `npm ci`, `npx playwright install --with-deps`,
   `npm run test:coverage`, `npm run test:e2e`, Coverage als Artefakt hochladen,
   PR-Kommentar via `davelosert/vitest-coverage-report-action`.
2. **`release`** – `needs: test`, nur auf `main`, `cycjimmy/semantic-release-action` mit
   `@semantic-release/git`, GitHub App Token (`CICD_CLIENT_ID` / `CICD_PRIVATE_KEY`).
   Exportiert die Outputs `new_release_published` / `new_release_version` für den
   nachgelagerten Docker-Job. `@semantic-release/npm` schreibt die Version direkt in die
   einzige `package.json` (Quelle für `__APP_VERSION__` im Footer) – kein Sync-Skript nötig.
3. **`docker`** – `needs: [test, release]`, läuft **nur auf `main` und nur wenn ein neues
   Release publiziert wurde** (`needs.test.result == 'success' && github.ref == 'refs/heads/main'
   && needs.release.outputs.new_release_published == 'true'`):
   Build & Push des Root-`Dockerfile` nach `ghcr.io/markdor/glenidunno` mit Tags
   `latest` / `<version>`. Ein einziges Image, Name dynamisch via
   `ghcr.io/${{ github.repository }}` (kein Service-Suffix).

Action-Versionen sinngemäß auf aktuellem Stand pinnen (gritshot aktuell: `checkout@v6`,
`setup-node@v6`, `upload-artifact@v7`, `create-github-app-token@v3`,
`semantic-release-action@v6`, `docker/*` v4/v6/v7).

### PR ↔ Issue-Verknüpfung

`.github/pull_request_template.md` enthält eine `Closes #`-Zeile. Wird dort die Issue-Nummer eingetragen (z. B. `Closes #24`), schließt GitHub das Issue automatisch beim Merge des PRs – kein separater Workflow nötig, funktioniert nativ über GitHubs Closing-Keywords.

### Dependabot Auto-Merge (`.github/workflows/dependabot-automerge.yml`)

Eigener Workflow analog gritshot: `on: pull_request`, nur für PRs von `dependabot[bot]`.
Holt die Metadaten via `dependabot/fetch-metadata`, aktiviert Auto-Merge (squash) für
`version-update:semver-patch`-Updates (`gh pr merge --auto --squash`).

### Logging

- **pino** + **pino-pretty** (nur in Dev).
- Zentraler Logger in `src/lib/server/logger.ts`:
  ```ts
  import pino from 'pino';
  import { dev } from '$app/environment';

  export const logger = pino({
    level: dev ? 'debug' : 'info',
    transport: dev ? { target: 'pino-pretty' } : undefined
  });
  ```

### Error Handling

- **Typisierte Fehlerklassen** mit separater `userMessage` (für die UI) und
  technischer `message` (für Logs) – Muster wie `FileValidationError`:
  ```ts
  export class ValidationError extends Error {
    constructor(message: string, public readonly userMessage: string) {
      super(message);
      this.name = 'ValidationError';
    }
  }
  ```
- **Handler-Pattern** (SvelteKit Action):
  - Validierungsfehler → `fail(422, { userMessage: e.userMessage })`
  - Unerwarteter Fehler → `logger.error(...)` + generische User-Meldung (`fail(500, ...)`)
  - `catch (e: unknown)`, dann via `instanceof` verengen
- Niemals interne Fehlertexte oder Stacktraces an den Nutzer durchreichen.
- **`userMessage`-Vertrag in `fail()`-Payloads**: Jede generische (nicht feld-bezogene) Action-Fehlermeldung nutzt ausschließlich das Feld `userMessage` – nie interne Codes wie `'not_found'`/`'missing_id'` in einem generischen `error`-Feld. Der Client liest `form.userMessage` und zeigt es unverändert per `toast.show('error', …)` an (Muster: `$effect` + `untrack` in `admin/+page.svelte`) – es gibt keinen Guard/Whitelist auf Client-Seite, die Sicherheit kommt allein daher, dass der Server nie einen internen Code in dieses Feld schreibt.
  - **Ausnahme `fieldErrors`**: Per-Feld-Validierungsfehler (z. B. `admin/+page.server.ts`, Codes `required`/`invalid`/`taken`) bleiben ein separates Pattern – dort sind es bewusst kurze, whitelisted Codes, die client-seitig über eine feste Map (`errorText` in `admin/+page.svelte`) in Text übersetzt werden, weil sie inline am jeweiligen Feld angezeigt werden, nicht global im Toast.

Vor neuen Arbeiten in diesen Bereichen: in `gritshot` (Code) bzw. `vps-config/tandoor` (Compose)
verifizieren, ob die Konvention noch aktuell ist.

---

## CLAUDE.md Pflege

Nach jeder abgeschlossenen Feature-Implementierung:

1. Falls das Feature nicht-triviale Entscheidungen enthält (Auth-Sonderfälle, bewusste Scope-Abgrenzungen, unerwartete Constraints), als kurze Sektion in CLAUDE.md ergänzen – nur was **nicht** aus dem Code oder Git-History ableitbar ist.
2. Veraltete oder falsche Aussagen in bestehenden Sektionen korrigieren.

Zukünftige Arbeit wird ausschließlich als GitHub Issue getrackt (Titel + Stub, Refinement via `/refine`) – CLAUDE.md dokumentiert nur den bestehenden Stand und Konventionen, keine Roadmap.