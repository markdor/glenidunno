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

Docker Compose (App plus Gotenberg für den Präsentations-Viewer), deployed auf Hetzner VPS hinter Traefik v3.

---

## Stack

| Bereich | Technologie |
|---|---|
| Frontend + Backend | SvelteKit (PWA-fähig) |
| Datenbank | SQLite via Drizzle ORM |
| Auth | Magic Link via nodemailer (Hetzner SMTP) |
| Präsentations-Viewer | pdf.js im Browser, Office-Dateien per Gotenberg (LibreOffice) zu PDF |
| Deployment | Docker Compose + Traefik v3 (Hetzner VPS) |

---

## Services (Docker Compose)

### `app` – SvelteKit
- Startseite, Login, Admin-Seite (Nutzerverwaltung), Whisky-Tastings (Admin-Verwaltung unter `/admin/tastings`, Teilnehmerseite mit Login-Pflicht unter `/tasting/<adjektiv>-<tier>`, siehe „Whisky-Tasting“), Statistiken über alle aufgelösten Tastings (`/statistics`, siehe „Statistikseite“) und deren Flaschen als Tabelle (`/history`, siehe „Historie“)
- Auth: Magic Link per Mail (nodemailer + Hetzner SMTP)
- Session-Dauer: 30 Tage Cookie
- SQLite-Datei liegt in einem Named Docker Volume unter `/data/glenidunno.db` (`DB_PATH`)
- Hochgeladene Tasting-Präsentationen liegen im Named Docker Volume `glenidunno-media` unter `/media` (`MEDIA_PATH`, Default im `Dockerfile`)

### `gotenberg` – Umwandlung für den Präsentations-Viewer
- Wandelt Office-Präsentationen per LibreOffice in PDF (siehe „Präsentationen ansehen“). Nur für `app` erreichbar (`GOTENBERG_URL`, Default `http://gotenberg:3000` im `Dockerfile`): keine Ports, kein Traefik, keine Labels, kein Volume.
- Image `gotenberg/gotenberg:<version>-libreoffice`: die offizielle Variante ohne Chromium (statt Vollimage mit `--chromium-disable-routes`). Gepinnt und per Dependabot (`docker-compose`) aktuell gehalten, weil LibreOffice hochgeladene Dateien parst. Flags in `compose.yaml` gegen die gepinnte Version geprüft: `--api-timeout=120s`, Download-From und Webhooks aus (die App schickt nur Dateien), `--libreoffice-deny-private-ips` gegen SSRF über verlinkte Inhalte, `--libreoffice-auto-start`.
- `app` hat bewusst **kein** `depends_on` darauf: Ohne Gotenberg (auch ohne `GOTENBERG_URL`, lokale Entwicklung) startet die App, Original-PDFs bleiben ansehbar, Office-Dateien zeigen den Fehlerzustand des Viewers.

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
  | Karten-Leiticon (beide Tasting-Karten, Tasting-Verwaltung) | `GlassWater` | `20` | `2` |
  | Dashboard-Kachel | `RotateCcwClock`, `ChartColumn` | `20` | `2` |
  | Sekundär (Dropdown-Indikator, Zurück-Link, Kopieren-Button, Aktion der Tasting-Karten, Link „Ansehen“, Download im Viewer) | `ChevronDown`, `ChevronLeft`, `Copy`, `ChevronRight`, `Eye`, `Download` | `16` | `2` |
  | Steuerleiste des Präsentations-Viewers (Blättern, Zoom, Vollbild, Buttons 44 px) | `ChevronLeft`, `ChevronRight`, `ZoomOut`, `ZoomIn`, `Maximize`, `X` (Vollbild beenden) | `20` | `2` |
  | Sortier-Indikator (Spaltenköpfe und Richtungs-Button der Tabelle der Historie) | `ArrowUp`, `ArrowDown`, `ArrowUpDown` (unsortierte Spalte, `slate-400`) | `16` | `2` |
  | Inline-Status (klein, kräftig) | `Check` | `14` | `3` |
  | Toast-Leiticon (visueller Anker) | `CircleAlert`, `CircleCheck`, `Info` | `20` | `2` |
  | Toast-Schließen-Button | `X` | `16` | `2` |
- Keine deprecated Aliase importieren: `@lucide/svelte` benennt Icons um und behält den alten Namen nur als `@deprecated`-Alias (z. B. `History` → `RotateCcwClock`) – vor der Wahl eines Icons in `dist/aliases/aliases.d.ts` nachsehen.
- Keine eigene Icon-Wrapper-Komponente – bei der aktuell überschaubaren Anzahl an Vorkommen reicht die direkte `size`/`strokeWidth`-Prop-Vergabe an der jeweiligen Nutzungsstelle; eine Abstraktion erst einführen, falls sich das Muster wiederholt.

### Startseite (`/`) – Dashboard

Aufbau von oben nach unten:

1. **Header** – Fass-Mark (dekorativ, `alt=""`) + App-Name links als gemeinsamer Link auf `/`, Username-Dropdown rechts (Logout, ggf. Admin)
2. **Begrüßung** „Hallo {username} 👋" – bleibt `<h1>`, `auth-login.e2e.ts` prüft darauf
3. **Tasting-Karten** (für alle): „Nächstes Tasting“ und „Letztes Tasting“, beide aus einem `getDashboardTasting()`-Aufruf (`nextTasting`/`lastTasting`). Sie zeigen Titel, Motto (falls gesetzt) und Datum und sind immer sichtbar, ohne passendes Tasting als nicht klickbarer Leerzustand (`<div>`), auch beim Admin ohne Teilnahme. Ein gemeinsames Grid mit `auto-rows-fr` macht beide gleich hoch. Das gemeinsame Aussehen liefert `DashboardTastingShell.svelte`, generisch über den Tasting-Typ, damit die Snippets der Karten ohne Null-Prüfung auskommen.
   - **„Nächstes Tasting“** (Hero, `DashboardTastingCard.svelte`): das früheste eigene, noch nicht aufgelöste Tasting, mit Phase und Fortschritt der eigenen Flaschen (Soll siehe „Flaschen pro Teilnehmer“; der Gesamtfortschritt bleibt eine Information für den Admin), sonst „Kein Tasting geplant.“. Die Phase wird pro Tasting berechnet, weil die Admin-Buttons ein späteres Tasting vor ein früheres ziehen können. Bewusst kein Rückfall auf das letzte Tasting mehr: Bis #19 war der Hero beides, und sobald ein neues Tasting geplant war, kam man über die Oberfläche nicht mehr an die letzte Auflösung.
   - **„Letztes Tasting“** (`DashboardLastTastingCard.svelte`): das zuletzt aufgelöste eigene Tasting (spätestes Datum), verlinkt „Zur Auflösung“, sonst „Noch kein Tasting aufgelöst.“. Ohne Phase, Fortschritt oder Inhalte – die Auflösung selbst bleibt auf der Teilnehmerseite.
   - Die beiden Karten sind der einzige Weg über die Oberfläche auf die Teilnehmerseite eines kommenden Tastings. Aufgelöste eigene Tastings verlinkt außerdem die Tabelle der Historie (Datum).
4. **Admin:** `TastingCard.svelte` („Tasting-Verwaltung“) – der einzige Einstieg in die Tasting-Verwaltung (der Header verlinkt nur `/admin`). Angelegt wird über „Neues Tasting“ auf `/admin/tastings`, die gleichnamige Dashboard-Kachel ist mit #19 als Doppelung entfallen. Die Karte zeigt Verwaltungsdaten aller Tastings: bis zu 3 anstehende mit dem Fortschritt aller Teilnehmer (Summe ihrer Soll-Werte, siehe „Flaschen pro Teilnehmer“), ohne Motto. Der `load` liefert `tastingSummary` nur bei `isAdmin`.
5. **Kachelraster** (`DashboardTile.svelte`, `grid-cols-2`, gleich hohe Zeilen):
   - „Historie“ verlinkt seit #36 auf `/history`, „Statistiken“ seit #25 auf `/statistics` – jeweils der einzige Einstieg, beide für alle. „Abgeschlossene Tastings“ ist mit #19 entfallen, es überschnitt sich mit „Historie“.
   - Eine Kachel ohne `href` ist ein deaktivierter Platzhalter für einen Bereich, den es noch nicht gibt: ein `<div>`, nicht fokussierbar, ohne Hover, mit Badge „Demnächst“. Derzeit nutzt ihn keine Kachel, der Zweig in `DashboardTile.svelte` bleibt für künftige Bereiche.
   - Bei ungerader Kachelzahl erstreckt sich die letzte über beide Spalten, statt eine Lücke zu lassen (greift bei den derzeit zwei Kacheln nicht, bleibt für künftige Bereiche).

### Komponenten-Konventionen

- **Route-Komponenten nur mit `data`/`form` als Props**: `svelte/valid-prop-names-in-kit-pages` erlaubt in Routen-Komponenten keine eigenen Props. Test-Seams (z. B. eine konfigurierbare Verzögerung) kommen deshalb nicht in eine Prop, sondern in ein eigenes Modul mit Getter und Test-Setter, analog zum `MAGIC_LINK_DEBUG_PATH`-Seam in `auth.ts`.
- **Klickbare Karte mit interaktiven Kindelementen = `<div role="link">`**, kein `<section>` – das löst sonst den A11y-Lint `a11y_no_noninteractive_element_to_interactive_role` aus. Interaktive Elemente in der Karte rufen `event.stopPropagation()`, damit ihr Klick nicht zusätzlich navigiert. Eine Karte ohne verschachtelte Controls ist ein normales `<a>` (z. B. `TastingCard.svelte`).
- **Unter-Header** für Unterseiten: `SubHeader.svelte` (Zurück-Link, Titel, optionaler `action`-Snippet für die Hauptaktion). Die `backHref`-Prop ist als `ResolvedPathname` (aus `$app/types`) typisiert, weil `svelte/no-navigation-without-resolve` jedes `href` ohne `resolve()`-Ergebnis ablehnt.
- **Dynamische externe Links** (z. B. der Whiskybase-Link) brauchen `rel="external noopener noreferrer"`: Dieselbe Lint-Regel akzeptiert ein `href` aus einer Variable nur mit `external` im `rel`.
- **Zusatztext für Screenreader**: Ein `sr-only`-Teil (absolut positioniert) bekommt in Chromium immer ein Leerzeichen davor im berechneten Namen: Aus „Ansehen“ + „: Präsentation …“ wird „Ansehen : Präsentation …“. Komponenten-Tests sehen das nicht, sie laden kein Tailwind. Unkritisch, wo ohnehin ein Leerzeichen davorsteht (Download-Link „Präsentation `<sr-only>`zu …“); sonst ein `aria-label`, das das sichtbare Wort enthält (Link „Ansehen“: „Präsentation zu <Synonym> ansehen“).
- **Bestätigungsdialoge in `use:enhance`-Formularen** über `confirmDialog.submit(event, message, options?)` (`confirmDialogStore.svelte.ts`, `<ConfirmDialog />` einmalig in `+layout.svelte`): Der Button ist `type="button"`, sein `onclick` ruft `submit()` auf, ohne vorher etwas zu `await`en. Der Helfer hält das Formular des Buttons vor dem Dialog fest und schickt es bei Ja per `requestSubmit()` ab; steckt der Button in keinem Formular, wirft er sofort. Ein `cancel()` im Submit-Callback kann den Dialog nicht abwarten, es muss synchron laufen. Nie über `preventDefault()` im `onsubmit`: `enhance` prüft `defaultPrevented` nicht und schickt den Request sonst trotzdem ab (so geschehen beim Löschen auf der Admin-Seite).

### Toast / Status-Hinweise

- Globale Komponente `src/lib/components/Toast.svelte` + Store `src/lib/components/toastStore.svelte.ts` (`toast.show(variant, message, durationMs?)`), einmalig in `+layout.svelte` gemountet – einzige Quelle für kurzzeitige Status-Hinweise (Error/Success/Info), löst alle Ad-hoc-Boxen ab.
- `toastStore.svelte.ts` (nicht `toast.svelte.ts`: kollidiert TS-seitig case-insensitive mit `Toast.svelte`, sobald ohne Extension importiert – `forceConsistentCasingInFileNames` schlägt plattformunabhängig zu) ist der erste modul-globale `$state`-Runes-Store im Projekt (kein Svelte-Store-API, sondern reines `$state` + Getter auf Modulebene).
- **Fallstrick:** Wird `toast.show(...)` aus einem `$effect` heraus aufgerufen (z. B. um einen Server-Fehler aus `data`/`form` zu melden), muss der Aufruf in `untrack(() => …)` (aus `'svelte'`) gewrappt werden – sonst hängt der Effect transitiv vom internen State des Stores ab (der Store liest beim Schreiben seinen eigenen Zustand) und läuft in eine Endlosschleife (`effect_update_depth_exceeded`).

---

## Authentifizierung

- **Closed App – keine anonyme Nutzung.** Jeder nicht eingeloggte Request wird auf `/login` umgeleitet. Außer der `/login`-Route, `/health`, den Better-Auth-Endpoints unter `/auth/*` und statischen Assets ist nichts öffentlich erreichbar – auch die Tastings nicht und auch `/api/*` nicht, das keine Sonderbehandlung hat.
  - Implementierung als globaler Auth-Guard in `hooks.server.ts`: Session prüfen, sonst `throw redirect(302, '/login')`. Die Entscheidung (`evaluateGuard` in `guard.ts`) hängt nur am Pfad und an der Session – die früheren anonymen Tasting-Token-Links samt Route-ID-Ausnahme sind seit #16 ausgebaut.
  - Kein Rücksprung auf den ursprünglichen Pfad: Wer ohne Login einen Tasting-Link öffnet, landet nach dem Magic-Link-Login auf `/` (bewusst hingenommen). Dort führen ihn die Tasting-Karten in sein Tasting.
  - Die Login-Seite ist die de-facto-Startseite für nicht eingeloggte User; nach erfolgreichem Login geht es auf `/` (Startseite).
  - **Ausnahme `/health`**: rein technischer Liveness-Check (Docker-Healthcheck, siehe Compose-Konventionen) – öffentlich wie `/login`/`/auth/*`, kein Redirect. Response bleibt bewusst leer/status-only (kein Stacktrace, keine Versions-/Config-Details), da der Pfad ungeschützt erreichbar ist.
- **Fehlende Seiten (404/403) → Dashboard** (#21): Eingeloggte User sehen für eine Seite keine 404 oder 403 mehr, sondern landen per `redirectNotFound()` (`authGuards.ts`) mit `303 → /?notice=not-found` auf `/`.
  - Gilt für unbekannte Pfade (Catch-all `src/routes/[...rest]/+page.server.ts`, fängt auch alte Token-Links ab, die am Param-Matcher scheitern), unbekannten Slug, Nicht-Teilnahme, Admin ohne Teilnahme, unbekannte ID auf `/admin/tastings/[id]` und fehlende Admin-Rechte (`requireAdmin`). **Eine Antwort für alle Ursachen ist Sicherheitsverhalten** – kein eigener Hinweis-Parameter pro Fall. `fail(404, { userMessage })` in Admin-Actions bleibt Toast-Logik, `requireUser` (401) bleibt (für Seiten unerreichbar).
  - Bewusst eine Route statt eines Hooks nach `resolve()`: Nur sie greift auch bei Client-Navigation (`__data.json` liefert bei `error()` HTTP 200 mit Fehler-Knoten). Der Catch-all läuft nach dem Guard (anonym → `/login` wie bisher) und ohne `requireUser`, damit das vom Guard freigegebene nackte `/auth` anonym weiter auf `/login` endet. Fehlende `/_app/*`-Assets beantwortet SvelteKit vor dem Routing mit 404.
  - Der Hinweis ist eine Whitelist in `$lib/notices.ts` (client-tauglich, Text nie aus der URL). Der Dashboard-Load prüft ihn mit `parseNotice()` (Muster `KNOWN_ERRORS`), `+page.svelte` zeigt ihn als Info-Toast und entfernt ihn per **`goto('/', { replaceState: true, … })` statt `replaceState()`**: Das läuft beim Hydrieren, bevor der Router gestartet ist (`replaceState` wirft dann in Dev), und Shallow Routing behält `?notice` als Seiten-URL – der Zurück-Button zeigte den Toast erneut.
  - Alle übrigen Seitenfehler (v. a. 500) zeigen `src/routes/+error.svelte` im App-Layout: fester Text `UNEXPECTED_ERROR_MESSAGE` (dafür von `$lib/server` nach `$lib/errorMessages.ts` umgezogen), Statuscode, Link „Zur Startseite“ – nie `page.error.message`.
- Im Header (nur sichtbar für eingeloggte User) steht der Username als Drop-Down-Trigger: "Logout" und – falls Admin – zusätzlich "Admin".
- Der Login erfolgt via Angabe der Mailadresse an die dann ein Magic Link geschickt wird.
- Eine Registrierung im herkömmlichen Sinne gibt es nicht – Initial ist nur der `.env`-Admin freigeschaltet, weitere User legt der Admin manuell an.
- Es gibt genau einen Admin User, dieser wird über das .env File mit Username und Mailadresse angegeben
  - Dieser Admin User ist in der DB als für den Login freigebener User aufgeführt (Whitelist) und kann sich im Login Formular anmelden
  - der Admin Boot Strap soll bei jedem Containerstart durchgeführt werden, damit der User sich nicht versehentlich aussperren kann
  - Idempotenz beim Boostrap: Upsert auf E-Mail, der Admin-Flag wird immer auf true gezwungen und eine Deaktivierung aufgehoben (`deactivated_at = NULL`), alle anderen Felder bleiben unangetastet. Ohne das Aufheben könnte ein zweiter Admin den Env-Admin dauerhaft aussperren: Mit Tasting-Teilnahme „löscht“ er ihn nur per Deaktivierung, und der Bootstrap fände die Zeile noch vor.
- das Whitelisting von Usern die sich anmelden dürfen erfolgt über Custom-Fields direkt am Better-Auth-user-Table, keine separate Whitelist-Tabelle.
- Es gibt eine Admin-Seite, auf der der Admin weitere Mail-Adressen (mit Username) angeben kann, auch diese können sich dann in Zukunft einloggen
  - Darunter der Abschnitt „Hintergrund-Jobs“: alle Startup-Jobs (siehe DB-Migrationen) mit Status (ausstehend, läuft mit Fortschritt, erfolgreich, fehlgeschlagen mit Meldung) und Button „Neu starten“ (Action `restartJob`, wartet nicht auf den Job). Solange einer läuft, lädt die Seite die Liste alle 2 s per `invalidate('app:startup-jobs')` neu – das läuft den ganzen `load` erneut, die Benutzerliste ist dafür billig genug.
  - diese Admin-Seite kann nur von eingeloggten Usern aufgerufen werden, für die ein Admin Flag in der DB existiert – alle anderen leitet `requireAdmin` (Loads und Actions) wie eine fehlende Seite aufs Dashboard um, keine 403
  - die Admin Seite erlaubt Full CRUD, also anlegen, löschen und ändern
  - Pflichtfelder beim Anlegen: **E-Mail und Username**.
  - Ein Admin kann seinen eigenen Eintrag nicht löschen und sich nicht den Admin-Flag entziehen, andere Felder schon.
  - Beim Löschen eines Users werden alle seine aktiven Sessions sofort mitgelöscht (forced logout) – das Session-Cookie wird beim nächsten Request ungültig.
  - **Deaktivieren statt Löschen bei Tasting-Teilnahme**: `tasting_participant.user_id` hat `ON DELETE restrict`, die Flaschen gehören zu Reihenfolge und Auflösung. „Löschen“ setzt dann `user.deactivated_at` (ein zweiter Klick behält den ersten Zeitstempel) und löscht die Sessions; der Löschdialog kündigt das an. User ohne Teilnahme werden wie bisher endgültig gelöscht.
    - Ein deaktivierter User kommt an keine Session mehr: Der Whitelist-SELECT in `magicLinkCallback.ts` behandelt ihn exakt wie eine unbekannte Adresse, und `databaseHooks.session.create.before` (`sessionGuard.ts`, verdrahtet in `auth.ts`) lehnt auch einen vor der Deaktivierung verschickten, noch gültigen Magic Link ab. Better Auth leitet dann mit `error=failed_to_create_session` auf `/login`, der Code steht deshalb in `KNOWN_ERRORS` (generischer Text wie alle anderen).
    - E-Mail und Username bleiben belegt (`taken` beim Anlegen), eine Reaktivierung gibt es nicht. Angezeigt wird `<username> (inaktiv)` (`participantLabel()` in `tasting.ts`), in der Teilnehmerauswahl fehlt der User, auf `/admin` entfällt sein Löschen-Button.
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
  - **Keinen CHECK nachträglich zu einer bestehenden Tabelle hinzufügen**: Drizzle Kit baut die Tabelle dafür neu (`__new_…` + `INSERT … SELECT`), und das generierte `INSERT … SELECT` liest neu hinzukommende Spalten aus der alten Tabelle – die Migration bricht ab (so geschehen bei `presentation_name`, dort deshalb kein CHECK; ebenso ohne CHECK: `tasting.motto`). Neue Spalten ohne CHECK ergeben ein schlichtes `ALTER TABLE … ADD`. Braucht ein neuer CHECK eine neue Spalte, kommt sie vorher in eine eigene additive Migration (siehe Daten-Migrationen). Committete Migrationen werden nie umgeschrieben, Änderungen kommen als neue Migration.
  - **Eine Spalte, auf die ein CHECK verweist, entfernen** erzwingt ebenfalls einen Neuaufbau: SQLite lehnt `DROP COLUMN` dann ab, Drizzle Kit baut die Tabelle ohne Spalte und CHECK neu (erstmals `0008`, `tasting.bottles_per_participant`). Die `INSERT … SELECT`-Falle greift dabei nicht, weil nur eine Spalte wegfällt; den Cascade beim `DROP TABLE` fängt `runMigrations()` ab (nächster Punkt).
  - **Fremdschlüssel während der Migration aus** (`runMigrations()` in `src/lib/server/db/migrate.ts`, vorher `foreign_keys = OFF`, danach `PRAGMA foreign_key_check` und wieder an): Drizzle führt alle offenen Migrationen in einem einzigen `BEGIN … COMMIT` aus, darin ist das von Drizzle Kit generierte `PRAGMA foreign_keys=OFF` wirkungslos – das `DROP TABLE` eines Tabellen-Neuaufbaus würde sonst per Cascade alle abhängigen Zeilen löschen (z. B. alle Flaschen beim Neuaufbau von `tasting_participant`). Test-DBs ebenfalls über `runMigrations()` aufbauen; Verstöße im Check brechen den Start ab.
  - **Daten-Migrationen** als Custom-Migration (`npm run db:generate -- --custom --name …`, reines SQL, muss auch auf einer leeren DB laufen; erstmals `0005_tasting_users_data`). Braucht ein Neuaufbau neue Daten (z. B. `NOT NULL` für eine neue Spalte), dreiteilig: additives `ALTER TABLE … ADD` → Daten-Migration → Neuaufbau, so findet das generierte `INSERT … SELECT` die Spalte schon gefüllt in der alten Tabelle. Füllt ein `DEFAULT` die neue Spalte, reicht zweiteilig: additiv → Neuaufbau (erstmals `0009`/`0010`, `tasting_bottle.archived` und der CHECK darauf). `migrate.test.ts` prüft solche Migrationen auf einer DB im alten Stand (Journal-Kopie bis zur Vorgänger-Migration).
  - Migration-Files werden committed (reviewbar im PR)
  - Boot-Reihenfolge im Container: `runMigrations()` → Admin-Bootstrap → SvelteKit-Server → Startup-Jobs im Hintergrund (`init`-Hook in `hooks.server.ts`, siehe unten)
  - **Startup-Jobs** (`startupJobs.ts`, Liste in `startupJobList.ts`): einmalige Arbeit nach einem Deployment, die keine Drizzle-Migration leisten kann – lang laufend, mit Dateien oder anderen Diensten (erster Job: die PDFs aller vorhandenen Präsentationen, siehe „Präsentationen ansehen“). Faustregel: schnelle, reine Datenänderung → Custom-Migration; alles mit Dateien, Netzwerk oder Minuten Laufzeit → Startup-Job.
    - Ein neuer Job wird an `STARTUP_JOBS` angehängt, mit fester, nie mehr geänderter ID (Datum vorn, z. B. `2026-10-presentation-pdfs`). Er muss idempotent sein und bekommt `trigger` (`startup`/`manual`) und `progress()`.
    - Nach dem Start laufen alle nicht erfolgreichen Jobs **nacheinander** im Hintergrund, die App bedient währenddessen schon Anfragen. Fehlgeschlagene laufen beim nächsten Start erneut; eine Zeile, die noch auf `running` steht, gehört zu einem beendeten Prozess und wird vorher als unterbrochen markiert.
    - Zustand in der Tabelle `startup_job` (keine Zeile = ausstehend). Angezeigt wird nur `message`: die Zusammenfassung des Jobs oder die `userMessage` eines `StartupJobError`, bei allem anderen ein generischer Text – nie interne Fehlertexte.
    - In-Process-Sperre (`isStartupJobRunning`): Derselbe Job läuft nie zweimal gleichzeitig, verschiedene Jobs schon (Neustart per Admin-Seite während der Start-Warteschlange). Reicht nur für eine App-Instanz.
    - `init` läuft auch in `vite dev` und `vite preview` (E2E): Ein Job darf ohne seine Dienste nicht hängen bleiben, sondern schlägt fehl (der PDF-Job ohne Office-Dateien braucht Gotenberg gar nicht).
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

Blindtastings: Der Admin legt unter `/admin/tastings` ein Tasting mit Datum an und wählt die Teilnehmer aus den aktiven Usern, jeder Teilnehmer trägt seine Flaschen eingeloggt über den festen Link des Tastings (`/tasting/[slug=tastingSlug]`) ein, die App berechnet die Tastingreihenfolge.

- **Phasen aus dem Datum** (kein Status-Feld), berechnet vom Server in `Europe/Berlin` (`tastingPhase.ts`, `Intl.DateTimeFormat` – der Container läuft in UTC):
  - `entry` bis 18:00 am Tasting-Tag, `order` ab 18:00, `revealed` ab 9:00 am Folgetag. Zeitzone und Uhrzeiten sind Konstanten in `src/lib/tasting.ts`, nicht pro Tasting einstellbar.
  - `tasting_date` ist deshalb ein Kalenderdatum (`text`, `YYYY-MM-DD`) statt eines Zeitstempels – bewusste Abweichung vom Timestamp-Standard.
  - **Admin-Buttons überstimmen die Uhr** (nachträglich gewünscht, entgegen dem ursprünglichen Nicht-Ziel „keine manuelle Status-Steuerung“ aus Issue #5): „Reihenfolge jetzt freigeben“ (18-Uhr-Button, nur in `entry`) setzt `tasting.order_opened_at`, „Jetzt auflösen“ (9-Uhr-Button, nur in `order` – die Reihenfolge lässt sich nicht überspringen, auch serverseitig in `revealEarly()` geprüft) setzt `tasting.revealed_at`. Die Admin-Seite zeigt beide Buttons in jeder Phase, aktiv ist nur der für den nächsten Schritt. Die Zeitstempel ziehen die Phase nur vor, nie zurück, und lassen sich nicht zurücknehmen (Bestätigungsdialog). Jeder Teilnehmer und die Admin-Seite sehen per `TastingManualNotice.svelte`, wann der Admin gedrückt hat (Berliner Zeit). Jede Phasenberechnung muss deshalb die beiden Spalten mitlesen (`getTastingPhase(date, now, manual)`) – auch die Speichern-Transaktion, damit ein Button-Druck die Eingabe sofort sperrt.
- **Blind für alle, auch für den Admin** (er verkostet mit): Die Admin-Seite `/admin/tastings/[id]` zeigt in **keiner** Phase Whisky-Inhalte – weder Flaschen noch Reihenfolge, Auflösung, Graph oder Präsentationen –, nur Verwaltung (Teilnehmer mit Fortschritt, Datum, Motto, 18-/9-Uhr-Buttons, Löschen) – auch keinen Link. Reihenfolge und Auflösung sieht der Admin wie alle anderen als Teilnehmer des Tastings; nimmt er nicht teil, landet er wie jeder Nicht-Teilnehmer per Umleitung auf dem Dashboard (siehe „Fehlende Seiten“). Bewusst keine gemeinsame Route mit Admin-Buttons: Die Teilnehmerseite hängt an einer Teilnahme, die Admin-Seite am Tasting. Die frühere Score-Aufschlüsselung für den Admin ist deshalb entfallen.
  - Welche Felder ein `load` liefert, entscheidet ausschließlich die Projektion in `src/lib/server/tastings.ts` (Felder explizit gepickt, nie gespreadet) – phasenabhängig für die Teilnehmerseite, reine Verwaltungsdaten für Admin-Seiten und Startseite. Die Startseite bekommt zusätzlich den Slug, aber nur für Tastings mit eigener Teilnahme: `getDashboardTasting` filtert auf `user_id` und leitet den Slug nie aus `listTastings` ab, auch nicht beim Admin. Dasselbe gilt für `getHistory` (siehe Historie), `getStatistics` liefert gar keinen Slug. Ausblenden im Template reicht nicht, `data` landet komplett im HTML bzw. `__data.json`. Der Whiskybase-Link zählt als Inhalt.
  - In `entry` werden fremde Flaschen gar nicht erst abgefragt (nur, ob eine davon archiviert ist, siehe Archiv-Flaschen); `order` liefert nur `{ position, alias, score, presentation }` (Gesamtscore für den Chart, siehe Score-Entwicklungs-Chart; `presentation` nur `{ bottleId, viewable }` für Download und Viewer, ohne Dateinamen) – keine Faktoren, keine Aufschlüsselung.
- **Motto** (seit #19, optional, höchstens `TASTING_MOTTO_LENGTH` Zeichen, leer = `null`): ein Verwaltungsdatum wie Name und Datum, das der Admin selbst blind setzt – beim Anlegen oder auf der Detailseite (Action `updateMotto`). Anders als das Datum ist es in jeder Phase änderbar, weil nichts daran hängt. Angezeigt wird es derzeit nur auf den beiden Tasting-Karten der Startseite, nicht auf der Teilnehmerseite, in der Tasting-Liste oder in der Karte „Tasting-Verwaltung“. Die Spalte hat bewusst keinen CHECK (siehe DB-Migrationen), deshalb prüfen beide Actions die Länge über `validateTastingMotto()`.
- **Tasting-Link** (seit #16, vorher anonyme Token-Links pro Teilnehmer): genau ein fester Link pro Tasting, `/tasting/<adjektiv>-<tier>` (`tasting.slug`, unique, `NOT NULL`), alle Teilnehmer nutzen denselben. Der Slug ist **kein Geheimnis**, der Schutz kommt allein aus Login und Teilnahmeprüfung.
  - Je 100 englische „süße“ Adjektive und Tiere (nur `a–z`, damit der Bindestrich eindeutig trennt) liegen in `tasting_slug_adjective`/`tasting_slug_animal`, geseedet per Migration `0005`. `createTasting` wählt in seiner Transaktion zufällig (`randomInt`, in Tests injizierbar) eine von keinem anderen Tasting genutzte Kombination; sind alle 10.000 belegt, folgt ein `TastingValidationError`. Der Link ändert sich danach nie. `TASTING_SLUG_RE` (Param-Matcher `src/params/tastingSlug.ts`) prüft nur das Format.
  - Den Link zeigen nur die beiden Tasting-Karten der Startseite und, für aufgelöste Tastings, die Tabelle der Historie – jeweils nur den Teilnehmern des Tastings (siehe Startseite und Historie). Die Admin-Seiten zeigen ihn nie, das prüft `expectNoLinkOnAdminPage` in `tasting.e2e.ts`.
  - **Teilnehmer sind User** (`tasting_participant.user_id`, `ON DELETE restrict`, unique `(tasting_id, user_id)`): Der Admin wählt beim Anlegen 2–12 (`TASTING_PARTICIPANTS`) aktive User per Checkbox, freie Namen gibt es nicht. `findParticipant(slug, userId)` ist eine einzige Query über Slug und Teilnahme: unbekannter Slug, Nicht-Teilnehmer und Admin ohne Teilnahme enden in derselben Umleitung (`requireParticipant` → `redirectNotFound()`, Load sowie `save`- und `remove`-Action). Angezeigt wird überall der Username (Begrüßung, „mitgebracht von“, Teilnehmerliste), bei deaktivierten Usern `<username> (inaktiv)` (siehe Authentifizierung).
  - `participantId` kommt nur aus Slug plus `locals.user`, aus `FormData` nur freigegebene Felder. `GET` hat keine Nebenwirkungen (Messenger-Link-Previews).
  - **Migration der Token-Bestände** (`0005_tasting_users_data`, nicht umkehrbar): Teilnehmernamen wurden einem User mit gleichem Username (ohne Beachtung der Groß-/Kleinschreibung) zugeordnet, sonst einem neuen User mit dem Namen als Username und der Platzhalter-Adresse `dummy-<n>@dummy.invalid` (reservierte TLD, nie zustellbar – ein Magic Link kann nicht bei Fremden landen; die echte Adresse trägt der Admin auf `/admin` ein). Bewusst ohne Ableitung oder Suffixe: produktiv gab es nur ein Tasting ohne doppelte Namen; eine Kollision rollt die Migration komplett zurück.
- **Flaschen pro Teilnehmer** (seit #28, vorher gab der Admin pro Tasting `bottles_per_participant` vor): Jeder Teilnehmer hat immer Slot 1 und 2 und fügt auf der Teilnehmerseite selbst weitere hinzu („Weitere Flasche“, kleinster freier Slot), höchstens 6. `TASTING_BOTTLE_SLOTS` in `validation.ts` ist zugleich die Grenze des CHECK `tasting_bottle_slot_range` – ein anderes `max` baut `tasting_bottle` neu auf.
  - **Soll im Fortschritt** pro Teilnehmer max(2, eigene eingetragene Flaschen), für ein Tasting die Summe darüber (`participantProgress()` in `tastings.ts`): Eine dritte Flasche erhöht nur das eigene Soll, ein vollständiges Tasting mit 2/2/3 Flaschen zeigt 7/7 statt 7/9. Gezählt wird die Zahl der Flaschen, nicht welche Slots belegt sind.
  - **Entfernen** nur für Slot 3–6 (Action `remove`, `removeBottle()`): Ein ungespeicherter Slot verschwindet ohne Request, eine gespeicherte Flasche nach Bestätigungsdialog samt Präsentationsdatei, Synonym und Dateiname sind danach wieder frei. Die Flasche wird nur über Teilnehmer (Slug + Login) und Slot bestimmt, nie über eine ID aus dem Formular; Phase und Slot prüft dieselbe Transaktion wie das Löschen. Slot 1/2 oder geschlossene Eingabe → `TastingValidationError` → 422 mit `reload: true`. Ein schon leerer Slot gilt als entfernt (kein Fehler, z. B. aus einem zweiten Tab).
  - Bewusst **keine Neunummerierung**: Wer Flasche 3 entfernt und 4 behält, sieht weiter „Flasche 4“ (die Ausschankreihenfolge hängt am Score, nicht am Slot), „Weitere Flasche“ füllt danach wieder Slot 3.
- **Archiv-Flaschen** (seit #26, für den Import der Tasting-Historie in #27): `tasting_bottle.archived` markiert Flaschen, von denen nur der Alkoholgehalt bekannt ist. `smoke`, `cask` und `value` sind dort `NULL`, bei allen anderen Flaschen gesetzt (CHECK `tasting_bottle_archived_factors`). Das Flag setzt nur der Import (kein Formularfeld, keine Admin-Action), und die UI nennt es nirgends, auch nicht in Fehlermeldungen. Ein eigenes Flag am Tasting gibt es bewusst nicht: Ab einer Archiv-Flasche ist es ein Archiv-Tasting.
  - **Projektion**: Die Trennung sitzt zentral in `pouredBottles()`. In `revealed` liefert ein Archiv-Tasting `{ archived: true, bottles: ArchivedRevealedBottle[] }` ohne Faktoren, Score und Position, sortiert nach Username (`localeCompare` mit `de-DE`, SQLite vergleicht nur Bytes) und dann nach Slot. Auch hier explizit gepickt, ein Spread brächte die `NULL`-Faktoren in den Payload. Ein gemischtes Tasting zeigt alle Flaschen ohne Faktoren. Key im `#each` ist die Flaschen-ID: Eindeutige Synonyme prüfen nur `saveBottle()` und der Import, die DB erzwingt sie nicht. Die Seite zeigt dann nur `TastingReveal` (Zeile „Alkohol“ statt „Werte“, kein Positionskreis), weder Score-Chart noch Erklärkachel.
  - **Fail closed vor der Auflösung**: In `entry` und `order` wirft `getParticipantView` (Tasting-ID im Fehler), der Load loggt per pino und antwortet mit `error(500)` → `+error.svelte`, ohne eigene View-Variante. Praktisch unerreichbar, der Import bringt nur aufgelöste Tastings. `entry` prüft dafür über alle Teilnehmer nur, ob es eine Archiv-Flasche gibt (`hasArchivedBottles()`), Inhalte fremder Flaschen bleiben unabgefragt.
  - **Schreibsperre**: `saveBottle` und `removeBottle` lehnen ein Archiv-Tasting direkt nach dem Phasen-Check in derselben Transaktion ab (`TastingValidationError` → 422, Text wie bei geschlossener Eingabe). Eine Archiv-Flasche samt Datei verschwindet so nie über die Teilnehmerseite, nur mit dem ganzen Tasting.
  - **Per Typ getrennt**: `TastingBottle`, `ScoreInput` und `RevealedBottle` behalten Pflicht-Faktoren, DB-Zeilen verengt der Type Guard `isActiveBottle()` auf `ActiveBottleRow`, bevor `toDomain()` sie nimmt. So erreicht eine Archiv-Flasche weder `scoreBottle()`/`sortForPouring()` noch Charts oder Formular – mit `NULL` rechnete JS still mit 0.
  - Der Fortschritt zählt Flaschenzeilen, Archiv-Flaschen gelten dort als befüllt.
  - **Abfüllung** bis 120 Zeichen (`TASTING_BOTTLING_LENGTH`, mit #26 für den Import von 80 angehoben) in Formular, Server-Validierung und CHECK.
  - **Import** (`scripts/import-history.ts`, `npm run db:import-history -- <history.json> [--apply]`, #27): einmalig für die Tastings vor Glen Idunno, gegen eine Kopie der Prod-DB und einen leeren Medienordner (Ablauf im Issue). Bleibt danach im Repo wie `seed-test-tasting.ts`. Ohne `--apply` ein Dry-Run, der alle Fehler gesammelt meldet; mit `--apply` eine Transaktion für alle Tastings.
    - **Nur gegen den passenden Migrationsstand**: Das Skript migriert nie und bricht ab, wenn `__drizzle_migrations` nicht zu `drizzle/meta/_journal.json` passt (Zeilenzahl und `MAX(created_at)` gleich dem `when` des letzten Eintrags; `id` ist in SQLite immer `NULL`). Nach der nächsten Migration läuft es erst wieder, wenn sein rohes SQL angepasst ist.
    - Es lädt `validation.ts` und `presentationFiles.ts` direkt per Node-Type-Stripping (mit `.ts`-Endung). Beide müssen dafür ohne Imports und ohne nicht strippbare TS-Syntax (Enums, Parameter-Properties) bleiben.
- **Rate-Limit**: nur ein Schreib-Limit pro Teilnehmer, gemeinsam für die Actions `save` und `remove` (`tastingWriteThrottle.ts`, 30 / 10 min, Muster `consumeEmailRateLimit`, → `fail(429)`). Bewusst **kein** Limit pro IP: Die Seite setzt Login plus Teilnahme voraus, und ohne gesetztes `ADDRESS_HEADER` sieht `getClientAddress()` hinter Traefik nur die Proxy-IP.
- **Speichern** prüft Phase `entry`, Slot (1–6, in jedem Tasting) und Synonym-Eindeutigkeit in derselben Transaktion wie den Upsert (kein TOCTOU um 18:00). Der Synonym-Vergleich läuft in JS (`toLocaleLowerCase('de-DE')`), weil SQLites `lower()` nur ASCII faltet. Ist die Eingabe geschlossen, antwortet die Action mit `reload: true`, und die Seite lädt per `invalidateAll()` die Reihenfolge nach.
- **Security-Header** (`securityHeaders.ts`, gesetzt in `hooks.server.ts` nach `resolve()`, damit auch `__data.json`, Actions und die Umleitung für Nicht-Teilnehmer abgedeckt sind): Teilnehmerseite, Präsentations-Download, Viewer und dessen PDF (Route-IDs in `tastingRoutes.ts`) bekommen nur `Cache-Control: no-store` – die Daten sind persönlich und wechseln mit der Phase. `Referrer-Policy: no-referrer`, `X-Robots-Tag` und das `no-store` auf `/admin/tastings/*` sind mit #16 entfallen, sie waren mit dem Token in der URL bzw. der einmaligen Link-Anzeige begründet.
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
    - Der Originalname steht in `tasting_bottle.presentation_name` und dient als Anzeige- und (ab der Auflösung) Download-Name.
  - **Download ab der Reihenfolge** (nachträglich gewünscht, vorher erst ab der Auflösung): Die Folien werden beim Tasting präsentiert. Ab Phase `order` verlinkt die Teilnehmerseite die Datei (`/tasting/[slug]/presentation/[bottleId]`, Teilnehmer wie auf der Seite aus Slug plus Login), in `entry` kann sie niemand herunterladen, auch nicht der Besitzer. Einen Admin-Download gibt es nicht; alles andere ist eine einheitliche 404 – bewusst keine Umleitung wie bei den Seiten: Der Link ist ein `<a download>`, ein Redirect speicherte das Dashboard-HTML als Datei. Endpoint-Fehler zeigen SvelteKits Standard-Fehlerseite (`src/error.html` gibt es nicht), nicht `+error.svelte`. Was auf den Folien steht, verantwortet der Vortragende.
  - Der **Dateiname** zählt weiter als Inhalt (er verrät oft den Whisky): vor der Auflösung sieht nur der Besitzer den Namen seiner eigenen Datei (im Formular). In `order` heißt der Link in der Reihenfolge-Liste neutral „Präsentation“, und der Download kommt unter dem Plattennamen (`Tasting_<Datum>_<Synonym>…`, `getPresentationForParticipant`); erst nach der Auflösung unter dem Originalnamen.
  - Download immer als `Content-Disposition: attachment` mit `application/octet-stream`, `nosniff` und CSP-Sandbox: eine hochgeladene HTML-/SVG-Datei darf nie auf dem App-Origin rendern.
  - **Ablauf beim Speichern**: Der Upload landet zuerst in einer temporären Datei `.upload-<uuid>` (`stageUpload`), damit ein volles Laufwerk auffällt, bevor etwas gespeichert ist. Name, Phase, Slot und Synonym werden in der DB-Transaktion entschieden (`saveBottle` → `fileChanges`), erst danach verschiebt/löscht `applyFileChanges` die Dateien. Grund: Ein Re-Upload mit gleichem Synonym hat denselben Namen und würde die bisherige Datei sonst überschreiben, obwohl das Speichern noch abgelehnt werden kann (Synonym vergeben, Eingabe geschlossen). Bei Ablehnung wird nur die Temp-Datei gelöscht. Beim Löschen eines Tastings löscht die Route alle seine Dateien (`listPresentationFiles()` vor `deleteTasting()`, der Cascade entfernt nur Zeilen). Entfernt ein Teilnehmer eine einzelne Flasche, gibt `removeBottle()` deren Datei als `FileChange` zurück, und die Route löscht sie erst nach dem Commit. Das Schreib-Limit greift vor dem Parsen des Bodys.
  - **Request-Größe**: adapter-node lehnt Bodies über 512 KB ab, deshalb setzt der `Dockerfile` `BODY_SIZE_LIMIT=31M`. Das gilt für alle Routen – der `bodyLimitHandle` (erster Hook, `bodyLimit.ts`) hält per `Content-Length` alles außer dem POST auf die Teilnehmer-Route (`TASTING_ROUTE_ID` aus `tastingRoutes.ts`) bei 512 KB, sonst nähmen z. B. die anonymen `/auth/*`-Endpoints 31 MB an. `vite dev`/`vite preview` haben gar kein Limit, Größenfehler zeigen sich also erst im Container.
- **Präsentationen ansehen** (#35): Ab `order` blättert jeder Teilnehmer die Präsentationen seiner Tastings Folie für Folie in der App durch, der Download bleibt.
  - **Einstieg**: Link „Ansehen“ (`Eye`) neben jedem Download – Reihenfolge, Auflösung und Historie (nur bei eigener Teilnahme, mit `?from=history` für den Zurück-Link per Whitelist; die Filter der Historie gehen dabei verloren) –, aber nur bei `viewable`: PDF und die LibreOffice-Whitelist `VIEWABLE_PRESENTATION_EXTENSIONS` (`tasting.ts`, Endung des Plattennamens, gesetzt in `presentationRef`, `toOrder` und `getHistory`). Alles andere, auch Dateien ohne Endung, bleibt reiner Download.
  - **Routen**: Viewer-Seite `…/presentation/[bottleId]/view` (`requireParticipant` aus `tastingGuards.ts` + `getPresentationForParticipant`, sonst `redirectNotFound()`) und PDF-Endpoint `…/pdf` (einheitliche 404 wie der Download, Umwandlungsfehler → 503). Eigene Unterpfade, weil neben dem `+server.ts` des Downloads der Accept-Header zwischen Seite und Datei entschiede.
  - **Der `load` des Viewers wandelt nie um** – `data-sveltekit-preload-data="hover"` ruft ihn schon beim Hover auf den Link. `PresentationViewer.svelte` holt das PDF erst nach dem Mount per `fetch`. Kein Dateiname in `data`, Titel neutral „Whisky-Tasting“, das PDF kommt als `attachment` unter dem Plattennamen mit `.pdf` (`application/pdf`, `nosniff`, CSP-Sandbox wie der Download).
  - **Umwandlung** (`presentationPdf.ts`): `POST {GOTENBERG_URL}/forms/libreoffice/convert`, die Datei unter ihrem Plattennamen (die Endung bestimmt das Format), nie eine URL. Im Hintergrund nach jedem erfolgreichen `move` einer Office-Datei (fire-and-forget, Fehler nur im Log), sonst beim ersten Abruf (Gotenberg war down, Archiv-Präsentationen aus #27). Dazu der Startup-Job `2026-10-presentation-pdfs` (`presentationPdfJob.ts`): nach einem Deployment alle fehlenden PDFs, per „Neu starten“ auf der Admin-Seite alle neu. Er wartet bis zu 2 min auf Gotenbergs `/health` und wandelt nacheinander um; einzelne Fehler lassen ihn weiterlaufen und am Ende als fehlgeschlagen enden (mit Anzahl). Timeout 150 s, knapp über Gotenbergs `--api-timeout`; Antwort höchstens 100 MB und nur `application/pdf`. Original-PDFs gehen nie durch Gotenberg und nie in den Cache.
  - **Cache** `MEDIA_PATH/pdf-cache/<Plattenname>.pdf`, Name gegen `PDF_CACHE_FILE_RE` geprüft. Eigener Ordner, weil `Tasting_<Datum>_<Synonym>.pdf` das Original-PDF einer anderen Flasche sein kann. Atomar über `.convert-<uuid>` + `rename`. Kein eigenes Volume: Er landet im Backup von `glenidunno-media` (bewusst hingenommen, regenerierbar).
  - **Invalidierung zentral in `applyFileChanges`** (save, remove, `updateDate`, delete – die Routen brauchen nichts Eigenes): nach jedem Schritt, auch einem fehlgeschlagenen, `discardPdf` für alle beteiligten Namen. `discardPdf` legt nie den Ordner an, sonst brächen die exakten `readdir`-Listen der Tests.
  - **Stale-Schutz** (erster In-Process-Lock im Projekt, reicht nur für eine App-Instanz): ein Generationszähler pro Dateiname (Schlüssel `fileNameKey`), den `discardPdf` **nach** dem Dateischritt erhöht. Eine Umwandlung behält ihr Ergebnis nur bei unveränderter Generation und prüft nach dem `rename` erneut – sonst landete nach `deleteTasting` das alte PDF unter einem neu vergebenen Namen. Single-Flight pro Datei und Generation, gemeinsam für Hintergrund und Fallback; eine neue Generation startet eine neue Umwandlung, statt der veralteten beizutreten.
  - **pdf.js** (`pdfjs-dist` ≥ 6.4.299, devDependency – es landet nur im Client-Bundle, die Runtime-Stage installiert `--omit=dev`): dynamischer Import im `onMount` (im SSR bräuchte pdf.js `@napi-rs/canvas`), Worker per `?url` als gehashtes Asset. `isEvalSupported: false` aus dem Issue gibt es seit pdf.js 5.7 nicht mehr (mozilla/pdf.js#21005 entfernte den letzten `eval`-Nutzer), `pdf.mjs`/`pdf.worker.mjs` enthalten weder `eval` noch `new Function` – die Mindestversion ersetzt die Option (CVE-2024-4367). Keine CSP, kein Service Worker, der Worker vom eigenen Origin läuft also. PDF-Metadaten werden bewusst nicht bereinigt, der Download in `order` liefert sie ohnehin.
  - **Viewer**: eine Canvas, offscreen gerendert und kopiert, in `devicePixelRatio` mit Pixelbudget 4096² (größere Canvas bleiben in iOS Safari leer); Breite per `bind:clientWidth` an einem leeren Element wie in `StatisticsHistogram.svelte`. Zoom 100–300 % per Buttons, gezoomt scrollt der Rahmen in beide Richtungen (`touch-action: auto`), bei 100 % blättert Wischen (`pan-y pinch-zoom` – natives Pinch-Zoom bleibt, eigene Pinch-Logik gibt es nicht). Pfeiltasten nur ohne Modifikator.
  - **Vollbild** (nachträglich gewünscht): Der Button nutzt die Fullscreen API und sperrt auf Android zusätzlich das Querformat (`screen.orientation.lock`, nur dort und nur im Vollbild möglich). Ohne API oder bei Ablehnung – iPhone-Safari kennt Vollbild nur für Videos – deckt stattdessen eine feste Ebene die Seite ab (Seite dahinter ohne Scrollen). **Automatisch beim Drehen ins Querformat** geht nur diese Ebene: `requestFullscreen()` verlangt ein Tippen, eine Drehung zählt nicht. Ausgelöst per `matchMedia('(orientation: landscape) and (pointer: coarse)')`, also nur auf Touch-Geräten (ein Desktop-Fenster ist auch quer). Im Querformat geschlossen bleibt es zu bis zur nächsten Drehung. Als installierte PWA (`display: standalone`) sieht die Ebene aus wie echtes Vollbild, im Browser-Tab bleibt etwas Browser-Oberfläche. Im Vollbild passt die Folie in den Bildschirm, Zoom entfällt, eine kleine Leiste unten rechts blättert und schließt (auch Esc).
  - Die Bühne ist im Vollbild **inline** `position: fixed` und wird an einem leeren, absolut positionierten Element gemessen, nicht an sich selbst: Am Inhalt gemessen lief der ResizeObserver in eine Schleife, und ohne Tailwind (Komponenten-Tests) hinge die Größe sonst am Inhalt.

---

## Statistikseite

`/statistics` (#25) wertet für jeden eingeloggten User alle aufgelösten Tastings aus: Kennzahlen und Rekorde, Verteilungen, reiner Alkohol, Teilnehmer-Vergleich, Destillerien und Abfüller, Zeitverlauf und am Ende ein Link „Alle Flaschen in der Historie“. Die Flaschentabelle stand bis #36 hier und ist seitdem eine eigene Seite (siehe Historie).

- **Bewusste Erweiterung der Sichtbarkeit**: Die Auflösung eines Tastings sieht auf der Teilnehmerseite nur, wer teilgenommen hat; Statistik und Historie zeigen die Inhalte aller aufgelösten Tastings jedem eingeloggten User. Die Blindheit bleibt gewahrt, weil nur Phase `revealed` zählt – pro Tasting in JS berechnet (`getTastingPhase` samt Admin-Buttons), ein per „Jetzt auflösen“ vorgezogenes Tasting zählt sofort. Flaschen anderer Tastings fragt der gemeinsame Helfer `revealedBottles` gar nicht erst ab (`inArray` über die IDs der aufgelösten).
- **Gemeinsame Nummerierung**: `revealedBottles` in `tastings.ts` (aufgelöste Tastings, eigene Teilnahmen, Flaschenabfrage) nummeriert per `numberBottles()` (`src/lib/server/statistics.ts`) – die einzige Quelle für `n` in `#bottle-<n>`. `getStatistics` und `getHistory` bauen beide darauf auf, sonst zeigten die Links der Statistik auf falsche Zeilen der Historie.
- **Projektion** `getStatistics`, Felder explizit gepickt, schlank: nur `number`, `tastingDate`, `distillery`, `bottler`, `bottling`, `age`, `abv` und `broughtBy` (`StatisticsBottle`). Kein Slug, keine Präsentation, kein Synonym, kein Whiskybase-Link (den braucht nur Déjà-vu, er bleibt auf dem Server), keine Faktoren (Archiv-Flaschen haben keine, die Seite braucht keinen Sonderfall), kein Score. Die Aggregation steckt als reine Funktion `buildStatistics` in `src/lib/server/statistics.ts` (ohne DB testbar) und wird bei jedem `load` neu berechnet. Kein Eintrag in `securityHeaders.ts`, wie beim Dashboard ohne `no-store`.
- **Flaschen-Links** (Rekorde, Meilensteine, „Die stärkste eigene Flasche“) zeigen auf `/history#bottle-<n>`, ohne Query-String: Die Statistik hat keinen Tabellenzustand, und so blenden weder Suche noch Filter die Zeile aus. `resolve()` nimmt seit SvelteKit 2.70 Query und Hash an (`/history?…`, `/history#…`) – nur so akzeptiert `svelte/no-navigation-without-resolve` ein `goto`/`href` mit Query-String oder Hash.
- **„Blend“ und „Unbekannt“** (Platzhalter der Historie) stehen in der Tabelle der Historie, zählen aber nicht als Destillerie (Anzahl, Podium, Wiederholungstäter, einmalige Destillerien). Destillerien und Abfüller werden ohne Groß-/Kleinschreibung gruppiert. Das Podium vergibt dichte Ränge: Gleichstand teilt einen Platz, der nächste Platz geht an die nächstkleinere Anzahl. Déjà-vu vergleicht die Whiskybase-ID (`whiskybaseId()` in `validation.ts`, mit und ohne `www`).
- **Reiner Alkohol pro Person**: pro Tasting der Alkohol der ganzen Runde (jeder trinkt ein Sample `SAMPLE_SIZE_ML` von jeder Flasche, auch von den eigenen) geteilt durch dessen Teilnehmerzahl, über alle Tastings summiert. Die Teilnehmerzahl kürzt sich heraus, gerechnet wird deshalb direkt die Summe der Samples aller Flaschen. Der Wert gilt für jemanden, der immer dabei war, und stimmt auch, wenn einmal jemand fehlt. Bewusst nicht nach Personen aufgeschlüsselt, die Runde wechselt praktisch nie.
- **Hervorhebung und Titel** im Teilnehmer-Vergleich vergleichen auf Anzeigegenauigkeit (Durchschnitte auf eine Nachkommastelle, Anteile in ganzen Prozent), damit zwei gleich angezeigte Werte beide gewinnen. 0 oder kein Wert gewinnt nie – sonst wäre jeder ohne unabhängigen Abfüller „Indie-Scout“. Flaschenzahl und NAS-Anteil werden nicht hervorgehoben.
- **Fassstärken-Niveau** ab `CASK_STRENGTH_ABV` (derzeit 50 % vol., nachträglich gewünscht, Issue #25 sah 55 % vor). Berechnung, Zeilenbeschriftung und Tests lesen nur die Konstante, keine Stelle wiederholt die Zahl. Der Referenzwert „11 Flaschen ≥ 55 %“ aus #25 gilt deshalb nicht mehr, der Probelauf von #27 bestimmt die Anzahl neu.
- **Charts** nach dem `dataviz`-Skill, ohne Chart-Library, eine Reihe immer in `brand`-Bernstein:
  - `StatisticsLineChart.svelte` statt `TastingLineChart` (dessen X-Achse läuft nach Index, die Y-Ticks sind fest 0/50/100, und die Labels sind `{#each}`-Keys): X-Achse nach Zeit mit Jahresmarken, damit Pausen sichtbar werden; Y-Achse passend gerundet; Tastings ohne Wert (z. B. nur NAS-Flaschen) bekommen keinen Punkt. Die Breite folgt dem Container, es gibt also kein inneres Scrollen. Die Höhe steht dagegen fest im `height`-Attribut: Mit `h-auto` skalierte das vor dem Messen 320 px breit gerenderte SVG beim SSR auf dem Desktop auf gut die doppelte Höhe und schob nach dem Hydrieren alles darunter um ca. 430 px nach oben. Hover und Tippen nehmen den nächstgelegenen Punkt (auf der Zeitachse liegen Punkte oft nur Pixel auseinander), ein Tippen behält den Wert; die Tastatur nutzt fokussierbare Ziele pro Punkt mit `pointer-events="none"`.
  - `StatisticsHistogram.svelte` mit HTML/CSS-Balken, für Alkohol und Alter mit Regler „Intervall“ (#36), für „Tastings pro Jahr“ mit festen Spalten ohne Regler:
    - **Regler** 1–5 (`HISTOGRAM_STEP`), Startwerte 4 %-Punkte und 3 Jahre (`ABV_HISTOGRAM`, `AGE_HISTOGRAM` in `tasting.ts`) bei jedem Laden: reiner Komponentenzustand, weder Query-String noch `localStorage`. Die Klassen rechnet der Client per `$derived` aus `statistics.bottles[].abv/age` (`histogramIntervals()`), der Server liefert keine Verteilungen mehr.
    - **Anker**: 46 % vol. bzw. 3 Jahre sind bei jeder Breite eine Intervallgrenze. Intervalle sind halboffen und werden in ganzen Einheiten der Genauigkeit gerechnet (`scale`, Alkohol in Zehnteln), sonst landen 45,9 und 46,0 je nach Float-Rauschen im selben Intervall. Die Achse reicht vom Intervall des niedrigsten bis zu dem des höchsten Werts, nicht über den ganzen `TASTING_ABV`-Bereich. Leere Intervalle bleiben als Lücke ohne Balken und ohne „0“.
    - **Achse**: Alkohol an den Intervallgrenzen beschriftet, Alter und Jahre mittig unter dem Balken. Passen nicht alle Beschriftungen, steht nur jede k-te (`labelStep`, k so klein wie möglich), gezählt ab dem Anker, der immer beschriftet bleibt (`isLabeled`). Anzahlen über den Balken entfallen, wenn sie eine schon gezeigte überlappen würden, die höchsten Balken zuerst (`visibleCounts`, Überlappung seitlich und in der Höhe). Hover und Tippen zeigen jede Anzahl, der Screenreader-Text jedes Balkens nennt sie immer. Textbreiten sind geschätzt (rein, ohne DOM testbar); die Komponente übergibt nur die gemessene Breite.
    - **Breite** per `bind:clientWidth` an einem leeren Element statt an der Plotfläche: Deren Höhe hängt ohne CSS (Komponenten-Tests laden kein Tailwind) an den Beschriftungen, die die Breite erst bestimmt – der Neuaufbau im Resize-Callback löste dann „ResizeObserver loop completed with undelivered notifications“ aus. Vor der ersten Messung (SSR) gilt eine Smartphone-Breite, das Hydrieren fügt also nur Beschriftungen hinzu.
    - Der Durchschnitt ist eine gestrichelte Linie (`border-dashed`, erste gestrichelte Linie im Projekt), linear im Intervall verortet (`histogramPosition`); NAS steht in `slate-400` hinter einer gestrichelten Trennlinie.

## Historie

`/history` (#36) zeigt die Flaschen aller aufgelösten Tastings als Tabelle mit Suche, Filtern und Sortierung (`HistoryBottleTable.svelte`, `src/lib/historyTable.ts`), sonst nichts. `SubHeader` und Tabelle stehen im selben `max-w-6xl`-Container, damit sie bündig sind; der App-Header bleibt schmaler.

- **Sichtbarkeit und Projektion** wie bei der Statistik (bewusste Erweiterung, gemeinsamer Helfer `revealedBottles`, siehe Statistikseite). `getHistory` in `tastings.ts` pickt die Felder explizit (`HistoryBottle`): Slug (Datum als Link) und `presentation: { bottleId, viewable }` (neutraler Download-Link „Präsentation“, bei `viewable` dazu „Ansehen“) gibt es nur für Tastings mit eigener Teilnahme, die Präsentation außerdem nur mit Datei und Originalnamen (dieselbe Bedingung wie `presentationRef` und die Download-Route); die Download-Route prüft die Teilnahme ohnehin. Weder Platten- noch Originalname der Präsentation, keine Faktoren, kein Score. Sortiert nach neuestem Tasting, darin nach Bringer und Slot. Kein Eintrag in `securityHeaders.ts`.
- **Tabellenzustand im Query-String** (`q`, `by`, `year`, `sort`, `dir`, Standardwerte bleiben weg): Der `load` liest bewusst kein `url`, sonst liefe er bei jeder Änderung erneut. Die Seite leitet alles per `$derived` aus `page.url` ab und prüft jeden Parameter einzeln gegen eine Whitelist (`parseTableQuery`, client-tauglich), ungültige fallen still auf den Standard zurück. Geschrieben wird per `goto(resolve(…), { replaceState: true, noScroll: true, keepFocus: true })`.
  - Das Suchfeld hängt per `value={query.q}` direkt an der URL und springt beim schnellen Tippen trotzdem nicht zurück: Der Router verwirft eine von der nächsten Taste überholte Navigation (`navigate()` setzt das Token synchron). `q` steht ungetrimmt in der URL, sonst ließe sich kein Leerzeichen tippen; getrimmt wird erst beim Vergleich.
  - Die Suche vergleicht mit denselben Texten, die die Zellen zeigen (`bottleCells`), pro Spalte getrennt, damit kein Treffer über zwei Spalten reicht.
- **Anker `#bottle-<n>`**: `n` ist die Position in der aufsteigenden Standardreihenfolge (Tasting, Username, Slot – wie die Auflösung von Archiv-Tastings, `numberBottles()`). Die Flaschen-ID taugt nicht, sie steht nur bei eigener Teilnahme im Payload. Dieselbe Zählung nutzen die Meilensteine der Statistik. Die Hervorhebung der angesprungenen Zeile kommt aus `page.url.hash`, nicht aus CSS `:target` (bei pushState-Navigation unzuverlässig). Der Hash bleibt undekodiert: Die Anker sind ASCII, und `decodeURIComponent()` wirft bei einem kaputten Hash wie `#%` und legte so das Hydrieren lahm. Jede Flasche ist ein eigenes `<tbody>` aus Zeile und mobiler Kachel, damit Anker und Hervorhebung beide treffen.
- **Mobil** (unter `lg`) sind nur Whisky, Datum und „Von“ (für Screenreader „Mitgebracht von“) Spalten, der Rest steht als `<dl>` in einer Kachelzeile mit `colspan`; „Sortieren nach“ und ein Richtungs-Button ersetzen die fehlenden Spaltenköpfe.
  - **Spaltenbreiten**: `table-fixed` ignoriert `min-width`. Die `w-*`-Klassen der Spaltenköpfe sind deshalb so gewählt, dass jeder Kopf samt Sortier-Icon einzeilig passt, ausgelegt auf DejaVu Sans (Linux/CI), die breiteste übliche Systemschrift. Die Whisky-Spalte bekommt den Rest. „Keine Flasche gefunden.“ steht außerhalb der `<table>`: Eine Zelle mit `colspan="8"` legte unterhalb von `lg` fünf leere Spalten an, die die Whisky-Spalte auf 25 px drückten.

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
GOTENBERG_URL=http://gotenberg:3000   # Umwandlung für den Präsentations-Viewer (Default im Dockerfile);
                                      # lokal leer lassen oder auf ein per docker run gestartetes Gotenberg zeigen
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
  - Die Tasting-Grenzen (`TASTING_*`, `TASTING_SLUG_RE`, `normalizeWhiskybaseUrl()`) liegen ebenfalls dort und sind zugleich die einzige Quelle für Formular-Attribute, Server-Validierung und die CHECK-Constraints im Schema.
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
- Das Prod-Compose auf dem VPS liegt nicht im Repo: Der `gotenberg`-Service aus `compose.yaml` muss dort von Hand nachgezogen werden, in einem internen Netzwerk wie `tandoor-internal` (nicht im Traefik-Netzwerk `web`), `app` hängt an beiden.
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
  - Der `gotenberg`-Service prüft dagegen per `curl` (`/health`): Das Image
    bringt `curl` eigens für Healthchecks mit.

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
  - Die Teilnehmerseite erreicht `tasting.e2e.ts` nur über den Hero („Nächstes Tasting“) der Startseite (der Admin nimmt selbst teil). Dort trägt er genau eine Flasche mit langen Namen ein, nur damit die Historie nach „Jetzt auflösen“ eine echte Zeile und die Statistik einen Rekord hat. Ihre Präsentation ist `tests/fixtures/slides.pdf` (drei einfarbige Folien als ASCII-PDF, auch vom Komponenten-Test des Viewers genutzt): Nach „Reihenfolge jetzt freigeben“ öffnet der Test über „Ansehen“ den Viewer und prüft die erste Folie per Pixelfarbe – das sichert das Bundling des pdf.js-Workers im gebauten App ab. Ein Original-PDF braucht kein Gotenberg, CI startet keins. Derselbe Schritt prüft, dass `/` bei 360 px Breite nicht horizontal scrollt und beide Tasting-Karten gleich groß sind – nur dort greift echtes CSS, die Komponenten-Tests laden kein Tailwind. Danach prüft er `/history` (Einstieg über die Kachel): bei 1280 px alle Spalten der Flaschentabelle in einer Zeile und die Tabelle über 1000 px breit, bei 360 px nur drei Spalten und weder die Seite noch die Tabelle horizontal scrollend, in beiden Breiten einzeilige Spaltenköpfe, bei 360 px auch ohne Suchtreffer. Zuletzt `/statistics`: bei 360 px mit beiden Intervall-Reglern auf 1 kein horizontales Scrollen, und ein Rekord-Link landet auf der sichtbaren, hervorgehobenen Zeile `/history#bottle-<n>`. Eingabe, Reihenfolge, Auflösung und Präsentations-Download der Teilnehmer decken Route- und Komponenten-Tests ab.
- **Submit-Callbacks von `use:enhance`** (Toast, `update({ reset: false })`, `invalidateAll()`) testet man mit gemocktem `$app/forms` und `$app/navigation` (Muster `TastingBottleForm.svelte.test.ts`): Das echte `update()` braucht einen laufenden SvelteKit-Client. Für reine Bestätigungsdialoge bleibt das echte `enhance` mit abgefangenem `fetch` die Vorlage (`admin/page.svelte.test.ts`).
  - Hat eine Komponente mehrere Formulare (Karte einer weiteren Flasche: `save` und `remove`), merkt sich der Mock die Callbacks pro `action`-Attribut. Ein `requestSubmit()` nach dem Dialog fängt ein Spy auf `HTMLFormElement.prototype` ab – ohne das echte `enhance` schickt der Browser das Formular sonst nativ ab und navigiert.
- **Test-DBs** (In-Memory) über `runMigrations(sqlite, './drizzle')` aufbauen: Es migriert wie die App und lässt die Fremdschlüssel danach eingeschaltet – SQLite erzwingt sie sonst nicht, Cascade- und `restrict`-Tests liefen ins Leere. Tests, die User löschen, müssen vorher die Tastings löschen (`restrict` über die Teilnahmen).
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
  import { createRequire } from 'node:module';
  import pino from 'pino';
  import { dev } from '$app/environment';

  export const logger = pino({
    level: dev ? 'debug' : 'info',
    transport: dev ? { target: createRequire(import.meta.url).resolve('pino-pretty') } : undefined
  });
  ```
- **Transport-Target als absoluter Pfad**: Seit pino 10.4 löst pino ein nacktes `'pino-pretty'` über `util.getCallSites()` relativ zum Aufrufer auf. Unter Vites SSR-Module-Runner bleibt dabei nur das eval'te Modul ohne brauchbaren Dateinamen übrig, und `vite dev` bricht mit „unable to determine transport target“ ab.

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
  Erste Umsetzung im Projekt: `TastingValidationError` in `src/lib/server/tastings.ts` für Regelverstöße der Domain-Schicht (Speichern außerhalb der Eingabephase, Datumsänderung außerhalb der Eingabephase, ungültiger Slot, Entfernen einer Flasche aus Slot 1/2 oder außerhalb der Eingabephase, Speichern oder Entfernen in einem Tasting mit Archiv-Flasche, Admin-Button für eine schon erreichte Phase, unbekannter oder deaktivierter Teilnehmer beim Anlegen, alle Tasting-Links vergeben).
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