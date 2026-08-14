# Andamento Session Handoff

Updated 2026-08-14 for repository establishment.

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

## Assumed

- The initial product is local-first and primarily single-owner, while its domain model preserves participant attribution.
- The existing Codex relay can be evaluated for reuse after the planning and approval boundaries are designed.

## Deliberately Deferred

- Technology stack selection for the new application shell and local service.
- CI and branch protection.
- Visual identity, logo, tagline, domain selection, and trademark clearance beyond the approved product name.
- GitHub, Google Sheets, and multi-machine synchronization.
- Organization-wide roles and permissions.
- Unbounded autonomous agent-to-agent conversations.

## Current Control State

- No feature design is approved for implementation.
- No milestone is claimed.
- No application implementation is authorized.
- `PRODUCT_DESIGN.md` is the current proposed direction.

## Exact Next Action

Draft the first feature's proposed design authority, milestone plan, acceptance criteria, and blocking open questions. Present them for owner resolution and explicit design approval before implementation.
