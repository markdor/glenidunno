---
description: Einstieg in die Implementierung eines GitHub Issues – Kontext laden → Codebase-Analyse → Implementierungsplan. Aufruf: /implement <Issue-Nummer>
model: opus
effort: max
---

Du bereitest die Implementierung eines GitHub Issues vor. Ziel ist **nicht**, den Code fertig zu schreiben, sondern einen fundierten Implementierungsplan zu erarbeiten und zur Freigabe vorzulegen. Die eigentliche Umsetzung läuft danach wie gewohnt interaktiv im Chat weiter.

**Eingabe:** `$ARGUMENTS` – eine Issue-Nummer (z. B. `12`).

Falls kein Argument übergeben wurde: Frage den User nach der Issue-Nummer und brich dann ab – er soll den Skill mit der Nummer neu aufrufen.

---

## Phase 1 – Kontext laden

Führe **parallel** aus:
1. `gh issue view $ARGUMENTS --json number,title,body,labels,state,comments` – lädt das Issue.
2. Lies `CLAUDE.md` – Architektur, Stack, Konventionen, Teststrategie, Error-Handling-Pattern.

Merke dir Titel, Body und Labels des Issues.

**Vollständigkeits-Check:** Prüfe, ob der Issue-Body Akzeptanzkriterien und technischen Kontext enthält (Sektionen wie „Akzeptanzkriterien", „Technischer Kontext" – typisches Ergebnis von `/refine`). Fehlen diese und ist der Body nur ein kurzer Stichpunkt, weise den User darauf hin und frage per `AskUserQuestion`, ob:
- er das Issue erst mit `/refine $ARGUMENTS` ausformulieren lassen möchte (dann brich hier ab), oder
- direkt mit dem vorhandenen (knappen) Body weitergemacht werden soll.

---

## Phase 2 – Branch sicherstellen

Dieser Skill arbeitet **niemals direkt auf `main`**. Prüfe den aktuellen Branch (`git branch --show-current`):

- **Branch beginnt bereits mit `feat/`**: weiter mit Phase 3, kein Wechsel nötig.
- **Branch ist `main`**: Leite aus dem Issue-Titel einen sprechenden Slug ab (klein geschrieben, Umlaute transkribiert `ä→ae`, `ö→oe`, `ü→ue`, `ß→ss`, Nicht-alphanumerische Zeichen durch `-` ersetzt, keine doppelten/führenden/abschließenden Bindestriche) und erstelle daraus `feat/$ARGUMENTS-<slug>` (z. B. Issue #3 „Rückbau auf Login und Admin-Seite" → `feat/3-rueckbau-auf-login-und-admin-seite`). Erstelle den Branch mit `git checkout -b feat/$ARGUMENTS-<slug>` und teile dem User kurz mit, welcher Branch angelegt wurde.
- **Branch ist weder `main` noch `feat/*`**: Brich ab und frage den User per `AskUserQuestion`, ob er zu `main` wechseln möchte (damit der Skill automatisch einen passenden `feat/`-Branch anlegt) oder manuell zu einem bestehenden `feat/`-Branch wechselt. Lege selbstständig keinen Branch von einem fremden Branch aus an.

---

## Phase 3 – Codebase-Analyse

Spawne einen **Explore-Agenten** (subagent_type: `Explore`, Breadth: `medium`) mit folgendem Auftrag:

> Analysiere den Code für Issue #$ARGUMENTS ("$ISSUE_TITLE"). Finde:
> 1. Betroffene Routen und SvelteKit-Komponenten (pages, layouts, +page.svelte, +server.ts)
> 2. Betroffenes Drizzle-Datenbankschema (src/lib/server/db/schema.ts) und ob eine neue Migration nötig ist
> 3. Betroffene API-Endpunkte (src/routes/api/) bzw. geteilte Typen/Konstanten in src/lib/validation.ts
> 4. Bestehende ähnliche Implementierungen, die als Vorlage für Struktur, Error-Handling und Tests dienen können
> 5. Auth/Security-Relevanz: Auth-Guard, Validierung, Rate-Limiting nötig?
> 6. Betroffene Tests: welche `*.svelte.test.ts` (client) bzw. `*.test.ts` (server) müssten neu geschrieben oder angepasst werden, inkl. grober Einschätzung zur Coverage-Gate-Auswirkung (>85 %)
> Gib eine kompakte Liste der betroffenen Dateien mit je einem Satz Erklärung zurück.

Warte auf das Ergebnis des Agenten.

---

## Phase 4 – Implementierungsplan erarbeiten

Kombiniere Issue-Inhalt + Codebase-Analyse zu einem konkreten Schritt-für-Schritt-Plan. Der Plan muss:

- jedes Akzeptanzkriterium des Issues auf mindestens einen Umsetzungsschritt abbilden (nichts darf ohne Abdeckung bleiben) – merke dir diese Zuordnung Schritt → Akzeptanzkriterium/-ien explizit, sie wird in Phase 6 gebraucht,
- neue/geänderte Dateien explizit benennen (Pfad + Zweck),
- Reihenfolge sinnvoll wählen (z. B. Schema/Migration → API-Endpoint → UI → Tests, oder TDD-Reihenfolge falls passend),
- CLAUDE.md-Konventionen respektieren: geteilte Typen/Konstanten in `src/lib/validation.ts` (client-tauglich, nicht unter `$lib/server`), typisierte Fehlerklassen mit `userMessage`, pino-Logging, Vitest-Projektaufteilung (client/server), Playwright nur bei kritischen Flows,
- Security-relevante Punkte (Auth-Guard, Validierung, Rate-Limiting) als eigene Schritte ausweisen, falls die Analyse sie identifiziert hat,
- am Ende einen Schritt für Tests/Coverage-Check enthalten.

Gehe anschließend über `EnterPlanMode` in den Plan-Mode und lege den Plan dem User zur Freigabe vor (`ExitPlanMode`). Iteriere, falls der User Änderungen wünscht.

---

## Phase 5 – Übergabe an die Implementierung

Nach Freigabe des Plans:
- Lege die Schritte des Plans als Todos via `TodoWrite` an, damit der Fortschritt im weiteren Chat-Verlauf sichtbar bleibt. Übernimm dabei die Zuordnung aus Phase 4: welches Todo welche(s) Akzeptanzkriterium/-ien abdeckt.
- Beginne **nicht automatisch** mit dem Schreiben von Code – warte auf die nächste Nachricht des Users bzw. mache im selben Turn direkt mit dem ersten Todo weiter, falls der User das beim Freigeben so signalisiert (z. B. „leg los").

---

## Phase 5.5 – Verifikation vor Abschluss (Pflicht, kein Angebot)

Bevor der Skill **irgendein** Todo als `completed` markiert oder die Gesamtarbeit als getan betrachtet, **immer** – unabhängig davon, ob zuvor schon einzelne Test-Befehle manuell gelaufen sind:

1. `npm run test:coverage`
2. `npm run lint`
3. `npm run test`

Alle drei müssen grün sein. Schlägt einer fehl: Todo bleibt `in_progress`, Fehler beheben, alle drei erneut laufen lassen – erst danach gilt der Schritt als fertig. Diese drei Befehle sind kein optionales Angebot wie Commit/Push/PR in Phase 7, sondern eine feste Bedingung, die der Skill selbstständig prüft, ohne zu fragen.

**Hintergrund:** `npm run test:coverage` prüft nur Unit-Tests + Coverage, `npm run test` deckt zusätzlich E2E ab – keiner der beiden läuft `npm run lint` (Prettier + ESLint) mit. Eine reine Text-/Format-Änderung kann trotz grüner Tests am CI-Lint-Job scheitern (Prettier-Zeilenumbruch-Regeln reagieren auf Textlänge). Ohne diesen expliziten Lint-Lauf bleibt das lokal unbemerkt und fällt erst in der GitHub-Actions-CI auf.

---

## Phase 6 – Akzeptanzkriterien im Issue abhaken

Sobald im weiteren Gesprächsverlauf ein Todo via `TodoWrite` als `completed` markiert wird, das laut Zuordnung aus Phase 4/5 mindestens ein Akzeptanzkriterium abdeckt:

1. **Nur abhaken, wenn wirklich erfüllt**: Voraussetzung ist immer, dass Phase 5.5 (alle drei Befehle grün) für diesen Stand bereits durchlaufen wurde. Prüfe zusätzlich kurz, ob das Kriterium inhaltlich vollständig umgesetzt ist. Im Zweifel ungecheckt lassen und dem User kurz mitteilen, warum – kein Abhaken auf Verdacht.
2. **Aktuellen Issue-Body holen**: `gh issue view $ARGUMENTS --json body -q .body` – nicht den Stand aus Phase 1 wiederverwenden, falls der Issue-Body zwischenzeitlich extern geändert wurde.
3. **Checkbox(en) umschalten**: In der Sektion „## Akzeptanzkriterien" die passende(n) Zeile(n) von `- [ ] ...` auf `- [x] ...` setzen, exakter Text der Zeile bleibt sonst unverändert. Alle anderen Sektionen unangetastet lassen.
4. **Zurückschreiben**: `gh issue edit $ARGUMENTS --body-file -` mit dem aktualisierten Body über Stdin füttern (vermeidet Shell-Escaping-Probleme bei Markdown/Sonderzeichen).
5. Keine Rückfrage nötig – Checkbox-Updates sind non-destruktiv und jederzeit reversibel, anders als Commit/Push/PR (Phase 7). Kurze Erwähnung im Chat reicht („Akzeptanzkriterium X im Issue abgehakt").

Enthält der Issue-Body keine Checkbox-Sektion (z. B. weil `/refine` übersprungen wurde), entfällt diese Phase stillschweigend.

---

## Phase 7 – Commit, Push & PR nach den ersten Edits

Abweichend vom sonst im Projekt geltenden Grundsatz „nie committen/pushen" (siehe Grundsätze) darf **dieser Skill-Flow** nach einem sinnvollen ersten Zwischenstand aktiv anbieten, in einem Zug zu committen, zu pushen und einen PR anzulegen – z. B. wenn das erste Todo aus Phase 5 abgeschlossen ist. Voraussetzung ist immer, dass Phase 5.5 für den aktuellen Stand grün durchlaufen wurde – kein Commit/Push/PR-Angebot auf Basis eines Standes, der nicht durch alle drei Befehle verifiziert wurde. Immer nur als Angebot, nie automatisch ohne Zustimmung im Chat:

1. **Commit**: `git add` der betroffenen Dateien + `git commit` mit sprechender Conventional-Commits-Message (Stil an bestehender Historie orientieren).
2. **Push**: `git push -u origin <branch>` im selben Aufwasch.
3. **PR**: vorher per `gh pr list --head <branch>` prüfen, ob schon ein PR existiert (nicht doppelt anlegen). Falls nicht: `gh pr create --draft`, Body aus `.github/pull_request_template.md` mit `Closes #$ARGUMENTS` in der vorgesehenen Zeile, sprechender Titel aus dem Issue-Titel.

Lehnt der User ab oder committet/pusht lieber selbst: für diesen Stand nicht weiter nachfragen. Erkennst du im späteren Gesprächsverlauf trotzdem, dass er selbst gepusht hat (`git log`/`git status` zeigt Remote-Commits ohne PR), biete zumindest Schritt 3 (PR-Erstellung) weiterhin proaktiv an.

Diese Ausnahme gilt **nur innerhalb von `/implement`** – außerhalb dieses Skill-Flows bleibt die generelle Regel unverändert: nichts committen/pushen ohne explizite Aufforderung.

---

## Grundsätze

- **Nur auf Featurebranches**: Niemals direkt auf `main` arbeiten. Branch heißt immer `feat/<issue-nummer>-<sprechender-slug>`; auf main wird er automatisch angelegt, auf fremden Branches wird abgebrochen und nachgefragt.
- **Kein Scope-Creep**: Der Plan deckt nur ab, was im Issue steht – keine Bonus-Features.
- **Keine Halluzinationen**: Nenne im Plan nur Dateien, die der Explore-Agent tatsächlich gefunden hat oder die laut Issue offensichtlich neu entstehen müssen.
- **Commit/Push nur nach Zustimmung**: Phase 2 (Branch) committet nie von selbst. Ab Phase 7 darf nach den ersten Edits aktiv angeboten werden zu committen, zu pushen und den PR anzulegen – aber immer nur als Angebot, nie automatisch. Lehnt der User ab, committet er wie gewohnt selbst.
- **Akzeptanzkriterien-Checkboxen laufen automatisch**: Anders als Commit/Push/PR braucht Phase 6 keine Zustimmung – Checkbox-Updates im Issue sind non-destruktiv und jederzeit reversibel.
- **Verifikation vor „fertig"**: Kein Todo, keine Akzeptanzkriterium-Checkbox und kein Commit/Push/PR-Angebot ohne vorher grün durchlaufene Phase 5.5 (`npm run test:coverage`, `npm run lint`, `npm run test`) – manuell einzeln ausgeführte Einzelbefehle ersetzen das nicht, wenn `npm run lint` dabei fehlte.
- **Kompakt**: Der Plan ist eine Anleitung, kein Aufsatz – Stichpunkte statt Fließtext, wo möglich.
