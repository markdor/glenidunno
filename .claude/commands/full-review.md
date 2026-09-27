---
description: Tiefenprüfung der gesamten Codebase auf Konsistenz mit CLAUDE.md und Regressionen gegen bereits umgesetzte (closed) Issues – Qualität, Security, UX, Clean Code, Architektur. Pro Finding optionale Issue-Erstellung. Aufruf: /full-review
model: opus
effort: max
---

Du prüfst die **gesamte Codebase** auf Konsistenz mit CLAUDE.md. Ziel ist eine ehrliche, fundierte Einschätzung entlang fünf Dimensionen – keine Kosmetik-Kommentare, sondern Befunde, die tatsächlich behebenswert sind. Anders als `/pr-review` betrachtest du nicht einen einzelnen Diff, sondern den kompletten aktuellen Stand des Repos, und bietest pro Fund an, direkt ein GitHub Issue anzulegen.

Zusätzlich beziehst du alle bereits umgesetzten (closed) Issues ein – zum einen als **Kontext**, damit bewusste, in einem Issue dokumentierte Entscheidungen nicht fälschlich als Verstoß gemeldet werden, zum anderen als **Regressions-Check**: bereits abgenommene Akzeptanzkriterien werden gegen den heutigen Code verifiziert.

---

## Phase 1 – Kontext laden

Führe **parallel** aus:
1. Lies `CLAUDE.md` – Architektur, Konventionen, Teststrategie, Security- und Error-Handling-Vorgaben, UI-Design.
2. `git rev-parse --short HEAD` und `git branch --show-current` – als Referenz für später angelegte Issues.
3. `gh issue list --state closed --json number,title,body,stateReason --limit 500` – alle geschlossenen Issues.

Merke dir Commit-Hash und Branch. Behalte von den geschlossenen Issues nur die mit `stateReason == "COMPLETED"` (tatsächlich umgesetzt, nicht `NOT_PLANNED`/Duplikate o. Ä.). Teile diese Menge gedanklich in zwei Verwendungen auf:
- **Kontext** (alle behaltenen Issues): Titel + worum es ging – für Phase 3.
- **Regressions-Grundlage** (nur Issues mit einer `## Akzeptanzkriterien`-Sektion im Body, typischerweise via `/refine` entstanden): Issue-Nummer, Titel und die einzelnen Checkbox-Items – für Phase 2.

---

## Phase 2 – Codebase-Analyse

Spawne **fünf Explore-Agenten parallel** (subagent_type: `Explore`, Breadth: `very thorough`), je einen pro Dimension aus Phase 3, **plus einen sechsten** für den Regressions-Check, sofern die Regressions-Grundlage aus Phase 1 nicht leer ist – sonst entfällt der sechste. Explore lädt CLAUDE.md **nicht** automatisch – die relevanten Kriterien sind deshalb direkt in den Aufträgen unten ausformuliert, kein Verweis auf die Datei nötig.

1. **Qualität & Tooling:**
   > Durchsuche die gesamte Codebase nach Abweichungen von diesen Standards: Unit-Tests vorhanden und sinnvoll (Vitest `client`/`server`-Trennung passend zum Code, jeder Test mit echter Assertion), Playwright/E2E nur bei kritischen Flows, pino-Logging statt `console.log`/`console.error`, typisierte Fehlerklassen mit `userMessage` + Handler-Pattern (`fail(422/500, …)`, `catch (e: unknown)` mit `instanceof`-Verengung) bei Fehlerpfaden. Gib pro Fund Datei:Zeile + kurze Erklärung zurück, keine Bewertung, nur Belege.

2. **Security:**
   > Durchsuche die gesamte Codebase nach Security-Abweichungen: Auth-Guard bei geschützten Routen, Eingabevalidierung über geteilte Konstanten aus `src/lib/validation.ts` statt Magic Numbers je Schicht, keine internen Fehlertexte/Stacktraces an den Client, Timing-Equalization bei sicherheitskritischen Vergleichen (z. B. Enumeration), keine Secrets/Tokens/Klartext-Passwörter in Code/Logs/Kommentaren, parametrisierte Queries (kein rohes SQL umgangen), keine ungefilterte Ausgabe von User-Input in HTML. Gib pro Fund Datei:Zeile + kurze Erklärung zurück.

3. **UX-Konsistenz:**
   > Durchsuche alle Svelte-Komponenten/Seiten nach Abweichungen von: Mobile-first mit großzügigen Touch-Targets, Eukalyptus-/Salbei-Farbschema aus `layout.css` (keine neuen Ad-hoc-Farben/hartkodierten Hex-Werte, semantische Akzente nur Amber für Hinweise/Brand-Grün für Status), UI-Texte Deutsch/Code Englisch, Icon-Konvention (`@lucide/svelte`, feste `size`/`strokeWidth` je Verwendungszweck, Farbe nur über `currentColor`). Gib pro Fund Datei:Zeile + kurze Erklärung zurück.

4. **Clean Code:**
   > Durchsuche die gesamte Codebase nach Clean-Code-Abweichungen: überflüssige Kommentare (nur WHY bei nicht-offensichtlichen Constraints erlaubt), premature Abstraktionen, tote Codepfade oder auskommentierte Reste, unsprechende Namen, Duplikation ohne Domänen-Rechtfertigung. Gib pro Fund Datei:Zeile + kurze Erklärung zurück.

5. **Architektur:**
   > Durchsuche die gesamte Codebase nach Architektur-Abweichungen: geteilte Domänen-Typen/-Konstanten dupliziert statt zentral in `$lib` (z. B. `src/lib/validation.ts`), Schema-Änderungen ohne committete Drizzle-Migration (bzw. Nutzung von `drizzle-kit push`), DB-Zugriffe direkt aus Komponenten/`+page.svelte` statt `src/lib/server/**`, Einführung von npm Workspaces/Nx/Turborepo/Postgres. Gib pro Fund Datei:Zeile + kurze Erklärung zurück.

6. **Regressions-Check** (nur falls Regressions-Grundlage aus Phase 1 nicht leer ist):
   > Verifiziere für jedes der folgenden bereits umgesetzten (closed) Issues, ob der **aktuelle** Code jedes seiner Akzeptanzkriterien noch erfüllt: [hier die in Phase 1 gesammelte Liste aus Issue-Nummer, Titel und Checkbox-Items einsetzen]. Suche je Issue die zugehörigen Dateien/Routen und prüfe den IST-Zustand gegen jedes einzelne Kriterium. Gib **nur** nicht mehr erfüllte Kriterien zurück, mit: Issue-Nummer, Kriterium im Wortlaut, Datei:Zeile des heutigen unzureichenden Zustands, kurze Erklärung was fehlt oder kaputt ist. Weiterhin erfüllte Kriterien nicht auflisten.

Warte auf **alle gespawnten** Agenten (fünf oder sechs), bevor du mit Phase 3 fortfährst.

---

## Phase 3 – Bewertung entlang der fünf Dimensionen plus Regressionen

Bewerte die gemeldeten Funde aller Agenten gegen dieselben Kriterien, die du ihnen in Phase 2 mitgegeben hast. Ordne jeden Fund einer Kategorie zu (die fünf Dimensionen oder `regression` für Funde des sechsten Agenten) und entscheide, ob er ein eindeutig belegbarer Verstoß (`CONFIRMED`) oder eine begründete Vermutung ohne 100%ige Gewissheit (`PLAUSIBLE`) ist. Verifiziere stichprobenartig gegen die tatsächliche Datei, bevor du einen Fund übernimmst – Explore-Ergebnisse können ungenau sein.

**Kontext-Abgleich gegen closed Issues:** Prüfe für jeden vermeintlichen Verstoß der fünf CLAUDE.md-Dimensionen, ob er durch eine in einem closed Issue (Kontext-Liste aus Phase 1) dokumentierte, bewusste Entscheidung gedeckt ist (z. B. expliziter Scope-Ausschluss, begründete Abweichung). Falls ja: nicht als Finding übernehmen, oder – falls die Abweichung trotzdem erwähnenswert ist – die Deckung durch das Issue kurz in `failure_scenario` vermerken statt sie als unentdeckten Verstoß darzustellen.

---

## Phase 4 – Befunde melden

Melde die Ergebnisse über `ReportFindings`. Für jeden Befund:
- `category`: eine der fünf Dimensionen als kebab-case-Slug (`quality-tooling`, `security`, `ux-consistency`, `clean-code`, `architecture`) oder `regression` für Funde des sechsten Agenten. Bei `regression` referenziere die betroffene Issue-Nummer direkt im `summary` (z. B. „Akzeptanzkriterium aus #12 nicht mehr erfüllt: …").
- `file` + `line`: konkrete Stelle im Code.
- `summary` + `failure_scenario`: was konkret schiefgeht oder schiefgehen könnte – kein „könnte man verbessern" ohne Konsequenz.
- `verdict`: `CONFIRMED` oder `PLAUSIBLE`.

Sortiere nach Schwere (gravierendste zuerst) – Funde der Kategorie `regression` grundsätzlich hoch einstufen, da bereits abgenommene Funktionalität betroffen ist. Keine Befunde erfinden, um alle Dimensionen künstlich zu befüllen – eine Dimension ohne Befund bleibt leer.

Gibt es keine Befunde: kurze Rückmeldung, dass die Codebase konsistent ist, Phase 5 und 6 entfallen.

---

## Phase 5 – Pro Finding: Issue-Erstellung abfragen

Gehe die Findings aus Phase 4 in der gemeldeten Reihenfolge durch. `AskUserQuestion` erlaubt maximal vier Fragen pro Aufruf – bilde daher Vierer-Batches (bei mehr als vier Findings mehrere Aufrufe nacheinander). Stelle **pro Finding eine eigene Frage** (keine multiSelect-Sammelfrage über mehrere Findings hinweg):

> „Issue erstellen für: '\<short_summary>' (\<file>:\<line>)?"
> Optionen: „Ja, Issue erstellen" / „Nein, überspringen"

Merke dir je Finding, ob zugestimmt wurde.

---

## Phase 6 – Bestätigte Issues anlegen

Für jedes Finding mit Zustimmung aus Phase 5:

1. Hole die tatsächlich vorhandenen Labels: `gh label list --json name -q '.[].name'`.
2. Ordne der Kategorie **nur** ein bereits vorhandenes Label zu, falls eines thematisch passt (z. B. `bug`, `ux`) – nie ein neues Label erfinden oder anlegen. Kein Match → Issue ohne Label.
3. Erstelle das Issue mit kompaktem Stub-Body (kein vollständig ausformuliertes Issue – das ist Aufgabe von `/refine`):
   ```bash
   gh issue create \
     --title "<summary>" \
     --body "$(cat <<'EOF'
   **Kategorie:** <category>
   **Fundort:** `<file>:<line>`
   **Problem:** <summary>
   <bei category "regression" zusätzliche Zeile: "**Regression zu:** #<issue-nummer>">

   <failure_scenario>

   **Verdict:** <CONFIRMED|PLAUSIBLE>

   ---
   _Gefunden von /full-review auf Commit <commit-hash> (Branch <branch>). Vor der Umsetzung mit /refine <issue-nummer> ausformulieren._
   EOF
   )" \
     --label "<passendes-label-oder-Flag-weglassen>"
   ```
4. Der Issue-Link steht direkt in der stdout-Ausgabe von `gh issue create`.

Fasse am Ende kompakt zusammen: Anzahl Findings gesamt, Anzahl angelegter Issues mit Links.

---

## Grundsätze

- **Nur Beleg-basiert**: Bewerte nur, was die Explore-Agenten tatsächlich im Code gefunden haben – keine Spekulation über nicht vorhandenen Code.
- **Kein Issue ohne Bestätigung**: Jedes Issue nur nach explizitem Ja in Phase 5, nie automatisch.
- **Keine Code-Änderung**: Der Skill bewertet und legt höchstens Issues an, ändert aber nie selbst Code.
- **Keine neuen Labels**: Nur vorhandene Labels zuordnen, nie neue anlegen.
- **Regressionen nur bei echtem Beleg**: Ein Akzeptanzkriterium nur als Regression melden, wenn der heutige Code es nachweisbar nicht mehr erfüllt – im Zweifel (z. B. nur anders umgesetzt als ursprünglich beschrieben) nicht melden.
- **Kompakt**: Befunde als Stichpunkte mit Datei:Zeile-Bezug, kein Fließtext-Aufsatz.
