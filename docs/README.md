# Documentation Guide

Use documentation by purpose. Do not load the complete Markdown collection at routine startup.

## Routine Startup

Read only the controlled records listed in `AGENTS.md`: current policy, handoff, tracker, status, active feature records, and linked GitHub state.

## Current Product Direction

- `PRODUCT_DESIGN.md` — proposed product direction and smallest useful product

## Historical Evidence

- `docs/archive/vennusign-workbench-design.md` — historical VennuSign visual system; explicitly non-authoritative for Andamento
- `SHEET_RELAY_DESIGN.md` — earlier relay architecture and design history
- `SHEET_UPDATE_STANDARD.md` — proven authority, attribution, conflict, and idempotency rules

Historical UI materials may supply behavioral rules, state semantics, accessibility lessons, and integration evidence. They do not supply Andamento's palette, typography, assets, layout, component language, interaction composition, or branding.

## Feature Records

Use `docs/features/<feature>/` only for an active or owner-approved feature. A feature normally contains:

- `milestone-plan.md`
- `open-questions.md`
- `acceptance-criteria.md`
- milestone acceptance workbooks and records

## Design Authority

- Proposed design belongs under `docs/design/proposed/<feature>/`.
- Owner-approved design moves to `docs/design/approved/<feature>/` with a `decisions.md` record.
- Repository presence is not approval. The approved decisions record wins when design artifacts conflict.

## Creation and Updates

Update an existing living document before creating another Markdown file. New feature, architecture, decision, or operations records require a durable purpose that no current document serves. Store superseded history under `docs/archive/` and read it only for deliberate research.
