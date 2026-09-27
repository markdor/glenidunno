---
description: Refinement eines GitHub Issues – Interview → Code-Analyse → vollständig ausformuliertes Issue. Aufruf: /refine <Issue-Nummer>
model: opus
effort: xhigh
---

Du führst ein strukturiertes Issue-Refinement durch. Ausgangslage ist ein kurz formuliertes Backlog-Item; das Ergebnis ist ein vollständig ausformuliertes, technisch fundiertes GitHub Issue.

**Eingabe:** `$ARGUMENTS` – eine Issue-Nummer (z. B. `9`).

Falls kein Argument übergeben wurde: Frage den User nach der Issue-Nummer und brich dann ab – er soll den Skill mit der Nummer neu aufrufen.

---

## Phase 1 – Kontext laden

Führe **parallel** aus:
1. `gh issue view $ARGUMENTS --json number,title,body,labels,state,comments` – lädt das bestehende Issue.
2. Lies `CLAUDE.md` – Architektur, Stack, bereits implementierte Features, UI-Konventionen.

Merke dir Titel, Body und Labels des Issues.

---

## Phase 2 – Interview

Analysiere den Issue-Titel und -Body. Identifiziere die **größten Lücken** für ein vollständiges Issue: fehlende Motivation, unklare Akzeptanzkriterien, fehlende UX-Beschreibung, unklar ob neue Route/Komponente nötig, etc.

Stelle dem User **3–4 gezielte Fragen** via `AskUserQuestion`. Wähle nur die wirklich wichtigen – lieber 3 treffsichere als 4 generische. Typische Kandidaten:

- **Motivation**: Warum brauchen wir das? Welches Problem löst es konkret?
- **Akzeptanzkriterien**: Was muss am Ende funktionieren, damit das Issue als „done" gilt?
- **UX/Interaktion**: Wie stellt du dir die Bedienung vor? Gibt es Mockups oder bestehende Seiten als Vorlage?
- **Scope-Abgrenzung**: Was gehört explizit *nicht* in dieses Issue?
- **Priorität/Abhängigkeiten**: Hängt das von einem anderen Issue ab? Gibt es eine Deadline?

Stelle nie eine Frage, deren Antwort du aus CLAUDE.md oder dem vorhandenen Issue-Text ableiten kannst.

---

## Phase 3 – Codebase-Analyse

Spawne einen **Explore-Agenten** (subagent_type: `Explore`, Breadth: `medium`) mit folgendem Auftrag:

> Analysiere den Code für Issue #$ARGUMENTS ("$ISSUE_TITLE"). Finde:
> 1. Betroffene Routen und SvelteKit-Komponenten (pages, layouts, +page.svelte, +server.ts)
> 2. Betroffenes Drizzle-Datenbankschema (src/lib/server/db/schema.ts)
> 3. Betroffene oder neu nötige geteilte Typen/Konstanten zentral in `$lib` (Validierungs-Constraints in src/lib/validation.ts)
> 4. Bestehende ähnliche Implementierungen, die als Vorlage dienen können
> 5. Auth/Security-Relevanz: Braucht die Seite einen Auth-Guard? Neue API-Endpoints?
> 6. Geschätzter Impact: Welche Tests müssten angepasst/geschrieben werden?
> Gib eine kompakte Liste der betroffenen Dateien mit je einem Satz Erklärung zurück.

Warte auf das Ergebnis des Agenten.

---

## Phase 4 – Issue ausformulieren

Kombiniere Interview-Antworten + Codebase-Analyse zu einem vollständig ausformulierten Issue nach diesem Template. Schreibe auf **Deutsch**, Code-Bezeichner bleiben auf Englisch.

```markdown
## Kontext & Motivation
<!-- Warum brauchen wir das? Welches Problem löst es für die Nutzer? -->

## Ziel
<!-- Ein-Satz-Zusammenfassung: Was soll am Ende möglich sein? -->

## Akzeptanzkriterien
- [ ] ...
- [ ] ...

## UI / UX
<!-- Beschreibung der Interaktion, betroffene Seiten, Navigation, Touch-Targets -->
<!-- Verweis auf Mockups oder bestehende Seiten als Vorlage, falls passend -->

## Technischer Kontext
<!-- Betroffene Dateien (mit Pfad), Schema-Änderungen, neue/geänderte API-Endpoints -->
<!-- Beispiel:
- `src/routes/admin/+page.svelte` – neues Formularfeld, analog zu den bestehenden Feldern
- `src/lib/server/db/schema.ts` – neue Spalte am `user`-Table, Migration via `drizzle-kit generate`
- `src/lib/server/guard.ts` – kein neuer öffentlicher Pfad nötig
-->

## Sicherheits- & Qualitätshinweise
<!-- Auth-Guard nötig? Validierung? Rate-Limiting? Welche Tests? -->

## Offene Fragen
<!-- Was muss noch geklärt werden, bevor mit der Implementierung begonnen werden kann? -->
<!-- Leer lassen, falls keine offenen Fragen -->
```

Fülle alle Sektionen aus. Lasse keine Sektion leer – schreibe notfalls „Keine besonderen Anforderungen."

---

## Phase 5 – Review & Bestätigung

Zeige dem User das fertig ausformulierte Issue **als Plaintext** (nicht in einem Tool-Aufruf versteckt). Fasse darunter in 2–3 Stichpunkten zusammen, was der Explore-Agent an technischem Kontext beigesteuert hat.

Frage dann:
- Ob der Inhalt so passt oder noch etwas angepasst werden soll.
- Welche **Labels** gesetzt werden sollen. Schlage passende aus den vorhandenen vor: `enhancement`, `bug`, `ux`, `question`. Mehrfachauswahl möglich.

Warte auf Bestätigung des Users.

---

## Phase 6 – Issue aktualisieren

Sobald der User bestätigt hat:

```bash
gh issue edit $ARGUMENTS \
  --title "<neuer Titel falls geändert>" \
  --body "<ausformulierter Body>" \
  --add-label "<label1>,<label2>"
```

Gib am Ende den direkten Link zum Issue aus: `gh issue view $ARGUMENTS --json url -q .url`

---

## Grundsätze

- **Keine Halluzinationen**: Schreibe im technischen Kontext nur Dateien auf, die der Explore-Agent tatsächlich gefunden hat.
- **Kein Scope-Creep**: Das Issue beschreibt nur was im Titel steht – keine Bonus-Features.
- **Kompakt**: Jede Sektion so lang wie nötig, so kurz wie möglich.
- **Nie committen oder pushen** – nur das GitHub Issue wird geändert.
