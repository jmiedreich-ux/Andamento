# Andamento

Andamento is a local-first development operations system in which a human owner plans, decides, approves, reviews, and finally accepts work performed with AI agents.

Start with [PRODUCT_DESIGN.md](PRODUCT_DESIGN.md) for the project-neutral product direction, multi-agent discussion model, smallest useful vertical slice, and phased build sequence.

Development work follows [AGENTS.md](AGENTS.md), adapted from the proven VennuSign feature-and-milestone process. Current authority and next action are recorded in [PROJECT_STATUS.md](PROJECT_STATUS.md).

## Run Locally

Andamento requires Node.js 24 or newer. From the repository root:

```text
npm install
npm start
```

Open `http://127.0.0.1:47831`. The local service creates `var/andamento.db`, applies ordered migrations, enables SQLite WAL mode, and keeps the browser away from database and provider credentials.

Rerun the implementation and browser gates with:

```text
npm test
npm run test:coverage
npm run test:e2e
```

The Playwright suite starts an isolated real service and on-disk SQLite database. Its deterministic participant replaces external model cost and availability only; it does not mock the UI, application service, or persistence boundary.

## Current Materials

- `PRODUCT_DESIGN.md` — current product direction and initial build scope
- `PRODUCT.md` — durable product context for design and implementation
- `DESIGN.md` — implemented Andamento visual system and component rules
- `AGENTS.md` — authoritative development and delivery process
- `PROJECT_STATUS.md` — current control state and exact next action
- `ai/handoffs/current.md` — durable session handoff
- `tracker/assignments.json` — active ownership and conflict control
- `docs/features/planning-loop/feature.md` — Milestone 1 scope, paths, evidence, and owner walkthrough
- `docs/design/approved/planning-loop/milestone-1.md` — approved Planning Loop UI authority
- `.agents/skills/impeccable/` — project-local UI design, critique, audit, and bounded-verification skill
- `docs/archive/vennusign-workbench-design.md` — non-authoritative historical record of the earlier VennuSign visual system
- `SHEET_RELAY_DESIGN.md` — earlier Google Sheets-to-Codex relay architecture
- `SHEET_UPDATE_STANDARD.md` — proven planning, attribution, conflict, and approval rules
- `apps-script/` — historical Google Sheets behavior and integration prototype
- `relay/` — local relay, Codex bridge, and historical interface prototypes

The earlier materials are retained for behavioral rules, accessibility lessons, and integration evidence. They are not visual design inputs for Andamento. In the current direction, a local SQLite database becomes the system of record and Google Sheets becomes an optional future adapter.
