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
| Unconfirmed request, leave, return | Unconfirmed message, capture, replacement, package, and room-title input is held against its project and room, re-snapshotted on every exit so later edits survive, restored on return to that exact route across repeated cycles, and resubmitted under the original request-bound idempotency key; it does not cross a project or room boundary and does not survive a full reload | Playwright `unconfirmed-input-recovery` spec |
| Lost mutation receipt | A save whose response is lost but whose exact content is already durable reconciles to saved instead of reporting a concurrent-edit conflict or offering the entry back as unsent, and resubmission creates no duplicate record | Playwright `unconfirmed-input-recovery` spec plus idempotency persistence tests |
| Held entry whose target changed | A replacement whose planning point was decided elsewhere, or a capture whose source contribution is gone, is refused with an explicit statement instead of restored into an action the authority model forbids | Playwright `unconfirmed-input-recovery` spec |
| Provider bridge configuration | A non-loopback or non-WebSocket provider bridge URL, and an invalid port, fail startup instead of sending planning content off the machine or binding an unintended port | `http-security` integration test |
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

Unconfirmed input recovery is route-scoped and in-memory. When a mutation ends in `REQUEST_UNCONFIRMED`, the browser holds one recovery record per operation slot, stamped with its project and planning-room identity. It never crosses a project or room boundary.

The record is **re-snapshotted from live draft state every time the owner leaves the route**, so anything typed after the failed submit is carried too, and it survives repeated leave-and-return cycles. It is retired only when the operation succeeds, when the owner explicitly clears the input, or when the held entry is found to be already durable. Resubmission of unchanged content reuses the original request-bound idempotency key, so a save whose receipt was lost cannot create a duplicate durable record.

Before restoring anything, the browser reconciles the held entry against freshly loaded durable state. A message, capture, replacement, room title, or package save that already committed is **not** offered back as unsent input; it is retired and reported as already saved. This matters because the owner is otherwise invited to resubmit — and an edited resubmission mints a new key and would create a second durable record. A replacement whose planning point has since been decided, or a capture whose source contribution is gone, is refused with an explicit statement rather than restored into a form the authority model forbids.

Every recovery outcome is reported both as a visible status near the affected station and as a polite announcement, and the wording distinguishes restored, rebased, held, already-saved, and refused. A superseded bootstrap or room read can neither replace a newer healthy route nor strand the loading surface. A resolved error is retracted from the live regions; a refusal that survives a redirect is carried to the surface the owner lands on rather than announced into a page that is about to be replaced.

The reload boundary is recorded in `open-questions.md` for an explicit owner decision.

### Implementation verification

```text
npm test
```

Result on 2026-08-14: **53 passed, 0 failed**. The suite exercises the real on-disk SQLite boundary, all four migrations, sixteen persisted-state invariants, restart/WAL behavior, project isolation, attribution and lineage, idempotency, immutable history, authority denial, approval completeness, concurrency, retry/cancellation, Codex cleanup quarantine, provider-error sanitization, and validation. The recovery delta is browser-only and added no service, storage, or migration change, so these results carry forward unchanged.

```text
npm run test:coverage
```

Result on 2026-08-14: **53 passed, 0 failed**, all files **90.33% lines, 77.67% branches, 88.30% functions**. `http-server.mjs` reports the lowest line coverage because its routes are exercised end to end by Playwright rather than by `node --test`.

**Read this figure correctly.** The coverage report contains **no row for `app/public/app.mjs`**. It describes server code only. The browser recovery work has **zero `node --test` coverage by construction**; its only executed evidence is the Playwright suite. Independent review raised this explicitly and it must not be read as delta coverage.

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

The browser regressions were proved the same way with this focused command:

```text
npx playwright test --grep "unconfirmed-input-recovery"
```

| Inversion | Observed failure |
| --- | --- |
| Recovery arming disabled in `withMutation` | Restored composer value empty instead of the held owner context |
| Lost-receipt reconciliation disabled in `syncPackageDraft` | False `This package changed in another view while you were editing.` conflict |
| Durable-entry reconciliation disabled in `consumePendingDraftRecoveries` | The already-saved status never appears; the committed entry is offered back as unsent |
| `refreshHeldDraftRecoveries()` disabled on route exit | The sentence typed after the refusal is lost — received the pre-submit snapshot |

The provider-bridge guard was proved the same way with `node --test app/test/integration/http-security.test.mjs`: with `localProviderUrl` bypassed, the suite reported 1 failed. Each fix was restored and the corresponding command re-run to a pass, and `grep -c "false &&" app/public/app.mjs` returns 0 on the committed head.

Five further defects were first observed as real failures before their fixes landed: the bootstrap-retry surface, a resolved error left announced in the assertive live region after navigation, a stale `Package edits unsaved` header after the reconcile, an unheard refusal destroyed by retraction during a redirect, and a replacement restored onto a planning point that had since been decided.

### UI QA

```text
npm run test:e2e
```

Result on 2026-08-14: **10 passed, 0 failed** in roughly 1.4 minutes against the real browser, local application service, and on-disk SQLite boundary. Two specifications are new in this delta:

- `stale-refresh-alert-suppression` — a superseded explicit room read must not alert after navigation, and an older read that fails after a newer successful read must neither alert nor roll the view back. Its second half exercises the pre-existing `detailRequestSequence` guard rather than delta code; it is regression coverage, not evidence for this delta.
- `unconfirmed-input-recovery` — unconfirmed message, capture, replacement, package, and room-title input is held per route, refused across project and room boundaries, restored on return, and resubmitted under the original idempotency key with no duplicate durable record. It further proves that a sentence typed **after** the refusal survives, that a second leave-and-return still restores, that an entry which committed before its receipt was lost is reported as already saved rather than offered back as unsent, that a replacement whose point was decided elsewhere is refused with an explicit statement, that a lost package receipt reconciles without a false conflict, and that a **held recovery record** does not survive a full page reload while durable state returns from SQLite.

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

### Independent review

Three agent reviewers examined commit `42cdc5f`, none of which authored it, per `AGENTS.md` "Every pull request receives an independent review by an agent or person who did not author the implementation."

- **Impeccable finish review — FAIL, 8 material findings.** Independently verified that the delta changed no markup, stylesheet, or asset. Found that error retraction destroyed refusals the owner never heard, that the already-durable check existed only for packages, that the restore announcement misdescribed the `rebased` and `held` package outcomes, that recovery was announcement-only with no visible status, and that the reconciliation copy leaked transport vocabulary. Ran without screenshots or a comp render and with the detector barred, so it is a code-and-authority review, not a visual one.
- **Independent implementation review — REQUEST_CHANGES, 4 material findings.** Re-executed `npm test` and `npm run test:coverage` and confirmed both claims exactly. Found that recovery snapshots were frozen at submit time (later edits silently discarded), that committed-but-unreceipted entries were never retired for four of five slot types, that restore was one-shot, and that replacement restore skipped the existence and disposition check. Also established that no browser path can cross an authority boundary, and that project and room stamping is correct on every traced path.
- **Independent security review — LOW residual risk, no CRITICAL or HIGH.** Enumerated every interpolation across all six `innerHTML` sites and found no exploitable XSS; confirmed full SQL parameterisation, sound repository-root allowlisting, a genuinely enforced local request boundary, no committed secrets, and correct Codex turn correlation. One MEDIUM was fixed in this milestone: an unvalidated outbound provider URL. One MEDIUM is accepted Milestone 1 scope: no authentication.

All material findings were addressed except those recorded as accepted or backlog below. **These reviews cover `42cdc5f`; the fixes that answer them create a new head, and `AGENTS.md` holds that new commits invalidate a prior approval until the new head is reviewed.** A fresh independent review of the current head is therefore still required before merge.

### Accepted risks and recorded backlog

Accepted for Milestone 1, to be reopened before any second user or non-loopback binding:

- No authentication; `resolveActor` returns the owner for every request, so loopback is the only boundary and any local process holds full approval authority.
- `ANDAMENTO_TEST_MODE=1` enables actor spoofing and test-participant creation. It is off by default and `assertOwner` still gates every operation, but it must remain impossible to set in a shipped configuration.
- `/api/bootstrap` discloses every project name and absolute repository root to any local process.

Proposed follow-up work, not authorized by this milestone:

- Error feedback is announced twice — assertively by `setFeedback` and again by the `role="alert"` banner. Only the live-region copy can be retracted, so the retraction behaviour is necessarily partial. Fixing this means changing the banner's role, which touches assertions across the whole suite.
- Static-file containment is lexical, so a symlink or junction under `app/public/` would escape it; `realpath` before the containment check would close it.
- Provider text is unbounded in the adapter until the persist-time 20,000-character cap, so a compromised local bridge could exhaust memory before validation.
- `mutation_receipts` has no retention policy, and `state.mutationKeys` has no eviction. Both are owner-driven and bounded in practice; capping the key map was deliberately **not** done, because evicting a fingerprint would mint a new idempotency key for a repeated payload and trade a theoretical leak for a real duplicate-record risk.
- `execFile('git', …)` resolves through PATH; an absolute path would remove a Windows search-order edge case.
- `applyResponsiveStationVisibility` switches to the tabbed station at 1279px while the approved design specifies the tabbed station from 1024 to 1439. Pre-existing and outside this delta.
- `resumeAfterSupersededBootstrap` has no reachable path in the current code and therefore no executed coverage; it is marked **UNTESTED**. The unreachable stranding branch it originally contained was removed rather than left shipping untested.
- `http-security` has no case for an absent `Origin` with an absent `Sec-Fetch-Site`, a cross-site GET read, or `Origin: null`. The code handles all three; the coverage gap is in the test.

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
