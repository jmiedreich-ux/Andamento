# Andamento Development Instructions

## Startup and Source of Truth

Before changing this repository, read only:

1. `AGENTS.md`
2. `ai/handoffs/current.md`
3. `tracker/assignments.json`
4. `PROJECT_STATUS.md`
5. The active feature records under `docs/features/<feature>/`, when a feature is active
6. Linked issue, branch, pull request, review comments, and exact-head CI results where they exist

Read component, architecture, operations, or historical documents only when the task touches that area. Repository and live GitHub state override chat history and superseded material.

`PRODUCT_DESIGN.md` is the current product direction. It is not implementation authority until its relevant feature design and milestone are explicitly approved by the owner.

## Working Model — Features and Milestones

- The unit of product work is a **feature**, named by durable user capability.
- A feature is delivered in numbered **milestones**. Each milestone is a small functional vertical piece that ships whole.
- **Design before implementation.** UI work starts only after its design authority is explicitly approved and stored under `docs/design/approved/<feature>/`. Approved decisions win when another document conflicts.
- Open questions are recorded under `docs/features/<feature>/open-questions.md`; they are never answered silently. Silence means deferred, not accepted.
- Every implementation milestone carries its required storage, domain, service/API, UI, and end-to-end behavior together. For a UI-bearing milestone, storage → domain/service/API → UI → Playwright end-to-end specifications ship together. Tests are written with the behavior, not added afterward.
- Each milestone must be independently mergeable and leave the default branch releasable.
- Use one issue, one claim, one feature branch, and one pull request per milestone unless the owner approves a different boundary.
- Work one milestone at a time. A successor starts only after its predecessor is merged and owner-accepted.
- A UI milestone passes four distinct gates in order: implementation verification, Impeccable and Playwright UI QA, independent review, and owner acceptance. Evidence from one gate never satisfies another.
- Every milestone ends with a short owner acceptance workbook or equivalent guided demo before the next milestone starts. The workbook should take roughly 5–10 minutes and focus on customer-visible outcomes.
- Every pull request receives an independent review by an agent or person who did not author the implementation.

## Owner and Agent Authority

- The owner supplies product direction, approves design, authorizes exact work-package versions, resolves material decisions, and provides final acceptance.
- Agents may brainstorm, challenge, recommend, decompose, draft, implement after approval, collect evidence, and review.
- Agent agreement never constitutes owner approval.
- A discussion, planning status, milestone status, or accepted recommendation never authorizes repository changes by itself.
- Work begins only from an explicit owner instruction or an approved work package assigned for execution.
- Review findings may propose follow-up work but cannot authorize it.
- Material changes to an approved work package create a new version and require new approval.

## How to Work a Task

These rules govern every behavioral change, not only milestone work.

### State the Whole Behavior

Before coding, state:

- The complete user behavior this task belongs to.
- What happens immediately before and after it.
- Every other place the same behavior exists.
- The invariants that must always remain true.

Fix the behavior everywhere it exists, not only the example that exposed it.

### Map the Paths

Map and name the applicable paths before implementation:

- Happy path
- Loading and empty states
- Validation and refusal
- Conflict and stale actor
- Permission denied or capability unavailable
- Cancellation and close
- Retry after failure or timeout
- Refresh, leave, return, and interrupted resumption
- Repeated or double submission
- Concurrent participant or agent activity
- Existing saved data as well as newly created data

State how each path will be validated. Mark paths with no executed validation as **UNTESTED**.

### Search the Behavior Surface

Answer “where else does this apply?” with a repository search, not memory. Record the exact search command and its complete relevant results in the issue or pull-request report. Name every result not changed and why it remains unchanged.

### Assert Invariants

Each feature owns explicit model invariants: states the system must never permit. Assert them automatically after tests against the state those tests leave behind. When a defect reveals an impossible state, add or strengthen the invariant as well as the regression test.

### Produce Rerunnable Evidence

Evidence is a command another person can rerun plus its output, or a guided acceptance case plus its recorded outcome. “Verified working” is not evidence. Anything not actually executed is **UNTESTED**.

Before stopping, update the controlled handoff with what was established, assumed, deliberately deferred, and the exact next action.

## Definition of Done

Consider every category below. Name non-applicable categories instead of silently skipping them.

### Behavior

- Happy path works end to end.
- Loading, empty, disabled, error, and retry states are intentional.
- Validation works on creation and editing existing saved data.
- Recovery does not discard valid user input.

### Data

- New and existing saved data are covered.
- Empty, invalid, minimum, maximum, very long, and duplicate values are covered where meaningful.
- Partially completed and superseded data are handled.
- Attribution and source relationships remain intact.

### Navigation and Persistence

- Back navigation preserves appropriate entered state.
- Refresh during a flow is handled.
- Leave and return resumes or clearly restarts.
- Cancel and close are defined.
- Edit after completion is defined.
- Double-click and repeated submission are idempotent or safely refused.

### Access and Authority

- Relevant participant roles are covered.
- Permission granted and denied are covered.
- Capability enabled, disabled, unavailable, or not configured is covered.
- Authority changes after data creation are handled.
- No agent action crosses an owner approval boundary.

### Integrations

- Success, failure, timeout, malformed or partial response, cancellation, and retry are covered.
- Provider-specific responses are normalized without erasing provider attribution.
- Duplicate callbacks or resumed streams do not duplicate durable work.

### Display

- Smallest and largest supported widths are checked.
- Long labels and overflow are checked.
- Zero, one, many, and more-than-fit data shapes are checked.
- Status uses text or shape in addition to color.
- Keyboard focus, accessible names, relationships, and announcements are checked where applicable.

### Multiplier

- Every location of the behavior was searched and considered.
- Every consumer of a shared contract or component was considered.
- The surrounding workflow received a focused regression check.

## Architecture and Data Boundaries

- SQLite in WAL mode is the initial authoritative store. Use ordered migrations, foreign keys, short transactions, a busy timeout, and indexes for relationship and queue access paths.
- Released migrations are immutable. Correct released behavior with a new migration so existing and fresh databases converge.
- The UI never accesses SQLite or provider credentials directly. A local application service owns authorization, orchestration, transactions, and normalization.
- Agents and provider adapters never receive unrestricted SQL access.
- Discussion messages are context; accepted planning points, approved work-package versions, evidence, findings, and acceptance events are durable authority records.
- Approval and acceptance events are append-only.
- Store secrets in supported operating-system or environment-backed secret providers, never source files, SQLite rows, browser storage, logs, screenshots, or audit records.
- Bind local services to localhost by default. LAN or remote access is a separate, explicitly enabled capability with real authentication.
- Allowlist repository roots per project and validate every execution request against its approved work-package version.
- Inspect existing contracts before adding tables, routes, events, payloads, abstractions, or dependencies.
- Preserve provider neutrality. Product-domain records must not require one model vendor's response shape.

## Documentation Control

- Treat Markdown as a maintained interface, not a work log.
- Controlled living records are `AGENTS.md`, `PROJECT_STATUS.md`, `ai/handoffs/current.md`, `tracker/assignments.json`, active feature records, and affected durable architecture or operations documents.
- Update an existing authoritative document before creating another Markdown file.
- Create a new document only for a durable audience and purpose not served by an existing record.
- A change that makes a controlled record false updates that record in the same milestone closeout.
- Batch controlled-record updates at milestone checkpoints instead of editing them after every local commit.
- Keep historical or superseded material in an archive location and read it only for deliberate research.
- Never commit secrets, generated output, runtime state, logs, tokens, connection strings, or machine-specific configuration.

## Shared-File and Multi-Agent Safety

- No two agents may modify the same file concurrently.
- Check `tracker/assignments.json` and open claims before starting.
- Stop and re-plan on an ownership conflict.
- Contracts, migrations, dependency configuration, shared fixtures, workflows, tracker, status, and handoff are owned by the coordinating agent while a milestone is active.
- Specialist agents may research or review in parallel, but their findings return to the coordinating agent for controlled-file updates.

## Discoveries and Backlog

- Record out-of-scope discoveries as proposed items; do not silently expand the active milestone.
- Owner-approved out-of-scope work becomes backlog work at the moment of the decision.
- A small in-scope defect may be fixed within the milestone when explicitly recorded. A larger behavior gets its own milestone or issue.
- Repository presence, an agent suggestion, or a review finding does not make an item approved.

## Testing

- Add focused tests for every behavioral change at the layer that enforces the rule.
- Unit tests cover pure logic. Persistence rules require tests against the real SQLite boundary, not an in-memory imitation of the rule.
- A test suite that cannot reach its required database fails; it never reports success after asserting nothing.
- Run feature invariants automatically after persistence tests.
- Verify regression tests by observing failure with the fix removed or behavior inverted, then restore the fix and observe the pass.
- Acceptance asserts what the owner or user sees after a sequence, not merely that an API accepted a request.
- Widen validation for shared contracts, authentication, migrations, dependencies, project configuration, provider adapters, or workflows.
- Documentation-only changes use lightweight repository validation.

### UI QA and Playwright

- UI QA is a required gate distinct from independent review and owner acceptance.
- Every UI-bearing milestone includes Playwright specifications for the complete customer-visible workflow and every applicable path named under **Map the Paths**, including supported viewports, navigation, persistence, validation, refusal, recovery, repeated submission, and concurrent activity where relevant.
- Playwright runs against the real local application surface, application service, and SQLite boundary. Deterministic test adapters may replace paid or external model providers, but mocked UI, service, or persistence layers are not the sole end-to-end proof.
- The applicable Playwright suite runs locally before a UI milestone is presented for review or acceptance. A suite that cannot start its required application, browser, service, or database fails the gate; unexecuted paths are **UNTESTED**, never implied passing.
- Impeccable critique and audit evidence plus passing Playwright evidence form the UI QA gate. Neither one substitutes for the other.

Until CI is configured and explicitly made authoritative, local validation is the gate and CI is **NOT CONFIGURED**, not implicitly passing.

## UI Completeness

- UI work requires an approved design authority before implementation.
- Before designing, changing, or reviewing a page or screen, load the project-local Impeccable skill at `.agents/skills/impeccable/SKILL.md` and follow its routing, context, craft-floor, and bounded-verification instructions applicable to the task.
- Andamento has an independent visual language. VennuSign, Google Sheets, and earlier workbench palettes, typography, assets, layouts, components, and interaction compositions are historical evidence, not defaults. Visual reuse requires explicit owner approval in the affected Andamento design authority.
- Before closing a UI milestone, run bounded Impeccable critique and audit passes against the approved design authority and resolve required findings or record an owner-approved exclusion.
- Before approving an Andamento UI direction, compare it with the earlier interfaces at shell silhouette, grayscale hierarchy, typography, component shape, navigation, and discussion composition; it must remain clearly distinguishable without relying on the product name.
- Record goals, hierarchy, navigation, CRUD actions, destructive-action safety, feedback, accessibility, responsiveness, and required data/API/auth support.
- Resolve required gaps in scope or record an approved exclusion. Do not ship necessary actions or states as silent omissions.
- Keep the work and owner decisions prominent. AI identity and chat controls remain supporting UI except inside a focused discussion room.

## Review and Merge Gate

- The author never performs the only review of their own milestone.
- Independent review is not QA. It evaluates the implementation, evidence, architecture, security, and scope, but cannot replace or waive required Impeccable or Playwright evidence.
- Review the full diff, acceptance criteria, architecture and security impact, tests, exact reviewed head, artifacts, secrets, debug code, unrelated changes, branch drift, and documentation accuracy.
- Review decisions are `APPROVE`, `REQUEST_CHANGES`, or `COMMENT`.
- New commits invalidate a prior approval until the new head is reviewed.
- Do not merge with unresolved material comments, incomplete required local validation, or failing required checks.
- If the platform cannot record formal independent approval, record the reviewer, reviewed commit, validation status, decision, and residual risks in the pull request.

## Milestone Completion and Handoff

At milestone completion, synchronize:

- The milestone issue and pull request
- `PROJECT_STATUS.md`
- `tracker/assignments.json`
- `ai/handoffs/current.md`
- Active feature records
- Affected architecture, API, database, operational, and design documentation
- The owner acceptance record

The handoff names one exact next action. Completed branches are removed after merge unless the owner directs otherwise.

## Code and Repository Quality

- Follow repository formatting, linting, type, and analyzer configuration once established.
- Prefer existing services and abstractions over parallel replacements.
- Use asynchronous I/O with cancellation for model, process, filesystem, and network operations.
- Validate configuration at startup and document new dependencies.
- Keep changes bounded and do not refactor unrelated code or start future-milestone work.
- Preserve unrelated user changes.
