# Andamento Session Handoff

Updated 2026-08-14 at the Planning Loop Milestone 1 implementation and UI-QA checkpoint.

## Established

- The owner explicitly approved **Andamento** as the product name on 2026-08-14. The name refers to the visual flow and direction created by arranging individual pieces in a mosaic.
- The product is a project-neutral, local-first development operations system rather than a VennuSign-specific Google Sheets relay.
- The human owner performs planning, PSA direction, explicit work approval, review, and final acceptance.
- AI agents may discuss, recommend, challenge, implement approved work, and review, but may not grant themselves authority.
- Multi-provider discussion must support OpenAI, Anthropic, Codex, and future adapters without making a provider response format part of the domain model.
- Discussion produces individually traceable proposed planning points. Owner-accepted points can become inputs to a versioned work package.
- SQLite in WAL mode is the intended system of record; the UI and agents access it only through the local application service.
- The VennuSign feature/milestone process has been adapted into `AGENTS.md` as the governing development policy.
- The workspace is initialized on `main` and connected to the private GitHub repository `https://github.com/jmiedreich-ux/Andamento`.
- Repository bootstrap is administrative setup only; no feature design, milestone, or application implementation was approved by creating it.
- The owner requires Andamento to be visually distinct from VennuSign, Google Sheets, and earlier workbench prototypes. Prior UI work is behavioral, accessibility, and integration evidence only; visual reuse requires explicit owner approval in an Andamento-specific design authority.
- Routine brainstorming and local documentation work do not need continuous GitHub interaction. GitHub is used when the owner explicitly requests it or at an agreed publication or review checkpoint.
- UI-bearing milestones require complete Playwright end-to-end coverage written with the implementation and bounded Impeccable critique and audit against the approved design authority.
- A UI milestone has four separate gates: implementation verification, Impeccable and Playwright UI QA, independent implementation review, and owner acceptance. Independent review does not replace or satisfy QA.
- Impeccable 4.0.4 is available project-locally at `.agents/skills/impeccable/`; `PRODUCT.md`, the approved feature authority, the implemented `DESIGN.md`, critique evidence, and the approved north-star comp govern the first surface.
- The owner's active `/goal` objective explicitly authorizes the bounded Night 1 Planning Loop implementation without a GitHub issue, pull request, or push.
- `PRODUCT.md` now records durable product truth and the owner-delegated Night 1 stack.
- Planning Loop Milestone 1 is controlled by `docs/features/planning-loop/feature.md`, `docs/features/planning-loop/open-questions.md`, and the approved design authority at `docs/design/approved/planning-loop/milestone-1.md`.
- The approved north-star comp is `.impeccable/mocks/planning-room-lineage-spine.png`; it uses an architectural tracing-table world with discussion, lineage, owner decisions, and package approval visible together.
- The dependency-light Night 1 application uses Node.js 24 ESM, the Node HTTP server, built-in `node:sqlite`, standards-based HTML/CSS/JavaScript, and Playwright. It binds to `127.0.0.1:47831` and stores production state in ignored `var/andamento.db`.
- Ordered migrations establish SQLite WAL mode, foreign keys, a busy timeout, relationship indexes, append-only approval/audit/receipt records, approved-version immutability, optimistic concurrency, provider-neutral attribution, project isolation, and one retry child per failed run.
- Implementation verification passes 14/14 and all nine persisted-state invariants. Playwright passes 8/8 against the real UI, service, browser, and on-disk SQLite, including restart, concurrency, idempotency, authority, 320-pixel zoom-equivalent reflow, and delayed-save navigation safety.
- The bounded Impeccable finish review returned PASS with no unresolved P0/P1 findings. The one detector warning is a contextual false positive on a functional capability-status strip; the detector ran exactly once.
- A live Codex adapter smoke completed through the local App Server with preserved OpenAI/Codex attribution. Imported Claude contributions and deterministic participant paths are also tested.

## Assumed

- The initial product is local-first and primarily single-owner, while its domain model preserves participant attribution.
- The existing Codex App Server client is eligible for bounded protocol reuse behind a provider-neutral adapter. Relay service code, Google integration, state files, and UI are not implementation bases.

## Deliberately Deferred

- Live Anthropic integration until credentials and model choice are supplied; imported attributed contributions and deterministic test participants cover the Night 1 workflow.
- CI and branch protection.
- Final logo, tagline, domain selection, external font or brand assets, and trademark clearance beyond the approved name and implemented first-surface visual system.
- GitHub, Google Sheets, and multi-machine synchronization.
- Organization-wide roles and permissions.
- Unbounded autonomous agent-to-agent conversations.

## Current Control State

- Planning Loop Milestone 1 is approved, claimed by `root`, and ready for independent exact-head review on `feature/planning-loop-m1`.
- `AND-N1-PLANNING-LOOP-v1` is the only authorized implementation package.
- Controlled files and shared contracts remain owned by the coordinating agent; specialist agents are read-only unless assigned a non-overlapping file set.
- GitHub publication is explicitly excluded tonight.

## Exact Next Action

Create the bounded local milestone commit and obtain an independent exact-head implementation review. If approved, synchronize the controlled records and leave the running build `READY_FOR_OWNER_ACCEPTANCE` for the owner workbook.
