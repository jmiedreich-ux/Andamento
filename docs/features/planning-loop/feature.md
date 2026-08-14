# Planning Loop

## Control State

- **Feature:** Planning loop
- **Milestone:** 1 — Discussion to approved package
- **Work package:** `AND-N1-PLANNING-LOOP-v1`
- **Owner authorization:** Explicitly approved through the active `/goal` objective on 2026-08-14
- **Execution state:** Browser recovery work is complete on `feature/planning-loop-m1`. Implementation verification and the full Playwright suite pass locally; independent exact-head review and owner acceptance remain open
- **Publication state:** The owner explicitly requested a GitHub branch and draft-PR handoff checkpoint on 2026-08-14. Publication grants no review approval, merge authority, or owner acceptance.

## Whole Behavior

The owner registers a local project, opens a planning discussion, records owner and attributed agent contributions, captures source-linked planning points, decides each point, assembles accepted points into a complete work-package draft, and explicitly approves one immutable version. Before this loop, work exists only as ungoverned conversation. After it, one exact package is marked `READY_FOR_EXECUTION`; nothing executes automatically.

The same authority behavior applies at every planning-point disposition, work-package edit, approval attempt, refresh, retry, and concurrent browser session. The application must preserve source, actor, provider, project, and version boundaries everywhere.

## Milestone 1 Scope

### Included

- Multiple local projects with validated repository roots
- One durable discussion per created planning room
- Owner messages
- One owner-invoked Codex contribution through a provider-neutral adapter when the local bridge is available
- Attributed imported contributions from Claude or another external agent
- A deterministic test-agent adapter for complete local end-to-end validation
- Planning-point capture with type and source lineage
- Owner accept, reject, defer, and edit-as-replacement behavior
- Draft package creation from accepted points
- Outcome, included scope, exclusions, acceptance criteria, review requirements, and evidence requirements
- Optimistic concurrency using expected versions
- Immutable approved package versions and append-only approval events
- Creating a new draft version after approval
- SQLite restart persistence and project isolation
- Desktop web support from 1024 by 768 through 1920 by 1080

### Excluded

- Live Anthropic calls without owner-supplied credentials
- Autonomous agent-to-agent rounds, panel orchestration, synthesis, or automatic point extraction
- Repository mutation or package execution
- Evidence, implementation review, and final product acceptance inside the application
- Milestone and recursive slice hierarchy
- Today, portfolio, search, GitHub automation, remote sync, multi-user authentication, and mobile UI

## Authority Invariants

1. Messages and agent agreement never authorize work.
2. Every captured planning point starts `PROPOSED`.
3. Only the owner may accept, reject, defer, or approve.
4. Planning-point text is never rewritten. Editing a `PROPOSED` point creates a source-linked replacement and preserves the original as `SUPERSEDED`; a decided point is immutable, so a later revision begins as a new proposal captured from its original contribution.
5. Only accepted points populate authoritative package inputs.
6. Approved package snapshots and approval events cannot be updated or deleted.
7. Changes after approval create a new draft version and do not mutate the approved version.
8. Repeated mutation and approval requests are idempotent or explicitly refused without duplicate durable records.
9. Approval marks a package `READY_FOR_EXECUTION` and never dispatches it.
10. Provider adapters cannot call owner-authority operations.
11. Participant, provider, and source attribution remains intact through capture and approval.
12. Project data never crosses project boundaries.

## Path and Validation Map

| Path | Intended behavior | Executed validation |
| --- | --- | --- |
| Happy path | Project → discussion → contributions → points → decisions → draft → approval | Playwright full-loop spec plus service/persistence tests |
| Loading and empty | First run teaches project creation; empty room teaches first contribution; pending agent run is explicit | Playwright empty/loading spec |
| Validation and refusal | Blank names/messages and incomplete packages are refused without losing valid input | Playwright validation spec plus domain tests |
| Conflict and stale actor | A stale expected version is refused with current state for recovery | Two-context Playwright concurrency spec plus persistence test |
| Permission denied | Non-owner actors cannot disposition or approve | Service integration and invariant tests |
| Capability unavailable | Missing Codex bridge or invalid repository is explicit and recoverable; import remains available | Playwright capability spec |
| Cancellation and close | Composer/draft edits can be cancelled; returning shows the last durable state | Playwright navigation spec |
| Retry after failure | Failed deterministic agent run can retry without losing the prompt or duplicating contributions | Playwright failure/retry spec |
| Refresh, leave, return | Durable messages, decisions, and drafts reload from SQLite | Playwright persistence spec |
| Unconfirmed request, leave, return | Unconfirmed message, capture, replacement, package, and room-title input is held against its project and room, restored on return to that exact route, and resubmitted under the original request-bound idempotency key; it does not cross a project or room boundary and does not survive a full reload | Playwright `unconfirmed-input-recovery` spec |
| Lost mutation receipt | A save whose response is lost but whose exact content is already durable reconciles to saved instead of reporting a concurrent-edit conflict, and resubmission creates no duplicate record | Playwright `unconfirmed-input-recovery` spec plus idempotency persistence tests |
| Stale read after navigation | A superseded room read or bootstrap response never replaces a newer healthy route, raises an alert, or leaves a resolved error announced | Playwright `stale-refresh-alert-suppression` and `empty-validation-refusal` specs |
| Repeated submission | Idempotency keys prevent duplicate messages, runs, points, and approvals | Playwright authority spec plus persistence tests |
| Concurrent activity | Parallel agent completions remain separately attributed; stale owner edits cannot overwrite | Two-context Playwright concurrency spec |
| Existing saved data | Restarted service loads existing databases and migrations converge | Persistence restart test and Playwright restart check |
| Supported display | Required actions survive 1024×768 and 1920×1080, long content, keyboard use, and more-than-fit lists | Playwright display/accessibility spec and Impeccable audit |

No path may be reported as passing without the named command output. Anything that cannot be executed remains explicitly **UNTESTED**.

## Acceptance Criteria

1. The owner can complete the whole behavior using only the visible interface.
2. A second unrelated project demonstrates project-neutral storage and isolation.
3. Every contribution and planning point visibly retains actor, provider, and source context.
4. Only accepted points appear in a prepared package.
5. An incomplete package cannot be approved, and entered valid content survives the refusal.
6. Refresh and service restart preserve durable state.
7. Approval produces one append-only owner event and locks the exact version.
8. Double approval is idempotent; attempted approved-version edits are refused.
9. A post-approval change creates version 2 while version 1 remains unchanged.
10. Local implementation tests, all applicable Playwright specifications, bounded Impeccable QA, and independent exact-head review pass before presentation.
11. The milestone stops at `READY_FOR_OWNER_ACCEPTANCE`; only the owner can record final acceptance.

## Evidence Commands

### Evidence currency

The browser recovery work that blocked the takeover checkpoint is complete. On the current worktree, `npm test` passes **53/53** and `npm run test:e2e` passes **10/10**, including two new specifications for unconfirmed-input recovery and stale-read alert suppression. The Impeccable screenshots and detector verdict below remain historical: this delta changed no markup, stylesheet, or asset, so the visual surface is unchanged, but the finish review of the changed behavior has not been performed by a non-author. The Impeccable detector already ran once and must not be rerun.

### Browser recovery model

Unconfirmed input recovery is route-scoped and in-memory. When a mutation ends in `REQUEST_UNCONFIRMED`, the browser holds one recovery record per operation slot, stamped with its project and planning-room identity. The record is restored only on re-entering that exact route, is dropped when the operation succeeds or the owner explicitly clears the input, and never crosses a project or room boundary. Resubmission reuses the original request-bound idempotency key, so a save whose receipt was lost cannot create a duplicate durable record. A package save whose exact content is already durable reconciles to saved instead of raising a concurrent-edit conflict. A superseded bootstrap or room read can neither replace a newer healthy route nor strand the loading surface, and a resolved error is retracted from the live regions rather than left announced. The reload boundary is recorded in `open-questions.md` for an explicit owner decision.

### Implementation verification

```text
npm test
```

Result on 2026-08-14: **53 passed, 0 failed**. The suite exercises the real on-disk SQLite boundary, all four migrations, sixteen persisted-state invariants, restart/WAL behavior, project isolation, attribution and lineage, idempotency, immutable history, authority denial, approval completeness, concurrency, retry/cancellation, Codex cleanup quarantine, provider-error sanitization, and validation. The recovery delta is browser-only and added no service, storage, or migration change, so these results carry forward unchanged.

```text
npm run test:coverage
```

Result on 2026-08-14: **53 passed, 0 failed**, all files **90.23% lines, 77.17% branches, 88.17% functions**. `http-server.mjs` reports the lowest line coverage because its routes are exercised end to end by Playwright rather than by `node --test`.

```text
npm audit --audit-level=high
node --check app/public/app.mjs
node --check app/server/planning-service.mjs
node --check app/server/http-server.mjs
git diff --check
```

Result: **0 vulnerabilities** and every syntax/diff check passed.

The authority regression was also proved by temporary inversion. With the owner check removed, this exact focused command failed with `Missing expected exception`; after restoring the check, the same command passed 1/1:

```text
node.exe --test --test-name-pattern "denies non-owner decisions" app/test/integration/planning-service.test.mjs
```

Both new browser regressions were proved the same way with this focused command:

```text
npx playwright test --grep "unconfirmed-input-recovery"
```

With recovery arming disabled in `withMutation`, it failed at the restored composer value (expected the held owner context, received `""`). With the lost-receipt reconciliation disabled in `syncPackageDraft`, it failed on the false `This package changed in another view while you were editing.` conflict. After restoring both, the specification passes. Three further defects were first observed as real failures before their fixes landed: the bootstrap-retry surface, a resolved error left announced in the assertive live region after navigation, and a stale `Package edits unsaved` header after the reconcile.

### UI QA

```text
npm run test:e2e
```

Result on 2026-08-14: **10 passed, 0 failed** in roughly 1.4 minutes against the real browser, local application service, and on-disk SQLite boundary. Two specifications are new in this delta:

- `stale-refresh-alert-suppression` — a superseded explicit room read must not alert after navigation, and an older read that fails after a newer successful read must neither alert nor roll the view back.
- `unconfirmed-input-recovery` — unconfirmed message, capture, replacement, package, and room-title input is held per route, refused across project and room boundaries, restored on return, resubmitted under the original idempotency key with no duplicate durable record, reconciled without a false conflict when the receipt was lost but the content is already durable, and discarded by a full page reload while durable state returns from SQLite.

The Playwright half of the UI QA gate therefore **passes**. The Impeccable half is **not satisfied for this delta**: this change touched no markup, stylesheet, or asset, so the approved visual direction is unchanged, but a bounded finish review by a non-author has not been run against the changed behavior.

The Impeccable detector ran exactly once:

```text
node.exe .agents/skills/impeccable/scripts/detect.mjs --json app/public
```

It returned one `side-tab` warning for the amber edge on `.capability-note`. Review classified this as a contextual false positive: the element is a functional Codex-unavailable status/refusal strip with explicit text, status semantics, and a retry action, not a decorative card accent. The detector was not rerun. The bounded critique is stored at `.impeccable/critique/2026-08-14T11-04-15Z__app-public-index-html.md`; final evidence screenshots are `.impeccable/screenshots/final-1920.png` and `.impeccable/screenshots/final-1024.png`.

That Impeccable finish review applied to the earlier UI snapshot. The current UI delta requires a new bounded finish review after freeze; the existing detector result may be reused and the detector must not run again.

### Runtime and integration

```text
npm start
curl.exe http://127.0.0.1:47831/api/health
curl.exe http://127.0.0.1:47831/api/invariants
```

Result on 2026-08-14: the service answered `{"status":"ok","service":"andamento","storage":"sqlite"}` and `/api/invariants` reported **16 passed, 0 failed**, covering approval uniqueness and owner authority, package source acceptance, discussion boundaries, approved lineage snapshots, planning-point identity and decision immutability, agent-run contribution counts, Codex cleanup quarantine, and retry parentage.

Historical only: a prior live Codex smoke completed successfully, but the Codex adapter changed afterward. A current exact-checkpoint live smoke is **UNTESTED**.

### Behavior-surface search

```text
rg -l "approvePackage|approval_events|dispositionPoint|replacementPoint|retryAgentRun|retry_of_run_id|work-package-versions|package-save|READY_FOR_EXECUTION" app --glob '!public/assets/**' | sort
```

Complete relevant result set: both ordered migrations; browser application and styles; HTTP route and planning service; Playwright, integration, support, and validation test files. Every result is part of this milestone and was changed or verified. No parallel approval, disposition, retry, or package implementation was left unchanged.

The recovery delta was searched separately:

```text
rg -l "pendingDraftRecoveries|holdDraftRecovery|consumePendingDraftRecoveries|clearAnnouncements|operationKey|clearOperation|REQUEST_UNCONFIRMED|bootstrapRequestSequence" app docs
rg -l "idempotencyKey|idempotency_key" app
```

The first search returns `app/public/app.mjs` only: the recovery seam exists in exactly one place and no parallel implementation was left behind. The second returns migration `001`, the browser application, the planning service, the SQLite boundary, and the Playwright, HTTP-security, migration, service, and support test files. Every server-side result was deliberately left unchanged: the browser rebinds the existing request-bound idempotency contract rather than adding a second mechanism, so recovery required no service, storage, or migration change.

### Explicitly unexecuted or deferred

- Live Anthropic calls are **UNTESTED** because no Anthropic credential is available; attributed import remains tested and usable.
- A mobile product UI is excluded. The 320-pixel safety reflow is accessibility evidence, not mobile support.
- Autonomous multi-agent rounds, repository execution, in-product implementation review/acceptance, remote sync, authentication, and CI are excluded. CI is **NOT CONFIGURED**.
- Owner acceptance remains pending; agent and QA evidence cannot satisfy it.

## Owner Acceptance Workbook

Target time: 5–10 minutes. Start the service with `npm start`, then open `http://127.0.0.1:47831`.

Do not present this workbook until the full Playwright, bounded Impeccable, runtime, and independent-review gates pass on one frozen commit.

1. Register a project using any local Git repository and create a planning room. Confirm the first-run guidance disappears into a focused working surface.
2. Add an owner note, import one attributed Claude or other-agent response, and ask Codex if the local bridge is available. Confirm each voice remains visibly attributed; if Codex is unavailable, confirm import and owner work remain usable.
3. Capture at least three source-linked points. Accept one, reject or defer one, and edit one proposed point as a replacement. Confirm history and source navigation remain visible.
4. Prepare a package. Confirm only accepted points populate its included scope, then complete the six required sections and save.
5. Refresh the browser. Confirm the discussion, decisions, and package resume from local storage.
6. Choose **Review approval of v1**. Verify the checkpoint names version 1, Owner, 6/6 complete sections, the accepted-source count, immutability, and that approval does not execute work. Confirm approval.
7. Confirm version 1 reads **Ready for execution**, is locked, and records owner/time/source lineage. Create version 2, then return to version 1 and confirm it is unchanged.
8. Optionally restart `npm start` and return to the room to confirm persistence and project isolation.

Record one result here after the walkthrough:

- **Owner result:** PENDING
- **Accepted version/date:** —
- **Requested changes:** —
