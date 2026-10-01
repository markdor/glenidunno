# Glen Idunno – CLAUDE.md

Selbst gehostete Web-App (PWA) mit Magic-Link-Login, Nutzerverwaltung, Startseite und Whisky-Blindtastings.

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
- Startseite, Login, Admin-Seite (Nutzerverwaltung) und Whisky-Tastings (Admin-Verwaltung unter `/admin/tastings`, öffentliche Teilnehmer-Links unter `/tasting/<token>`, siehe „Whisky-Tasting“)
- Auth: Magic Link per Mail (nodemailer + Hetzner SMTP)
- Session-Dauer: 30 Tage Cookie
- SQLite-Datei liegt in einem Named Docker Volume unter `/data/glenidunno.db` (`DB_PATH`)
- Hochgeladene Tasting-Präsentationen liegen im Named Docker Volume `glenidunno-media` unter `/media` (`MEDIA_PATH`, Default im `Dockerfile`)

---

## UI Design

- Klar und minimalistisch, kein visuelles Rauschen
- **Mobile-first** – primäres Endgerät ist das Smartphone, Touch-Targets großzügig
- Desktop-Layout darf vorhanden sein, hat aber niedrigere Priorität
- Farbschema aus den Logo-Farben: `slate`-Skala als Creme→Dunkelbraun überschrieben (`slate-50` = Creme `#f3ebdd` als Seitenhintergrund, `slate-900` = Dunkelbraun `#2b1a0d` als Text), `brand` = Bernstein `#7d5212` für die Hauptaktion, alles in `layout.css`. Semantische Akzente nur für Status und als Tailwind-Defaults: red für Fehler, emerald für Erfolg, **sky für Info** (nicht amber – wäre von Bernstein nicht unterscheidbar). Gold `#c9973f` nur dekorativ (als Text oder mit weißer Schrift unter AA).
  - `slate-400` wird als Text auf Weiß genutzt (Placeholder, Admin-Metadaten) und ist deshalb bewusst dunkler als üblich (AA auf Weiß) – ein Off-White-Override von `--color-white` würde das kippen.
  - Die Creme steht zusätzlich in `src/app.html` (`theme-color`) und `static/site.webmanifest` – alle drei Stellen zusammen ändern.
- Logo und Fass-Mark liegen als SVG-Dateien in `src/lib/assets/` und werden per `$lib/assets`-Import als `<img>` eingebunden (gehashte Dateinamen, immutable Caching) – nicht inline und nicht über Lucide. `glen-idunno-logo.svg` weicht bewusst vom Original aus Issue #6 ab: `viewBox` auf den Inhalt zugeschnitten (der leere Creme-Rand kostete auf dem Smartphone Platz) und Untertitel „Blind Tasting" ×1,5 samt nach außen gerückter Goldlinien (sonst unlesbar); die eingebettete C2PA-Signatur ist entfernt, weil sie nach der Bearbeitung nicht mehr zum Inhalt passte – bei einem Re-Export des Logos alles wieder anwenden.
- Das Glencairn-Glas im Footer („made with ❤️ and 🥃“ – bewusst Englisch, mit `lang="en"`) ist ebenfalls eine eigene SVG-Datei in `src/lib/assets/`, weil weder Lucide noch Emoji ein Glencairn-Glas haben (🥃 ist ein Tumbler). Mit unter 4 KB inlinet Vite sie als `data:`-URL statt als gehashte Datei.

### Icons

- **`@lucide/svelte`** (nicht das deprecated `lucide-svelte`) für alle Icons, keine handgeschriebenen Inline-`<svg>`s mehr. Farbe läuft weiterhin ausschließlich über `currentColor` + bestehende Tailwind-Textfarbklassen, keine hartkodierten Farben.
- Feste Größen-/Stroke-Konvention statt Ad-hoc-Werten pro Vorkommen:

  | Verwendung | Beispiele | `size` | `strokeWidth` |
  |---|---|---|---|
  | Primäre Buttons | `Plus` | `20` | `2` |
  | Karten-Leiticon (Startseiten-Karte) | `GlassWater` | `20` | `2` |
  | Sekundär (Dropdown-Indikator, Zurück-Link, Kopieren-Button) | `ChevronDown`, `ChevronLeft`, `Copy` | `16` | `2` |
  | Inline-Status (klein, kräftig) | `Check` | `14` | `3` |
  | Toast-Leiticon (visueller Anker) | `CircleAlert`, `CircleCheck`, `Info` | `20` | `2` |
  | Toast-Schließen-Button | `X` | `16` | `2` |
- Keine eigene Icon-Wrapper-Komponente – bei der aktuell überschaubaren Anzahl an Vorkommen reicht die direkte `size`/`strokeWidth`-Prop-Vergabe an der jeweiligen Nutzungsstelle; eine Abstraktion erst einführen, falls sich das Muster wiederholt.

### Startseite (`/`)

Reine Begrüßungsseite, keine Arbeitsfläche. Aufbau von oben nach unten:

1. **Header** – Fass-Mark (dekorativ, `alt=""`) + App-Name links als gemeinsamer Link auf `/`, Username-Dropdown rechts (Logout, ggf. Admin)
2. **Begrüßung** „Hallo {username} 👋"
3. **Admin:** Tasting-Karte (`TastingCard.svelte`) – ersetzt bewusst die frühere Festlegung „keine Module oder Karten“. Zeigt nur Verwaltungsdaten (Name, Datum, „heute“, Fortschritt), vor der Auflösung nie Inhalte. Der Startseiten-`load` (`src/routes/+page.server.ts`) liefert die Daten nur bei `isAdmin`.
   **Alle anderen:** Leerzustand-Hinweis – eine gedämpfte Zeile (`text-slate-500`)

### Komponenten-Konventionen

- **Route-Komponenten nur mit `data`/`form` als Props**: `svelte/valid-prop-names-in-kit-pages` erlaubt in Routen-Komponenten keine eigenen Props. Test-Seams (z. B. eine konfigurierbare Verzögerung) kommen deshalb nicht in eine Prop, sondern in ein eigenes Modul mit Getter und Test-Setter, analog zum `MAGIC_LINK_DEBUG_PATH`-Seam in `auth.ts`.
- **Klickbare Karte mit interaktiven Kindelementen = `<div role="link">`**, kein `<section>` – das löst sonst den A11y-Lint `a11y_no_noninteractive_element_to_interactive_role` aus. Interaktive Elemente in der Karte rufen `event.stopPropagation()`, damit ihr Klick nicht zusätzlich navigiert. Eine Karte ohne verschachtelte Controls ist ein normales `<a>` (z. B. `TastingCard.svelte`).
- **Unter-Header** für Unterseiten: `SubHeader.svelte` (Zurück-Link, Titel, optionaler `action`-Snippet für die Hauptaktion). Die `backHref`-Prop ist als `ResolvedPathname` (aus `$app/types`) typisiert, weil `svelte/no-navigation-without-resolve` jedes `href` ohne `resolve()`-Ergebnis ablehnt.
- **Dynamische externe Links** (z. B. der Whiskybase-Link) brauchen `rel="external noopener noreferrer"`: Dieselbe Lint-Regel akzeptiert ein `href` aus einer Variable nur mit `external` im `rel`.
- **Bestätigungsdialoge in `use:enhance`-Formularen** über `cancel()` im Submit-Callback (`use:enhance={({ cancel }) => { if (!confirm(…)) cancel(); }}`), nie über `preventDefault()` im `onsubmit`: `enhance` prüft `defaultPrevented` nicht und schickt den Request sonst trotzdem ab (so geschehen beim Löschen auf der Admin-Seite).

### Toast / Status-Hinweise

- Globale Komponente `src/lib/components/Toast.svelte` + Store `src/lib/components/toastStore.svelte.ts` (`toast.show(variant, message, durationMs?)`), einmalig in `+layout.svelte` gemountet – einzige Quelle für kurzzeitige Status-Hinweise (Error/Success/Info), löst alle Ad-hoc-Boxen ab.
- `toastStore.svelte.ts` (nicht `toast.svelte.ts`: kollidiert TS-seitig case-insensitive mit `Toast.svelte`, sobald ohne Extension importiert – `forceConsistentCasingInFileNames` schlägt plattformunabhängig zu) ist der erste modul-globale `$state`-Runes-Store im Projekt (kein Svelte-Store-API, sondern reines `$state` + Getter auf Modulebene).
- **Fallstrick:** Wird `toast.show(...)` aus einem `$effect` heraus aufgerufen (z. B. um einen Server-Fehler aus `data`/`form` zu melden), muss der Aufruf in `untrack(() => …)` (aus `'svelte'`) gewrappt werden – sonst hängt der Effect transitiv vom internen State des Stores ab (der Store liest beim Schreiben seinen eigenen Zustand) und läuft in eine Endlosschleife (`effect_update_depth_exceeded`).

---

## Authentifizierung

- **Closed App – keine anonyme Nutzung.** Jeder nicht eingeloggte Request wird auf `/login` umgeleitet. Außer der `/login`-Route, `/health`, den Better-Auth-Endpoints unter `/auth/*`, den Tasting-Teilnehmer-Links (siehe unten) und statischen Assets ist nichts öffentlich erreichbar – auch `/api/*` nicht, das keine Sonderbehandlung hat.
  - Implementierung als globaler Auth-Guard in `hooks.server.ts`: Session prüfen, sonst `throw redirect(302, '/login')`.
  - **Ausnahme Tasting-Link**: öffentlich sind genau die Route-IDs `/tasting/[token=tastingToken]` und `/tasting/[token=tastingToken]/presentation/[bottleId]` (Präsentations-Download) – exakte Liste `PUBLIC_ROUTE_IDS` in `guard.ts` (`GuardContext.routeId` aus `event.route.id`), kein Präfix-Match auf den Pfad. Lehnt der Param-Matcher `src/params/tastingToken.ts` ein Token ab, gibt es keine Route (`route.id === null`), und die Anfrage bleibt geschützt (anonym → Login, eingeloggt → 404). Weitere öffentliche Routen nur über diese Liste, nie per Pfad-Präfix.
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
  - Schema in `src/lib/server/db/schema.ts` → `npm run db:generate -- --name <sprechender-name>` erzeugt versioniertes SQL-File in `./drizzle/` (ohne `--name` vergibt Drizzle Kit einen Zufallsnamen)
  - Drizzle Kit schreibt `drizzle/meta/*.json` mit Leerzeichen-Einrückung – danach `npx prettier --write drizzle/meta`, sonst scheitert `npm run lint`
  - `schema.ts` importiert Konstanten relativ (`../../validation`), nicht über `$lib`: Drizzle Kit lädt die Datei außerhalb von Vite und kennt den Alias nicht
  - **CHECK-Constraints** (erstmals bei den Tasting-Tabellen) leiten ihre Grenzen aus den Konstanten in `validation.ts` ab und setzen sie per `sql.raw(String(K))` ein – als normale Template-Parameter landen sie als `?` in der Migration. Die generierte SQL-Datei auf die Grenzwerte prüfen; `schema.test.ts` sichert das ab.
  - **Keinen CHECK nachträglich zu einer bestehenden Tabelle hinzufügen**: Drizzle Kit baut die Tabelle dafür neu (`__new_…` + `INSERT … SELECT`), und das generierte `INSERT … SELECT` liest neu hinzukommende Spalten aus der alten Tabelle – die Migration bricht ab (so geschehen bei `presentation_name`, dort deshalb kein CHECK). Neue Spalten ohne CHECK ergeben ein schlichtes `ALTER TABLE … ADD`. Committete Migrationen werden nie umgeschrieben, Änderungen kommen als neue Migration.
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

## Whisky-Tasting

Blindtastings: Der Admin legt unter `/admin/tastings` ein Tasting mit Datum und Teilnehmern an, jeder Teilnehmer trägt seine Flaschen ohne Login über einen persönlichen Token-Link (`/tasting/[token=tastingToken]`) ein, die App berechnet die Tastingreihenfolge.

- **Phasen aus dem Datum** (kein Status-Feld), berechnet vom Server in `Europe/Berlin` (`tastingPhase.ts`, `Intl.DateTimeFormat` – der Container läuft in UTC):
  - `entry` bis 18:00 am Tasting-Tag, `order` ab 18:00, `revealed` ab 9:00 am Folgetag. Zeitzone und Uhrzeiten sind Konstanten in `src/lib/tasting.ts`, nicht pro Tasting einstellbar.
  - `tasting_date` ist deshalb ein Kalenderdatum (`text`, `YYYY-MM-DD`) statt eines Zeitstempels – bewusste Abweichung vom Timestamp-Standard.
  - **Admin-Buttons überstimmen die Uhr** (nachträglich gewünscht, entgegen dem ursprünglichen Nicht-Ziel „keine manuelle Status-Steuerung“ aus Issue #5): „Reihenfolge jetzt freigeben“ (18-Uhr-Button, nur in `entry`) setzt `tasting.order_opened_at`, „Jetzt auflösen“ (9-Uhr-Button, nur in `order` – die Reihenfolge lässt sich nicht überspringen, auch serverseitig in `revealEarly()` geprüft) setzt `tasting.revealed_at`. Die Admin-Seite zeigt beide Buttons in jeder Phase, aktiv ist nur der für den nächsten Schritt. Die Zeitstempel ziehen die Phase nur vor, nie zurück, und lassen sich nicht zurücknehmen (Bestätigungsdialog). Jeder Link und die Admin-Seite zeigen per `TastingManualNotice.svelte`, wann der Admin gedrückt hat (Berliner Zeit). Jede Phasenberechnung muss deshalb die beiden Spalten mitlesen (`getTastingPhase(date, now, manual)`) – auch die Speichern-Transaktion, damit ein Button-Druck die Eingabe sofort sperrt.
- **Blind für alle, auch für den Admin** (er verkostet mit): Die Admin-Seite `/admin/tastings/[id]` zeigt in **keiner** Phase Whisky-Inhalte – weder Flaschen noch Reihenfolge, Auflösung, Graph oder Präsentationen –, nur Verwaltung (Teilnehmer mit Fortschritt, Links, Datum, 18-/9-Uhr-Buttons, Löschen). Reihenfolge und Auflösung sieht der Admin wie alle anderen über seinen eigenen Teilnehmer-Link. Bewusst keine gemeinsame Route mit Admin-Buttons: Die öffentliche Token-Route liest `locals.user` nie, und die Teilnehmerseite hängt an einem Teilnehmer, die Admin-Seite am Tasting. Die frühere Score-Aufschlüsselung für den Admin ist deshalb entfallen.
  - Welche Felder ein `load` liefert, entscheidet ausschließlich die Projektion in `src/lib/server/tastings.ts` (Felder explizit gepickt, nie gespreadet) – phasenabhängig für die Teilnehmerseite, reine Verwaltungsdaten für Admin-Seiten und Startseite. Ausblenden im Template reicht nicht, `data` landet komplett im HTML bzw. `__data.json`. Der Whiskybase-Link zählt als Inhalt.
  - In `entry` werden fremde Flaschen gar nicht erst abgefragt; `order` liefert nur `{ position, alias, score }` (Gesamtscore für den Chart, siehe Score-Entwicklungs-Chart) – keine Faktoren, keine Aufschlüsselung.
- **Token-Links**: 192 Bit (`randomBytes(24)`, base64url), gespeichert nur als SHA-256-Hash. Den Klartext gibt es nur in der Antwort der Actions „Anlegen“ und „Link neu generieren“ – der Admin sieht jeden Link genau einmal, als Text (nicht klickbar). Gründe: Links laufen nie ab (ein DB-Backup soll keine gültigen Links enthalten), und der Admin soll fremde Links später nicht öffnen können. „Neu generieren“ ersetzt nur den Hash, die Eingaben bleiben.
  - Token-Lookup ist eine einzige Query über `token_hash`: unbekannte, gelöschte und ersetzte Tokens enden im selben `error(404)`.
  - Die öffentliche Route liest `locals.user` nie, `participantId` kommt nur aus dem Token, aus `FormData` nur freigegebene Felder. `GET` hat keine Nebenwirkungen (Messenger-Link-Previews).
  - Bewusst **kein** eigener `handleError`: SvelteKits Standard loggt bei Fehlern den Pfad samt Token – akzeptiert.
- **Rate-Limit**: nur ein Schreib-Limit pro Teilnehmer auf der Speichern-Action (`tastingWriteThrottle.ts`, 30 / 10 min, Muster `consumeEmailRateLimit`, → `fail(429)`). Bewusst **kein** Limit pro IP: 192-Bit-Tokens sind nicht zu erraten, und ohne gesetztes `ADDRESS_HEADER` sieht `getClientAddress()` hinter Traefik nur die Proxy-IP.
- **Speichern** prüft Phase `entry`, Slot und Synonym-Eindeutigkeit in derselben Transaktion wie den Upsert (kein TOCTOU um 18:00). Der Synonym-Vergleich läuft in JS (`toLocaleLowerCase('de-DE')`), weil SQLites `lower()` nur ASCII faltet. Ist die Eingabe geschlossen, antwortet die Action mit `reload: true`, und die Seite lädt per `invalidateAll()` die Reihenfolge nach.
- **Security-Header** (`securityHeaders.ts`, gesetzt in `hooks.server.ts` nach `resolve()`, damit auch `__data.json`, Actions und die 404 abgedeckt sind): Teilnehmer-Route `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`, `Cache-Control: no-store`; `/admin/tastings/*` `Cache-Control: no-store` (einmalige Link-Anzeige). **Kein** `Disallow: /tasting/` in `robots.txt` – Crawler sähen das `noindex` sonst nie.
- Der Seitentitel der Teilnehmerseite bleibt neutral („Whisky-Tasting“): Namen und Synonyme gehören weder in `<title>` noch in Meta-Tags (Messenger-Previews).
- **Score/Reihenfolge** (`tastingScore.ts`, Berechnung; Gewichte/ABV-Spanne/Rauchgruppen als Konstanten in `tasting.ts`, Startwerte): Punkte pro Faktor werden einzeln berechnet und der Score vor dem Sortieren auf eine Stelle gerundet – sonst kehrt Float-Rauschen den Tie-Breaker um. Die Konstanten liegen bewusst im client-sicheren `tasting.ts` statt bei der Berechnung in `$lib/server`, weil die Kachel `TastingScoreExplainer.svelte` (Teilnehmerseite, Phase `order`) dieselben Zahlen anzeigt und keinen Server-Import machen darf.
  - **Alkohol normalisiert nicht linear, sondern geknickt** (`normalizeAbv()` in `tasting.ts`, Knick bei `ABV_KINK` = 50 % vol.): unterhalb des Knicks eine flachere Steigung, oberhalb doppelt so steil bis zur Decke `ABV_FLOOR + ABV_SPAN` – Stärke jenseits von 50 % vol. soll den Faktor überproportional treiben. Beide Segmente sind exakt so skaliert, dass sie bei `ABV_FLOOR` weiterhin bei 0 und bei der Decke weiterhin bei 1 ankommen (kein Sprung, nur ein Knick).
  - **Rauchgruppen 0 | 1–3 | 4–5** („ungetorft“, „rauchig“, „stark rauchig“, `SMOKE_GROUPS` in `tasting.ts`, vorher 0–1 | 2–3 | 4–5): bildet die Einteilung aus den echten Tastings nach. Die erste Grenze liegt bewusst zwischen 0 und 1, weil „getorft ja/nein“ die einzige Frage ist, die alle Teilnehmer gleich beantworten – und alles Getorfte wird nach allem Ungetorften ausgeschenkt, auch nach der schwersten Sherry-Bombe. Die Gruppennamen erscheinen im Regler-Hinweis, als Live-Anzeige neben dem Reglerwert (eigene Flasche, verrät nichts) und in der Erklärkachel – bewusst ohne Referenzflaschen oder weitere Erläuterungen.
  - **Gewichte Rauch 0,4 · Fass 0,3 · Alkohol 0,1 · Kaliber 0,2** (Alkohol und Kaliber nachträglich getauscht): Rauch und Fass bleiben am Gaumen hängen, die Schärfe eines Fassstärke-Drams spült ein Schluck Wasser weg – Alkohol wiegt deshalb am wenigsten. Kaliber schiebt die Highlights ans Ende ihrer Rauchgruppe, soll aber Fass nicht eins zu eins überstimmen (zarte Highlights weiter vor Sherry-Bomben). Nicht höher als 0,2, weil jeder Teilnehmer das Kaliber seiner eigenen Flasche selbst einschätzt. Bei identischem Score entscheiden die Rohwerte in derselben Reihenfolge nach Gewicht (`SCORE_FACTORS_BY_WEIGHT`, gemeinsame Quelle für Sortierung und Erklärkachel), zuletzt der Flaschenname.
  - Die Reihenfolge wird **nicht gespeichert**, sondern bei jedem `load` neu berechnet: Geänderte Gewichte oder Gruppengrenzen ordnen auch bereits aufgelöste Tastings nachträglich um – nicht während eines laufenden Tastings deployen.
- **Score-Entwicklungs-Chart** (`TastingScoreChart.svelte`, Teilnehmerseite, Phase `revealed`, neben `TastingScoreExplainer`): Vier-Linien-SVG-Chart (Rauch/Fass/Alkohol/Kaliber über die Ausschankreihenfolge), handgebaut ohne Chart-Library (Projekt hat sonst keine). Der Plot selbst liegt in `TastingLineChart.svelte` und wird von beiden Chart-Kacheln genutzt.
  - **Phase `order` zeigt nur den Gesamtscore** (`TastingOrderChart.svelte`, nachträglich gewünscht): genau eine Linie im Marken-Bernstein (`#7d5212`), Y-Achse in Score-Punkten (0–100, ohne Einheit). Bewusst reduziert (`bottleMarks={false}` an `TastingLineChart`): keine vertikalen Hilfslinien, keine X-Achsen-Beschriftung, keine Datenpunkte – die Synonyme stehen in der Liste darüber. Ohne Beschriftung schrumpft der Flaschenabstand bis auf 24 px, statt ab 88 px horizontal zu scrollen. **Keine Interaktion** (nachträglich gewünscht): Ohne `describePoint` rendert `TastingLineChart` keine Hover-/Tipp-/Fokus-Ziele, der Chart zeigt nur den Verlauf, nie den Score einer einzelnen Flasche. Das verhindert nur das beiläufige Ablesen – die Scores stecken weiter in `data` und in den Pfad-Koordinaten der Linie, ohne die sich der Chart nicht zeichnen lässt. Ein vorheriger Versuch mit vier namenlosen, einfarbigen Faktor-Linien wurde wieder verworfen – Faktoren gibt es erst mit der Auflösung. Bewusst hingenommen: Score und Reihenfolge zusammen verraten, wo eine neue Rauchgruppe beginnt (die Linie fällt dort ab, sofern der Score sinkt), und grob, wie kräftig eine Flasche ist.
  - **Y-Achse ist der normalisierte Faktor (0–100 %)**, nicht die Rohwerte: Rauch/Fass/Kaliber (Skala 0–5) und Alkohol (35–75 % vol.) haben unvereinbare Einheiten – „ein Chart, eine Achse" statt einer irreführenden Zweitachse. `normalizeScoreFactors()` (jetzt in `tasting.ts`, vorher Duplikat in `tastingScore.ts`) ist die gemeinsame Quelle für Chart und Score-Berechnung. Die Rohwerte (fürs Verständnis unverzichtbar) stehen weiterhin in der Live-Anzeige beim Hover/Fokus einer Flasche.
  - **Kategoriale Farben** (Blaugrau/Braun/Rot/Gold, an die Bedeutung der vier Faktoren angelehnt) sind bewusst nicht Teil der Marken-/Slate-Palette: vier an einer Weiß-Fläche validierte Werte (siehe `dataviz`-Skill), fest den vier Faktoren zugeordnet. Ein **echtes neutrales Grau für „Rauch" ist mit dieser Methode nicht möglich**: jeder Farbton, den man tatsächlich als Grau wahrnimmt, liegt in der Chroma weit unter der Skill-Untergrenze von 0,10 (validiert u. a. an Tailwinds `gray-600`/`slate-600`, beide ~0,02–0,04) und fiele durch die Prüfung – „Rauch" ist deshalb ein dunkles Blaugrau, der nächstliegende noch bestehende Ton. Gold sitzt unter 3:1 Kontrast auf Weiß, Braun/Rot liegen mit ΔE 7,9 im CVD-Floor-Band (nur mit Sekundärkodierung zulässig) – deshalb trägt jede Linie zwingend ein direktes Endlabel (nie nur Farbe als Unterscheidungsmerkmal), inklusive kollisionsvermeidender Stapelung mit Leader-Lines bei eng beieinanderliegenden Werten.
  - **Keine separate Tabellenansicht**: Die Rohwerte jeder Flasche stehen unmittelbar darüber bereits als Text in `TastingReveal.svelte` (Rauch/Fass/Alkohol/Kaliber), das übernimmt die Rolle der barrierefreien Chart-Alternative.
- **Präsentation pro Flasche** (optional, meist PowerPoint, höchstens 30 MB, `TASTING_PRESENTATION_MAX_BYTES`): Upload über die Speichern-Action (`multipart/form-data`), Ablage byte-genau in `MEDIA_PATH` (`tastingMedia.ts`).
  - **Dateiname auf der Platte**: festes Schema `Tasting_<YYYY-MM-DD>_<Synonym>[.<endung>]` (`presentationFiles.ts`), z. B. `Tasting_2026-10-24_Nebel.pptx` – nie der Client-Name.
    - Das Synonym ist Benutzereingabe: Außer Buchstaben (inkl. Umlaute), Ziffern, `-` und `_` wird alles zu `_` (kein Path Traversal, keine Punkte). Vor jedem Plattenzugriff prüft `tastingMedia.ts` den Namen gegen `PRESENTATION_FILE_RE`.
    - Eindeutigkeit gegen alle Namen in der DB, ohne Beachtung der Groß-/Kleinschreibung (Windows-Dev-Rechner): zwei Tastings am selben Tag mit gleichem Synonym oder nach dem Bereinigen gleiche Synonyme bekommen `_2`, `_3`, ….
    - Der Name bleibt aktuell: ein geändertes Synonym benennt die Datei beim Speichern um, eine Datumsänderung (`updateTastingDate`) alle Dateien des Tastings.
    - Der Originalname steht in `tasting_bottle.presentation_name` und dient als Anzeige- und Download-Name.
  - Die Datei **und ihr Name** zählen als Inhalt (der Name verrät oft den Whisky): vor der Auflösung sieht nur der Besitzer den Namen seiner eigenen Datei, herunterladen kann sie niemand. Nach der Auflösung verlinken nur die Teilnehmer-Links die Datei (`/tasting/[token]/presentation/[bottleId]`, zweite exakte öffentliche Route-ID im Guard) – einen Admin-Download gibt es nicht; alles andere ist eine einheitliche 404.
  - Download immer als `Content-Disposition: attachment` mit `application/octet-stream`, `nosniff` und CSP-Sandbox: eine hochgeladene HTML-/SVG-Datei darf nie auf dem App-Origin rendern.
  - **Ablauf beim Speichern**: Der Upload landet zuerst in einer temporären Datei `.upload-<uuid>` (`stageUpload`), damit ein volles Laufwerk auffällt, bevor etwas gespeichert ist. Name, Phase, Slot und Synonym werden in der DB-Transaktion entschieden (`saveBottle` → `fileChanges`), erst danach verschiebt/löscht `applyFileChanges` die Dateien. Grund: Ein Re-Upload mit gleichem Synonym hat denselben Namen und würde die bisherige Datei sonst überschreiben, obwohl das Speichern noch abgelehnt werden kann (Synonym vergeben, Eingabe geschlossen). Bei Ablehnung wird nur die Temp-Datei gelöscht. Beim Löschen eines Tastings löscht die Route alle seine Dateien (`listPresentationFiles()` vor `deleteTasting()`, der Cascade entfernt nur Zeilen). Das Schreib-Limit greift vor dem Parsen des Bodys.
  - **Request-Größe**: adapter-node lehnt Bodies über 512 KB ab, deshalb setzt der `Dockerfile` `BODY_SIZE_LIMIT=31M`. Das gilt für alle Routen – der `bodyLimitHandle` (erster Hook, `bodyLimit.ts`) hält per `Content-Length` alles außer dem POST auf die Teilnehmer-Route bei 512 KB, sonst nähmen z. B. die anonymen `/auth/*`-Endpoints 31 MB an. `vite dev`/`vite preview` haben gar kein Limit, Größenfehler zeigen sich also erst im Container.

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
MEDIA_PATH=/media          # Präsentations-Uploads (Volume glenidunno-media), lokal ./media
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
  - Die Tasting-Grenzen (`TASTING_*`, `TASTING_TOKEN_RE`, `normalizeWhiskybaseUrl()`) liegen ebenfalls dort und sind zugleich die einzige Quelle für Formular-Attribute, Server-Validierung und die CHECK-Constraints im Schema.
  - Fachliche Tasting-Konstanten, Typen und Anzeige-Helfer (Zeitzone, 18-/9-Uhr-Grenze, `TastingPhase`, `TastingBottle`, die View-Typen der Projektion, `formatBottleName()`) liegen in `src/lib/tasting.ts` – ebenfalls ohne Server-Importe, weil Teilnehmerseite und Param-Matcher im Browser laufen.
- **Kein Monorepo** – eine SvelteKit-App im Repo-Root, keine npm Workspaces, kein Nx/Turborepo
- **Kein Postgres** – SQLite ist für diesen Use Case ausreichend, einfacher zu backupen
- **Named Docker Volumes** für SQLite (`/data`) und die Präsentations-Uploads (`glenidunno-media`, `/media`), kein Bind Mount

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
  - Keine Zufallswerte in Testtiteln (z. B. `randomUUID()` in einer Titel-Schleife): Playwright sammelt Tests im Hauptprozess und im Worker getrennt ein und findet den Test sonst nicht wieder („Test not found in the worker process“).
  - Die Server-Uhr lässt sich aus Playwright nicht steuern: `tasting.e2e.ts` erreicht Reihenfolge und Auflösung über die Admin-Buttons, den uhrzeitbasierten Wechsel um 18 und 9 Uhr testen nur Route-Tests (`vi.setSystemTime()`) und Komponenten-Tests.
- **Submit-Callbacks von `use:enhance`** (Toast, `update({ reset: false })`, `invalidateAll()`) testet man mit gemocktem `$app/forms` und `$app/navigation` (Muster `TastingBottleForm.svelte.test.ts`): Das echte `update()` braucht einen laufenden SvelteKit-Client. Für reine Bestätigungsdialoge bleibt das echte `enhance` mit abgefangenem `fetch` die Vorlage (`admin/page.svelte.test.ts`).
- **Tests mit Cascade-Löschungen** auf einer eigenen In-Memory-DB müssen `pragma('foreign_keys = ON')` setzen – SQLite erzwingt Fremdschlüssel sonst nicht.
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
  Erste Umsetzung im Projekt: `TastingValidationError` in `src/lib/server/tastings.ts` für Regelverstöße der Domain-Schicht (Speichern außerhalb der Eingabephase, Datumsänderung außerhalb der Eingabephase, ungültiger Slot, Admin-Button für eine schon erreichte Phase).
- **Handler-Pattern** (SvelteKit Action):
  - Validierungsfehler (typisierte Fehlerklasse, nicht feld-bezogen) → `fail(422, { userMessage: e.userMessage })`; feld-bezogene Fehler laufen weiter über `fieldErrors` mit `fail(400)` bzw. `fail(409)` für `taken` (siehe unten)
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