# Andamento Project Status

## Current State

- **Product name:** **Andamento**, explicitly approved by the owner on 2026-08-14. The name comes from the visual flow and direction created by arranging individual pieces in a mosaic.
- **Product direction:** Initial project-neutral design is captured in `PRODUCT_DESIGN.md`.
- **Design status:** Proposed. The owner has asked to begin design and adopt the VennuSign development process; no feature design bundle has yet been explicitly approved for implementation.
- **System of record direction:** Local SQLite in WAL mode, accessed through a local application service.
- **Existing prototype:** Google Sheets, Apps Script, and the Codex relay remain design history and reusable integration evidence. They are not the intended authoritative backend for the new product.
- **Repository state:** Initialized on `main` with private GitHub remote `https://github.com/jmiedreich-ux/Andamento`. The one-time repository bootstrap is administrative setup and does not authorize feature implementation.
- **Implementation state:** No implementation feature or milestone is approved, claimed, or in progress.
- **CI state:** Not configured.

## Working Model

The project uses features delivered through small, owner-accepted vertical milestones. Design authority, open questions, implementation scope, review, evidence, and final acceptance are separate controlled stages. `AGENTS.md` is the authoritative development policy.

## Proposed First Feature

The proposed first feature is the **Multi-agent planning loop**:

```text
discussion
  -> individual planning points
  -> owner disposition
  -> versioned work package
  -> explicit approval
```

Execution, independent review, evidence, and final acceptance should follow as the next vertical capability only when the first milestone boundaries are approved. The feature name and milestone plan remain proposed until the owner accepts them.

## Exact Next Action

Create the proposed first feature's design authority, milestone plan, acceptance criteria, and blocking open-question register for owner review. Do not begin application implementation before that review is resolved and approved.
