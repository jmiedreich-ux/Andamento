# Documentation Guide

Use documentation by purpose. Do not load the complete Markdown collection at routine startup.

## Routine Startup

Read only the controlled records listed in `AGENTS.md`: current policy, handoff, tracker, status, active feature records, and linked GitHub state.

## Current Product Direction

- `PRODUCT_DESIGN.md` — proposed product direction and smallest useful product
- `PRODUCT.md` — durable product context and constraints
- `DESIGN.md` — implemented Andamento visual language and component rules

## Historical Evidence

- `docs/archive/vennusign-workbench-design.md` — historical VennuSign visual system; explicitly non-authoritative for Andamento
- `SHEET_RELAY_DESIGN.md` — earlier relay architecture and design history
- `SHEET_UPDATE_STANDARD.md` — proven authority, attribution, conflict, and idempotency rules

Historical UI materials may supply behavioral rules, state semantics, accessibility lessons, and integration evidence. They do not supply Andamento's palette, typography, assets, layout, component language, interaction composition, or branding.

## Feature Records

Use `docs/features/<feature>/` only for an active or owner-approved feature. The current feature record is:

- `docs/features/planning-loop/feature.md` — Milestone 1 scope, invariant, evidence, and owner acceptance record
- `docs/features/planning-loop/open-questions.md` — deliberately deferred decisions

## Design Authority

- Proposed design belongs under `docs/design/proposed/<feature>/`.
- Owner-approved design belongs under `docs/design/approved/<feature>/`; Planning Loop Milestone 1 is governed by `docs/design/approved/planning-loop/milestone-1.md`.
- Repository presence is not approval. The approved decisions record wins when design artifacts conflict.

## Creation and Updates

Update an existing living document before creating another Markdown file. New feature, architecture, decision, or operations records require a durable purpose that no current document serves. Store superseded history under `docs/archive/` and read it only for deliberate research.
