# Andamento Project Status

## Current State

- **Product name:** **Andamento**, explicitly approved by the owner on 2026-08-14. The name comes from the visual flow and direction created by arranging individual pieces in a mosaic.
- **Product direction:** Initial project-neutral design is captured in `PRODUCT_DESIGN.md`.
- **Design status:** Proposed. The owner has asked to begin design and adopt the VennuSign development process only; no feature design bundle has yet been explicitly approved for implementation.
- **Visual direction:** Andamento must be unmistakably distinct from VennuSign, Google Sheets, and earlier workbench prototypes. Its exact visual system remains open until an Andamento-specific design authority is explicitly approved.
- **System of record direction:** Local SQLite in WAL mode, accessed through a local application service.
- **Existing prototype:** Google Sheets, Apps Script, and the Codex relay remain behavioral and integration evidence only. They are neither the intended authoritative backend nor visual design inputs for the new product.
- **Repository state:** Initialized on `main` with private GitHub remote `https://github.com/jmiedreich-ux/Andamento`. The one-time repository bootstrap is administrative setup and does not authorize feature implementation.
- **Implementation state:** No implementation feature or milestone is approved, claimed, or in progress.
- **UI QA direction:** UI-bearing milestones require the project-local Impeccable workflow and complete Playwright end-to-end coverage. Implementation verification, UI QA, independent review, and owner acceptance are separate gates. The Playwright harness is not yet configured because no UI stack or implementation milestone is approved.
- **CI state:** Not configured.

## Working Model

The project uses features delivered through small, owner-accepted vertical milestones. Design authority, open questions, implementation scope, Impeccable and Playwright QA, independent review, evidence, and final acceptance are separate controlled stages. `AGENTS.md` is the authoritative development policy.

## Proposed First Feature

The proposed first feature is the **Multi-agent planning loop**:

```text
discussion
  -> individual planning points
  -> owner disposition
  -> versioned work package
  -> explicit approval
```

Execution, UI QA, independent review, evidence, and final acceptance should follow as the next vertical capability only when the first milestone boundaries are approved. The feature name and milestone plan remain proposed until the owner accepts them.

## Exact Next Action

Create the proposed first feature's design authority, milestone plan, acceptance criteria, blocking open-question register, and UI QA plan for owner review. The design authority must propose an Andamento-specific visual direction and demonstrate its distinction from the historical interfaces; the QA plan must map the complete user workflow to Impeccable review and Playwright end-to-end coverage. Do not begin application implementation before that review is resolved and approved.
