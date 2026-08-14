# Andamento Session Handoff

Updated 2026-08-14 after finishing the browser recovery work that blocked the takeover checkpoint.

## Established

- The approved product, authority model, Milestone 1 scope, and design authority remain unchanged. `AGENTS.md`, `docs/features/planning-loop/feature.md`, and `docs/design/approved/planning-loop/milestone-1.md` are authoritative.
- The active branch is `feature/planning-loop-m1`, published as draft PR [#1](https://github.com/jmiedreich-ux/Andamento/pull/1).
- Every item listed as incomplete in the takeover handoff is now implemented and covered by executed tests.
- Unconfirmed input recovery is route-scoped and in-memory. A mutation that ends in `REQUEST_UNCONFIRMED` holds one recovery record per operation slot, stamped with its project and planning-room identity, and never crosses a project or room boundary. The record is re-snapshotted from live draft state on every route exit, so edits made after the failure are carried and repeated leave-and-return cycles keep working. Resubmission of unchanged content reuses the original request-bound idempotency key, so a lost receipt cannot create a duplicate durable record.
- Before restoring, the browser reconciles each held entry against freshly loaded durable state. An entry that already committed is retired and reported as already saved rather than offered back as unsent — which matters because an *edited* resubmission mints a new key and would create a second durable record. A replacement whose point has since been decided, or a capture whose source contribution is gone, is refused explicitly instead of restored into an action the authority model forbids.
- Every recovery outcome is reported as a visible status near the affected station as well as a polite announcement, and the wording distinguishes restored, rebased, held, already-saved, and refused.
- The outbound provider bridge URL is now validated as loopback `ws:`/`wss:` at startup, mirroring the inbound binding rule, and an invalid port fails startup instead of silently falling back.
- A package save whose response is lost but whose exact content is already durable reconciles to saved instead of raising a false concurrent-edit conflict, both while the owner stays in the room and on return to it.
- A superseded bootstrap or room read can neither replace a newer healthy route nor strand the loading surface, and a resolved error is retracted from the live regions instead of being left announced.
- Local gates on the current worktree: `npm test` **53/53**; `npm run test:coverage` **90.33% lines, 77.67% branches, 88.30% functions**; `npm run test:e2e` **10/10**; `npm audit --audit-level=high` **0 vulnerabilities**; `node --check` on the changed modules, `git diff --check`, and a credential-pattern scan of the diff all clean; the running service reports **16/16** invariants passing.
- Coverage describes **server code only**. There is no row for `app/public/app.mjs`; the browser delta has zero `node --test` coverage by construction and is proved by Playwright alone. Do not read 90.33% as delta coverage.
- Four browser regressions were proved by inversion — recovery arming, lost-receipt package reconciliation, durable-entry reconciliation, and route-exit re-snapshotting — plus the provider-bridge guard via the integration suite. Each fix was restored and re-run to a pass; `grep -c "false &&" app/public/app.mjs` returns 0.
- Five further defects were found by the new specifications and fixed: the bootstrap-retry surface, a resolved error left announced in the assertive live region after navigation, a stale `Package edits unsaved` header after reconciliation, an unheard refusal destroyed by retraction during a redirect, and a replacement restored onto a decided planning point.
- This delta changed no markup, stylesheet, or asset. The approved visual direction and the existing Impeccable screenshots still describe the surface.

## Review Round One

Three agent reviewers examined commit `42cdc5f`; none authored it.

- Impeccable finish review: **FAIL**, 8 material findings.
- Independent implementation review: **REQUEST_CHANGES**, 4 material findings. It re-executed `npm test` and `npm run test:coverage` and confirmed both claims exactly.
- Independent security review: **LOW residual risk**, no CRITICAL or HIGH, one MEDIUM fixed and one MEDIUM accepted as Milestone 1 scope.

Two findings were raised independently by two reviewers, which is why they were treated as the priority: committed-but-unreceipted entries were never retired for four of five slot types, and the restore announcement told the owner to resubmit work that was already durable.

All material findings are now fixed or explicitly recorded as accepted risk or backlog in `docs/features/planning-loop/feature.md`. Four fixes were proved by inversion, plus the provider-bridge guard.

## Known Incomplete Work

1. The three reviews above cover `42cdc5f`, which is superseded by the fixes answering them. `AGENTS.md` holds that new commits invalidate a prior approval, so a **fresh independent review of the current head** is required before merge.
2. The Impeccable detector already ran exactly once and must **not** be rerun; use a bounded critique or finish review. The delta still changes no markup, stylesheet, or asset.
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

Run a fresh independent review against the current head of `feature/planning-loop-m1` — the round-one reviews cover superseded commit `42cdc5f` — recording the reviewer, reviewed commit, validation status, decision, and residual risks on PR #1.
