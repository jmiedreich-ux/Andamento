# Andamento Session Handoff

Updated 2026-08-14 after finishing the browser recovery work that blocked the takeover checkpoint.

## Established

- The approved product, authority model, Milestone 1 scope, and design authority remain unchanged. `AGENTS.md`, `docs/features/planning-loop/feature.md`, and `docs/design/approved/planning-loop/milestone-1.md` are authoritative.
- The active branch is `feature/planning-loop-m1`, published as draft PR [#1](https://github.com/jmiedreich-ux/Andamento/pull/1).
- Every item listed as incomplete in the takeover handoff is now implemented and covered by executed tests.
- Unconfirmed input recovery is route-scoped and in-memory. A mutation that ends in `REQUEST_UNCONFIRMED` holds one recovery record per operation slot, stamped with its project and planning-room identity. The record is restored only on re-entering that exact route, is dropped when the operation succeeds or the owner clears the input, and never crosses a project or room boundary. Resubmission reuses the original request-bound idempotency key, so a lost receipt cannot create a duplicate durable record.
- A package save whose response is lost but whose exact content is already durable reconciles to saved instead of raising a false concurrent-edit conflict, both while the owner stays in the room and on return to it.
- A superseded bootstrap or room read can neither replace a newer healthy route nor strand the loading surface, and a resolved error is retracted from the live regions instead of being left announced.
- Local gates on the current worktree: `npm test` **53/53**; `npm run test:coverage` **90.23% lines, 77.17% branches, 88.17% functions**; `npm run test:e2e` **10/10**; `npm audit --audit-level=high` **0 vulnerabilities**; `node --check` on the changed modules, `git diff --check`, and a credential-pattern scan of the diff all clean; the running service reports **16/16** invariants passing.
- Both new browser regressions were proved by inversion. Disabling recovery arming failed the restored-composer assertion; disabling the lost-receipt reconciliation failed on the false conflict; restoring each returned the specification to passing.
- Three further defects were found by the new specifications and fixed: the bootstrap-retry surface, a resolved error left announced in the assertive live region after navigation, and a stale `Package edits unsaved` header after reconciliation.
- This delta changed no markup, stylesheet, or asset. The approved visual direction and the existing Impeccable screenshots still describe the surface.

## Known Incomplete Work

1. A bounded Impeccable finish review of the changed behavior has not been run. The detector already ran exactly once and must **not** be rerun; use a bounded critique or finish review.
2. Independent implementation and security review of the exact head has not been performed. The author of this delta cannot satisfy that gate.
3. Owner acceptance has not been recorded.

## Assumed

- The product remains local-first and single-owner for Milestone 1 while preserving participant/provider/source attribution.
- Live Anthropic integration remains unavailable without credentials; imported attributed contributions and deterministic adapters remain the supported Milestone 1 paths.

## Deliberately Deferred

- Repository execution, autonomous multi-agent rounds, remote sync, organization roles, CI/branch protection, and mobile product support remain outside Milestone 1.
- CI is **NOT CONFIGURED**. Local validation remains authoritative.

## Awaiting Owner Decision

- Whether unsent planning input should survive a full page reload or a browser process interruption. The current boundary is deliberate, documented, and executed: durable records reload from SQLite and unsent input does not persist. Extending it needs a durable service-side draft record or an explicitly approved browser-storage policy. This is recorded in `docs/features/planning-loop/open-questions.md`; it is not silently deferred.

## Current Control State

- Work package `AND-N1-PLANNING-LOOP-v1` remains the only authorized implementation scope.
- Status is **READY_FOR_INDEPENDENT_REVIEW**. It is not `READY_FOR_OWNER_ACCEPTANCE`, and the branch must not merge until the Impeccable finish review and the independent exact-head review pass.
- The coordinating agent owns the shared files. A reviewer should not edit them; findings return to the coordinating agent.

## Exact Next Action

Run a bounded Impeccable finish review plus an independent implementation and security review against the exact head of `feature/planning-loop-m1`, recording the reviewer, reviewed commit, validation status, decision, and residual risks on PR #1.
