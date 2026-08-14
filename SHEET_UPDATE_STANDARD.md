# VennuSign Planning Workbook Update Standard

## Status

Proposed shared standard for people, Codex, Claude Code, Apps Script, and other approved automation.

Target workbook: [VennuSign Planning](https://docs.google.com/spreadsheets/d/1DCtCrn5NAXCTNt5csmrjAOJvcCws7l9fdsnGQUCHFkM/edit)

## Purpose

Define one predictable way for every writer to read and update the planning workbook without losing decisions, confusing approval with execution authority, or overwriting another writer's work.

This standard applies regardless of which model, editor, connector, or script performs the update.

## Source-of-Truth Boundaries

- The workbook is authoritative for owner decisions, planning state, acceptance criteria, and the planning audit trail.
- The repository is authoritative for implemented code, repository plans, tests, commits, and release artifacts.
- GitHub is authoritative for issue, pull request, review, and merge state.
- Codex or Claude conversation history is supporting context, not durable planning authority.
- The local relay is transport. It does not independently redefine planning state.

When records disagree, do not silently choose one. Record the discrepancy and request resolution unless a more specific authority is already named in the row.

## General Rules

1. Read the exact target tab, header row, target row, dropdown validation, and relevant formulas immediately before writing.
2. Update by stable record ID, never by remembered row number.
3. Preserve the existing tab structure, formulas, hyperlinks, validation, formatting, notes, and unrelated cells.
4. Make the smallest complete update needed for the requested outcome.
5. Never replace a human answer with an agent recommendation.
6. Never infer owner approval from silence, prior discussion, or an agent-authored status.
7. Never use an existing decision status as an automatic authorization to modify the repository.
8. Re-read every changed row after writing and report the exact records changed.
9. Do not place credentials, tokens, private keys, or raw authentication material in the workbook.
10. Do not delete planning history merely because work is complete or superseded.

## Record Identity

Every durable record must have a stable ID in its tab's ID column.

Examples:

- `TS-PSA-01`
- `S7-PLN-01`
- `BL-N01`
- `PLAN-0142`

IDs are immutable after another system or record references them.

New IDs must:

- Follow the prefix pattern already used by the target tab.
- Be unique within the workbook when practical and always unique within the tab.
- Never reuse an ID from a deleted, rejected, or superseded record.
- Be allocated after reading existing IDs to find the next valid value.

Every automation command must reference both `source_tab` and `source_id`. A row number is not a durable reference.

## Human and Agent Fields

Fields have different authority and must not be blended.

### Human-Owned Fields

Examples include:

- `Your answer`
- Owner priority
- Owner acceptance
- Explicit approval or rejection
- Business decisions recorded as owner direction

Agents may format, quote, or append clarification requested by the owner, but must not invent or rewrite owner intent.

### Agent-Maintained Fields

Examples include:

- Recommended starting point
- Agent notes
- Draft acceptance criteria
- Technical evidence
- Implementation summaries
- Proposed dependencies and risks

Agent-written content must be factual, attributable, and distinguish recommendations from accepted decisions.

### Shared Fields

Examples include:

- Notes
- Status
- GitHub / PR links
- Acceptance evidence

Before updating a shared field, preserve meaningful existing content. Append a dated clarification when replacement would erase history or another writer's contribution.

## Status Semantics

Status is local to the record type. The word `Accepted` does not universally mean “start coding.”

### Decision Records

- `Draft`: incomplete proposal.
- `Needs decision`: owner input is required.
- `Recommended`: agent recommendation awaiting owner disposition.
- `Accepted`: the decision itself is accepted.
- `Blocked`: the decision cannot progress.

### Planning and Delivery Records

- `Needs planning`: scope or acceptance is incomplete.
- `Ready`: planning is complete and dependencies are satisfied.
- `In progress`: authorized work has started.
- `Blocked`: progress requires a named dependency or decision.
- `Complete`: acceptance evidence exists and the completion boundary is met.

### Execution Authority

Repository work begins only from an explicit execution command or an explicit owner instruction in the active conversation.

Changing a row to `Accepted`, `Ready`, or `Complete` does not itself create an execution command.

The Apps Script sidebar action **Approve and continue** creates a separate command in `Codex Commands`. That command is the machine-readable authorization boundary.

## Read-Before-Write Protocol

Every agent or script must perform this sequence:

1. Confirm the spreadsheet ID.
2. Read workbook metadata and resolve the exact visible tab name.
3. Read the header row.
4. Locate the target by stable ID within a bounded range.
5. Read the full target row, including formulas, validation, and notes when relevant.
6. Record the values that will be changed as the update's expected prior state.
7. Apply only the intended cell changes.
8. Re-read the row and verify the result.

If the prior state changes between steps 5 and 7, stop and treat the operation as a conflict.

## Conflict Handling

An agent must not silently overwrite a value changed by another person or agent after its last read.

On conflict:

1. Do not retry the write blindly.
2. Mark the automation command `CONFLICT` when the command queue exists.
3. Record the target tab, record ID, expected value, current value, and proposed value.
4. Preserve both versions in the conflict report.
5. Ask the owner to choose or perform a safe merge when the intended merge is unambiguous.

Agents may append independent notes without conflict only when the append operation is idempotent and does not duplicate an existing entry.

## Writing Decisions

When recording a new decision:

- Put the question or decision in the established decision column.
- Explain why it matters separately.
- Put the agent's recommendation in the recommendation column.
- Put only the owner's actual direction in the owner-answer column.
- Use notes for clarification, consequences, and follow-up.
- Set `Accepted` only after explicit owner acceptance or when the owner directly supplied the binding answer.

When a decision changes:

- Preserve the earlier decision in Notes or an activity record.
- State what changed and why.
- Identify affected records, plans, issues, or implementation.
- Do not silently rewrite downstream records that now require reconsideration.

## Writing Plans and Acceptance Criteria

Planning rows should describe outcomes rather than implementation activity alone.

Each implementation-ready item should identify:

- Customer or operator outcome
- Included scope
- Explicit exclusions
- Dependencies
- Acceptance evidence
- Relevant edge cases and failure paths
- Repository or GitHub record when opened

Do not mark an item `Ready` when acceptance evidence is still “to be defined,” a required owner decision remains open, or a named design prerequisite is missing.

## GitHub and Repository Synchronization

When implementation work begins:

- Link the planning record to the issue or repository plan.
- Record the branch when it exists.
- Do not claim a PR, commit, test, or merge that has not been verified.

When implementation completes:

- Add the verified commit or PR reference.
- Summarize material test and review evidence.
- Move to `Complete` only when the record's acceptance boundary is met.
- Preserve blocked, waived, or untested evidence explicitly.

Agents must not make GitHub state appear newer than the repository evidence they actually inspected.

## Automation Tabs

Automation must use dedicated tabs rather than adding transport state to planning tabs.

### Codex Commands

Append-only commands with these minimum fields:

```text
command_id
source_tab
source_id
thread_id
command_type
message
requested_by
requested_at
status
claimed_by
claimed_at
processed_at
error
```

Valid command states:

```text
PENDING
PROCESSING
COMPLETED
FAILED
CONFLICT
CANCELLED
```

A command must be idempotent. The same `command_id` must never cause the same action to execute twice.

### Codex Activity

Append-only operational events with these minimum fields:

```text
activity_id
command_id
source_tab
source_id
thread_id
actor
event_type
summary
details
created_at
```

Activity records should summarize useful progress. They should not copy hidden reasoning, credentials, raw prompts containing sensitive data, or complete conversation history.

### Codex Config

Configuration may contain identifiers, allowlists, paths, polling settings, and health state. It must not contain secrets.

## Attribution

Every automated command and activity entry must identify its actor, for example:

- `human:jeremy@example.com`
- `agent:codex`
- `agent:claude-code`
- `system:apps-script`
- `system:sheet-relay`

For material planning changes, add a short attribution to Notes or Activity when the existing schema does not already provide one.

Attribution identifies the writer, not the decision owner. An agent recording an owner decision must still make clear that the owner supplied the decision.

## Timestamps

- Use ISO 8601 timestamps.
- Store machine timestamps in UTC, for example `2026-08-13T18:42:00Z`.
- Display local time in the sidebar as `America/New_York`.
- Do not rely on ambiguous locale-formatted timestamps for command ordering.

## Prohibited Operations

Without explicit owner authorization, agents and scripts must not:

- Delete tabs or durable planning records.
- Rename existing tabs or header columns.
- Reorder columns used by automation.
- Remove formulas, hyperlinks, validation, conditional formatting, or notes.
- Bulk-normalize wording across existing decisions.
- Convert owner answers into agent summaries that lose the original wording.
- Mark decisions accepted or implementation complete based only on agent judgment.
- Execute a repository action solely because a planning status changed.
- Store secrets in the workbook.

## Verification Report

After an update, the writer should report:

```text
Workbook: VennuSign Planning
Tab: <exact tab name>
Records changed: <stable IDs>
Fields changed: <column names>
Reason: <short purpose>
Verification: re-read successful
Conflicts: none | details
```

For no-op updates, report that the requested state already existed instead of writing duplicate content.

## Workbench Milestones

The left-rail milestone timeline is curated in `relay/relay.config.json` under `milestones`. Codex and Claude may add or update an entry only for a material change merged to the repository's master branch, a production release, or a major planning-system capability becoming operational.

- Use a short outcome title, not a task description.
- Use `complete` for landed updates and `current` for the single active milestone.
- Keep at most six entries, newest last, removing the oldest completed entry when necessary.
- Do not add routine fixes, reviews, tests, or chat events.
- Verify the JSON and restart the `VennuSign Workbench Relay` scheduled task after editing.

## Shared Agent Instruction Block

The following block should be included in both `AGENTS.md` and `CLAUDE.md`, with tool-specific syntax added separately:

```markdown
## VennuSign Planning Workbook

The VennuSign Planning Google Sheet is authoritative for owner decisions, planning state, and acceptance criteria. Before writing, read workbook metadata, the exact tab headers, and the complete target row. Locate records by stable ID, never remembered row number. Preserve formulas, validation, hyperlinks, formatting, notes, owner wording, and unrelated cells.

Human-owned answer and approval fields must contain only explicit human direction. Agent recommendations must remain distinguishable from accepted decisions. `Accepted`, `Ready`, or `Complete` does not automatically authorize repository work; implementation requires an explicit owner instruction or a pending command in the dedicated command queue.

Use read-before-write conflict detection. If the target changed after it was read, stop, preserve both versions, and report a conflict rather than overwriting. Re-read every changed row after writing and report the exact tab, stable IDs, and fields changed. Never store credentials or tokens in the workbook.

Follow `SHEET_UPDATE_STANDARD.md` for the complete contract.
```

## Adoption Checklist

1. Review and accept this standard.
2. Add the shared instruction block to repository `AGENTS.md` and `CLAUDE.md`.
3. Add the three automation tabs with protected headers and validation.
4. Configure Apps Script and the relay to use stable IDs and idempotent commands.
5. Give each agent a distinct actor identifier.
6. Test concurrent edits and conflict reporting before enabling execution commands.
7. Revisit the standard when the workbook schema or App Server integration changes.
