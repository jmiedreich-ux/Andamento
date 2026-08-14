# Andamento Session Handoff

Updated 2026-08-14 for an explicit owner-requested GitHub takeover checkpoint.

## Established

- The approved product, authority model, Milestone 1 scope, and design authority remain unchanged. `AGENTS.md`, `docs/features/planning-loop/feature.md`, and `docs/design/approved/planning-loop/milestone-1.md` are authoritative.
- The active branch is `feature/planning-loop-m1`, based on local commit `5ac35d0` (`Harden planning loop authority boundaries`).
- The current worktree contains a substantial uncommitted remediation delta across the browser application, Codex adapter, planning service, SQLite boundary, migration 004, and unit/integration/Playwright tests.
- Backend remediation now includes four ordered migrations, sixteen executable persisted-state invariants, collision-safe imported participant identity, stronger planning-point and package lineage immutability, loopback request hardening, Codex cancellation/quarantine lifecycle handling, and package boundary validation.
- On the exact takeover worktree, `npm test` passed **53/53** on 2026-08-14. Syntax checks for the changed JavaScript modules, JSON parsing, `git diff --check`, and a credential-pattern scan also passed.
- The exact takeover worktree is **not UI-gate clean**. `npm run test:e2e` stopped with **1 passed, 1 failed, 6 did not run**. `empty-validation-refusal` expected the first-run heading after bootstrap retry but received the existing-project registration surface with a retained `Failed to fetch` alert.
- The latest browser edit is intentionally incomplete. `app/public/app.mjs` contains new bootstrap/detail request sequencing and the beginnings of route-scoped pending-draft recovery (`pendingDraftRecoveries` and `consumePendingDraftRecoveries`), but the recovery records are not yet wired into mutation call sites or route restoration.
- The most recent prior Impeccable PASS and screenshots predate the current UI delta and therefore do not approve this checkpoint. The Impeccable detector already ran exactly once and must **not** be rerun; use a bounded critique/finish review after the UI is frozen.
- The local Andamento service is not running on port `47831`. The external Codex App Server bridge was still listening on `127.0.0.1:47823` at handoff inspection.
- The owner explicitly superseded the earlier no-push exception and requested this GitHub handoff so another agent can continue.

## Known Incomplete Work

1. Finish or deliberately replace the pending-input recovery model. At minimum, message, capture, replacement, package-save, and room-creation payloads must survive leave/return after an unconfirmed request without crossing project or discussion boundaries, and retries must reuse the exact request-bound idempotency key.
2. Correct the failing bootstrap retry browser path and add overlapping/stale bootstrap response coverage. A stale bootstrap failure must not replace a newer healthy route.
3. Complete the stale explicit-refresh error regression: an older failed detail request must not display an alert after navigation or after a newer successful read.
4. Reconcile package saves whose response is lost but whose exact content is already durable; do not create a false concurrent-edit conflict.
5. Decide and document recovery across a full page reload or process interruption. The new in-memory recovery draft is insufficient for that path; it needs a durable service record or an explicitly approved browser-storage policy. This remains **UNTESTED**, not accepted as deferred scope.
6. Rerun the complete Playwright suite after the UI behavior is frozen, then obtain an exact-delta Impeccable finish review and fresh independent implementation/security review.

## Assumed

- The product remains local-first and single-owner for Milestone 1 while preserving participant/provider/source attribution.
- Live Anthropic integration remains unavailable without credentials; imported attributed contributions and deterministic adapters remain the supported Milestone 1 paths.

## Deliberately Deferred

- Repository execution, autonomous multi-agent rounds, remote sync, organization roles, CI/branch protection, and mobile product support remain outside Milestone 1.
- CI is **NOT CONFIGURED**. Local validation remains authoritative.

## Current Control State

- Work package `AND-N1-PLANNING-LOOP-v1` remains the only authorized implementation scope.
- Status is **TAKEOVER_REQUIRED / WORK IN PROGRESS**, not `READY_FOR_INDEPENDENT_REVIEW` or `READY_FOR_OWNER_ACCEPTANCE`.
- The published branch and draft pull request are a recovery checkpoint. They must not be merged until the complete local gates and fresh exact-head review pass.
- No agent currently owns the shared files. The next coordinating agent must claim the assignment in `tracker/assignments.json` before editing.

## Exact Next Action

Claim `feature/planning-loop-m1`, inspect the failing Playwright trace and the incomplete pending-draft recovery code in `app/public/app.mjs`, then finish one route-scoped recovery model and make `empty-validation-refusal` plus the focused refresh/navigation/concurrency specifications pass before rerunning the full gate.
