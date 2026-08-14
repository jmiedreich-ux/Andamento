# Andamento Project Status

## Current State

- **Product name:** **Andamento**, explicitly approved by the owner on 2026-08-14. The name comes from the visual flow and direction created by arranging individual pieces in a mosaic.
- **Product direction:** Initial project-neutral design is captured in `PRODUCT_DESIGN.md`.
- **Design status:** Planning Loop Milestone 1 is approved for implementation under `docs/design/approved/planning-loop/milestone-1.md` through the owner's active Night 1 goal.
- **Visual direction:** The approved first surface uses an independent light architectural tracing-table world centered on a visible lineage spine. VennuSign, Google Sheets, and earlier workbench visuals remain historical anti-references.
- **System of record direction:** Local SQLite in WAL mode, accessed through a local application service.
- **Existing prototype:** Google Sheets, Apps Script, and the Codex relay remain behavioral and integration evidence only. They are neither the intended authoritative backend nor visual design inputs for the new product.
- **Repository state:** Initialized on `main` with private GitHub remote `https://github.com/jmiedreich-ux/Andamento`. The one-time repository bootstrap is administrative setup and does not authorize feature implementation.
- **Implementation state:** Planning Loop Milestone 1 (`AND-N1-PLANNING-LOOP-v1`) is complete locally on `feature/planning-loop-m1` and ready for independent exact-head review. It stops at an immutable package marked `READY_FOR_EXECUTION`; package execution is out of scope.
- **Verification state:** Implementation verification passed 14/14. Playwright passed 8/8 against the real UI, service, and on-disk SQLite boundary. The bounded Impeccable finish review returned PASS with no unresolved P0/P1 findings. Independent review and owner acceptance remain separate gates.
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

Commit the bounded local milestone, obtain independent review of that exact head, resolve any material finding, and then synchronize the controlled records to `READY_FOR_OWNER_ACCEPTANCE` without pushing to GitHub.
