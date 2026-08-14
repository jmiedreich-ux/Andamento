# Andamento Project Status

## Current State

- **Product name:** **Andamento**, explicitly approved by the owner on 2026-08-14. The name comes from the visual flow and direction created by arranging individual pieces in a mosaic.
- **Product direction:** Initial project-neutral design is captured in `PRODUCT_DESIGN.md`.
- **Design status:** Planning Loop Milestone 1 is approved for implementation under `docs/design/approved/planning-loop/milestone-1.md` through the owner's active Night 1 goal.
- **Visual direction:** The approved first surface uses an independent light architectural tracing-table world centered on a visible lineage spine. VennuSign, Google Sheets, and earlier workbench visuals remain historical anti-references.
- **System of record direction:** Local SQLite in WAL mode, accessed through a local application service.
- **Existing prototype:** Google Sheets, Apps Script, and the Codex relay remain behavioral and integration evidence only. They are neither the intended authoritative backend nor visual design inputs for the new product.
- **Repository state:** Private GitHub repository `https://github.com/jmiedreich-ux/Andamento`; work continues on `feature/planning-loop-m1`, published as draft PR [#1](https://github.com/jmiedreich-ux/Andamento/pull/1).
- **Implementation state:** Planning Loop Milestone 1 (`AND-N1-PLANNING-LOOP-v1`) is implementation-complete on `feature/planning-loop-m1`. The backend authority remediation and the browser recovery work that blocked the takeover checkpoint are both finished.
- **Verification state:** Implementation verification passes 53/53, coverage reports 90.23% lines and 88.17% functions, Playwright passes 10/10 including two new recovery specifications, `npm audit --audit-level=high` reports 0 vulnerabilities, and the running service reports all 16 invariants passing. The visual surface is unchanged by this delta, so the earlier Impeccable evidence still describes it, but a bounded finish review of the changed behavior by a non-author has not been run. Independent exact-head review and owner acceptance remain pending.
- **CI state:** Not configured.

## Working Model

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

Obtain a bounded Impeccable finish review and an independent implementation and security review of the exact head of `feature/planning-loop-m1` from a reviewer who did not author it, then answer the reload-durability question in `docs/features/planning-loop/open-questions.md` before the owner acceptance walkthrough.
