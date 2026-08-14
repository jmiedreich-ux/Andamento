# Andamento

Andamento is a local-first development operations system in which a human owner plans, decides, approves, reviews, and finally accepts work performed with AI agents.

Start with [PRODUCT_DESIGN.md](PRODUCT_DESIGN.md) for the project-neutral product direction, multi-agent discussion model, smallest useful vertical slice, and phased build sequence.

Development work follows [AGENTS.md](AGENTS.md), adapted from the proven VennuSign feature-and-milestone process. Current authority and next action are recorded in [PROJECT_STATUS.md](PROJECT_STATUS.md).

## Current Materials

- `PRODUCT_DESIGN.md` — current product direction and initial build scope
- `AGENTS.md` — authoritative development and delivery process
- `PROJECT_STATUS.md` — current control state and exact next action
- `ai/handoffs/current.md` — durable session handoff
- `tracker/assignments.json` — active ownership and conflict control
- `DESIGN.md` — visual language developed for the VennuSign Workbench prototype
- `SHEET_RELAY_DESIGN.md` — earlier Google Sheets-to-Codex relay architecture
- `SHEET_UPDATE_STANDARD.md` — proven planning, attribution, conflict, and approval rules
- `apps-script/` — Google Sheets sidebar and web-app prototype
- `relay/` — local relay, Codex bridge, and interface prototypes

The Sheets documents are retained as design history and integration evidence. In the current direction, a local SQLite database becomes the system of record and Google Sheets becomes an optional future adapter.
