---
description: Tiefenprüfung eines Pull Requests vor dem Merge – Qualität, Security, UX, Clean Code, Architektur gegen CLAUDE.md. Aufruf: /pr-review <PR-Nummer>
model: opus
effort: max
---

Du prüfst einen Pull Request vor dem Merge. Ziel ist eine ehrliche, fundierte Einschätzung entlang fünf Dimensionen – keine Kosmetik-Kommentare, sondern Befunde, die tatsächlich mergerelevant sind.

**Eingabe:** `$ARGUMENTS` – eine PR-Nummer (z. B. `23`).

Falls kein Argument übergeben wurde: Frage den User nach der PR-Nummer und brich dann ab – er soll den Skill mit der Nummer neu aufrufen.

---

## Phase 1 – Kontext laden

Führe **parallel** aus:
1. `gh pr view $ARGUMENTS --json number,title,body,author,baseRefName,headRefName,files,additions,deletions,state`
2. `gh pr diff $ARGUMENTS` – der vollständige Diff.
3. `gh pr checks $ARGUMENTS` – CI-Status (Tests, Coverage, Lint).
4. Lies `CLAUDE.md` – Architektur, Konventionen, Teststrategie, Security- und Error-Handling-Vorgaben, UI-Design.

Merke dir Titel, Beschreibung, Branch-Namen, geänderte Dateien und den Diff-Inhalt.

---

## Phase 2 – Vergleichskontext holen

Spawne einen **Explore-Agenten** (subagent_type: `Explore`, Breadth: `medium`) mit folgendem Auftrag:

> PR #$ARGUMENTS ("$PR_TITLE") ändert diese Dateien: $GEÄNDERTE_DATEIEN. Finde für jede thematisch passende bestehende Implementierungen im **übrigen** Code (nicht im PR selbst), die als Vergleichsmaßstab dienen: analoge Routen/Komponenten, bestehendes Error-Handling-Pattern, bestehende Test-Struktur, bestehende UI-Bausteine (Formulare, Toast, Farbschema-Nutzung). Gib eine kompakte Liste mit Datei + Ein-Satz-Erklärung zurück, worin die Vergleichsstelle relevant ist.

Warte auf das Ergebnis. Es dient als Referenz, um Konsistenz zu beurteilen – nicht nur den Diff isoliert zu betrachten.

---

## Phase 3 – Review entlang der fünf Dimensionen

Prüfe den Diff systematisch gegen jede Dimension. Nutze konkret aus CLAUDE.md ableitbare Kriterien, keine generischen Floskeln:

1. **Qualität & Tooling** (`## Qualität & Tooling` in CLAUDE.md)
   - Unit-Tests vorhanden und sinnvoll (Vitest `client`/`server`-Trennung passend zum geänderten Code), Coverage-Gate >85 % nicht gefährdet, jeder Test hat eine echte Assertion (`requireAssertions`).
   - Playwright/E2E nur bei kritischen Flows ergänzt, nicht wahllos.
   - pino-Logging statt `console.log`/`console.error`.
   - Typisierte Fehlerklassen mit `userMessage` + Handler-Pattern (`fail(422/500, …)`, `catch (e: unknown)` mit `instanceof`-Verengung) bei neuen Fehlerpfaden.
   - CI (`gh pr checks`) grün, insbesondere Test- und Coverage-Job.

2. **Security**
   - Neue Routen respektieren den Closed-App-Auth-Guard.
   - Eingabevalidierung nutzt geteilte Konstanten aus `src/lib/validation.ts` statt Magic Numbers je Schicht.
   - Keine internen Fehlertexte/Stacktraces, die an den Client durchgereicht werden.
   - Bei neuen Auth-/Rate-Limiting-relevanten Routen: Rate-Limits bedacht, Timing-Equalization bei sicherheitskritischen Vergleichen (z. B. Enumeration).
   - Keine Secrets, Tokens oder Klartext-Passwörter im Code, in Logs oder Kommentaren.
   - Übliche OWASP-Basics: Parametrisierte Queries (Drizzle stellt das i. d. R. sicher – prüfen, ob Rohes SQL umgangen wird), keine ungefilterte Ausgabe von User-Input in HTML.

3. **UX-Konsistenz**
   - Mobile-first, großzügige Touch-Targets, Desktop nur nachrangig.
   - Eukalyptus-/Salbei-Farbschema (`layout.css`) eingehalten, keine neuen Ad-hoc-Farben; semantische Akzente (Amber für Hinweise, Brand-Grün) nur für Status.
   - UI-Texte auf Deutsch, Code/Kommentare auf Englisch.

4. **Clean Code**
   - Sprechende Namen, keine überflüssigen Kommentare (nur WHY bei nicht-offensichtlichen Constraints).
   - Keine premature Abstraktion, kein Scope-Creep über den PR-Zweck hinaus, keine toten Codepfade oder auskommentierten Reste.
   - Duplikation nur dort vermieden, wo es die Domäne rechtfertigt (nicht um jeden Preis DRY).

5. **Architektur**
   - Geteilte Domänen-Typen/-Konstanten liegen zentral in `$lib` (z. B. `src/lib/validation.ts`), nicht pro Schicht dupliziert.
   - Schema-Änderungen über Drizzle-Migration (committed, nicht `drizzle-kit push`).
   - Serverlogik in `src/lib/server/**`, keine DB-Zugriffe direkt aus Komponenten oder `+page.svelte`.
   - Kein Nx/Turborepo/Postgres eingeführt; Single-App-Struktur im Repo-Root eingehalten (keine npm Workspaces, kein `packages/`).

---

## Phase 4 – Befunde melden

Melde die Ergebnisse über `ReportFindings`. Für jeden Befund:
- `category`: eine der fünf Dimensionen als kebab-case-Slug (`quality-tooling`, `security`, `ux-consistency`, `clean-code`, `architecture`).
- `file` + `line`: konkrete Stelle im Diff.
- `summary` + `failure_scenario`: was konkret schiefgeht oder schiefgehen könnte – kein „könnte man verbessern" ohne Konsequenz.
- `verdict`: `CONFIRMED` wenn im Diff eindeutig belegbar, `PLAUSIBLE` wenn eine begründete Vermutung ohne 100%ige Gewissheit.

Sortiere nach Schwere (mergeblockierend zuerst). Keine Befunde erfinden, um alle fünf Dimensionen künstlich zu befüllen – eine Dimension ohne Befund bleibt leer.

---

## Phase 5 – Ergebnis auf GitHub posten (optional)

Frage per `AskUserQuestion`, ob die Zusammenfassung als Kommentar auf den PR gepostet werden soll. Falls ja: `gh pr comment $ARGUMENTS --body "…"` mit einer kompakten Zusammenfassung der Befunde (gruppiert nach Dimension). Falls nein: Befunde bleiben nur im Chat.

**Niemals automatisch** `gh pr review --approve` oder `--request-changes` ausführen – die Merge-Entscheidung trifft der User.

---

## Grundsätze

- **Nur Beleg-basiert**: Bewerte den tatsächlichen Diff und existierenden Code, keine Spekulation über nicht vorhandenen Code.
- **Kein Kommentar ohne Bestätigung**: Nichts wird auf GitHub gepostet, ohne dass der User in Phase 5 zugestimmt hat.
- **Keine Merge-Entscheidung**: Der Skill bewertet, approved/blockiert aber nie selbst.
- **Kompakt**: Befunde als Stichpunkte mit Datei:Zeile-Bezug, kein Fließtext-Aufsatz.
