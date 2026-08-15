# Andamento Project Status

## Current State

- **Product name:** **Andamento**, explicitly approved by the owner on 2026-08-14. The name comes from the visual flow and direction created by arranging individual pieces in a mosaic.
- **Product direction:** Initial project-neutral design is captured in `PRODUCT_DESIGN.md`.
- **Design status:** Planning Loop Milestone 1 is approved for implementation under `docs/design/approved/planning-loop/milestone-1.md` through the owner's active Night 1 goal.
- **Visual direction:** The approved first surface uses an independent light architectural tracing-table world centered on a visible lineage spine. VennuSign, Google Sheets, and earlier workbench visuals remain historical anti-references.
- **System of record direction:** Local SQLite in WAL mode, accessed through a local application service.
- **Existing prototype:** Google Sheets, Apps Script, and the Codex relay remain behavioral and integration evidence only. They are neither the intended authoritative backend nor visual design inputs for the new product.
- **Repository state:** Private GitHub repository `https://github.com/jmiedreich-ux/Andamento`. `main` is the only branch; `feature/planning-loop-m1` was fast-forwarded onto it with history intact and deleted, and draft PR [#1](https://github.com/jmiedreich-ux/Andamento/pull/1) closed as merged.
- **Implementation state:** The planning loop runs end to end on `main`: project registration, planning rooms, owner/Claude/Codex/imported contributions, source-linked points, owner disposition, versioned packages, explicit approval, dispatch to a proposed change set, apply with revert, and a cross-project home view of outstanding work.
- **Verification state:** `npm test` 78/78, `npm run test:e2e` 10/10, `npm audit --audit-level=high` 0 vulnerabilities, 23 runtime invariants passing, seven ordered migrations. Execution and live Claude were both exercised against real providers, not only fixtures.
- **Review state:** No independent review covers the execution, apply/revert, Claude, or home-view work. The earlier review round covered a superseded commit.
- **CI state:** Not configured. Local validation is the gate.

## Working Model

Coding first, minimal process. Work happens on `main`; commit at a completed slice rather than after every edit. Tests ship with behaviour, and anything user-facing is run in the real app before it counts as done.

## Backlog

Nothing is authorized until the owner picks it.

- Open a GitHub pull request straight from an approved package
- Record evidence (test output, review verdict) against the exact approved version
- Agent proposes candidate planning points from a contribution; the owner accepts or rejects
- Export a package as Markdown or JSON
- Folder picker for repository roots instead of a typed path
- Ask two agents the same question and compare answers side by side
- Search across rooms and points
- Package decomposition: one package spawns child packages
- Recorded from review, not yet authorized: errors are announced twice (assertive live region plus the `role="alert"` banner); static-file containment is lexical rather than `realpath`-based; provider text is unbounded until the persist-time cap; `mutation_receipts` has no retention policy; the tabbed-station breakpoint is 1279px while the approved design says 1439px



The project uses features delivered through small, owner-accepted vertical milestones. Design authority, open questions, implementation scope, Impeccable and Playwright QA, independent review, evidence, and final acceptance are separate controlled stages. `AGENTS.md` is the authoritative development policy.

## Active First Feature

The active first feature is the **Planning loop**:

```text
discussion
  -> individual planning points
  -> owner disposition
  -> versioned work package
  -> explicit approval
```

Repository execution, implementation evidence, product review, and final product acceptance inside Andamento follow only in later approved milestones. The current build includes its own external implementation tests, UI QA, independent review, and morning owner-acceptance handoff.

## Exact Next Action

Pick the next capability from the backlog above and build it on `main`.
