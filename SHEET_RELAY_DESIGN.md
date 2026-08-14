# Google Sheets to Codex Planning Relay

## Purpose

Create a planning and approval workflow that connects Google Sheets to an existing Codex conversation and local Git repository.

The goal is to let a user plan, approve work, request reviews, answer follow-up questions, and monitor progress from Google Sheets without returning to the VS Code chat for every interaction.

## Core Principle

Each system has a distinct responsibility:

- **Codex chat** handles discussion, reasoning, implementation, testing, and review.
- **Google Sheets** is the durable planning ledger and remote control surface.
- **Apps Script** provides a convenient sidebar and structured workflow controls inside the Sheet.
- **A local relay** connects Sheet actions to the existing Codex thread and local repository.
- **Git and GitHub** hold implementation history and reviewable code changes.

The Sheet should not duplicate the complete conversation. It should store planning records, commands, approvals, activity, and the Codex thread identifier needed to continue the original conversation.

## Proposed Architecture

```text
Google Sheets sidebar
        |
        v
Commands and Approvals tabs
        |
        | polled periodically
        v
Local Sheet Relay
        |
        v
Codex App Server
        |
        +--> Existing VS Code Codex thread
        |
        +--> Local repository and Git
        |
        v
Results written to the Activity tab
```

The local relay polls Google Sheets rather than exposing the workstation or Codex App Server to the public internet.

## User Workflow

1. The user and Codex discuss an idea in the existing chat.
2. Codex creates or updates a structured item in the planning Sheet.
3. The user reviews the item in the Sheet.
4. The user clicks **Approve and continue** in the Apps Script sidebar.
5. Apps Script records a command associated with the planning item and Codex thread.
6. The local relay detects the command.
7. The relay resumes the existing Codex thread and submits a follow-up message such as:

   ```text
   PLAN-0142 was approved in Google Sheets. Continue with implementation.
   ```

8. Codex works in the configured repository and streams events through the App Server.
9. The relay records progress, questions, and the final response in the Activity tab.
10. The user can answer questions, request a review, approve a command, or send another instruction from the Sheet.

## Planning Workflow

Recommended status progression:

```text
IDEA
  -> PLANNING
  -> APPROVED
  -> IN_PROGRESS
  -> READY_FOR_REVIEW
  -> SHIPPED
```

`APPROVED` is the implementation boundary. Planning and clarification can happen before approval, but repository changes should begin only after explicit approval.

Additional terminal or exception states may include:

- `BLOCKED`
- `REJECTED`
- `CANCELLED`

## Spreadsheet Structure

### Planning Tab

One row represents one durable planning item.

| Column | Purpose |
| --- | --- |
| `item_id` | Stable identifier such as `PLAN-0142` |
| `title` | Short description of the work |
| `description` | Detailed scope and intent |
| `acceptance_criteria` | Conditions required for completion |
| `status` | Current workflow state |
| `priority` | Work ordering |
| `owner` | Responsible person or agent |
| `repo` | Target repository |
| `workspace_path` | Local working directory |
| `branch` | Working branch |
| `decision_notes` | Important conclusions from planning |
| `thread_id` | Codex thread associated with the item |
| `commit_sha` | Resulting commit, when available |
| `pr_url` | Pull request, when available |
| `created_at` | Creation timestamp |
| `updated_at` | Last update timestamp |

### Commands Tab

This is the queue consumed by the local relay.

| Column | Purpose |
| --- | --- |
| `command_id` | Unique command identifier |
| `item_id` | Related planning item |
| `thread_id` | Codex thread to resume |
| `command_type` | `CONTINUE`, `MESSAGE`, `REVIEW`, `STOP`, or `APPROVAL` |
| `message` | User instruction or follow-up text |
| `requested_by` | Google account or recorded user identity |
| `requested_at` | Creation timestamp |
| `status` | `PENDING`, `PROCESSING`, `COMPLETED`, or `FAILED` |
| `processed_at` | Relay completion timestamp |
| `error` | Failure details, if any |

### Activity Tab

This provides a readable audit trail without copying the entire internal thread.

| Column | Purpose |
| --- | --- |
| `activity_id` | Unique event identifier |
| `item_id` | Related planning item |
| `thread_id` | Related Codex thread |
| `event_type` | Progress, question, approval request, result, or error |
| `summary` | Human-readable event text |
| `details` | Optional structured or expanded information |
| `created_at` | Event timestamp |

### Config Tab

Configuration should include:

- Allowed spreadsheet ID
- Allowed repository roots
- Default workspace path
- Polling interval
- Active Codex thread ID
- Last processed command ID
- Relay health and last-seen timestamp

Secrets and OAuth credentials must not be stored in spreadsheet cells.

## Apps Script Sidebar

The sidebar is a Sheet-bound HTML interface. It should provide:

- Current planning item and status
- Quick-add and edit forms
- Acceptance-criteria editor
- **Approve and continue** action
- **Send to Codex** message input
- **Request review** action
- **Stop work** action
- Pending approval requests
- Recent activity and relay health
- Links to branches, commits, and pull requests

Apps Script writes commands and approval decisions into the Sheet. It does not directly control the local repository.

## Local Relay

The relay should be a small Node.js and TypeScript service running on the development workstation.

Its responsibilities are:

1. Authenticate to the Google Sheets API.
2. Poll for pending commands.
3. Validate the spreadsheet, user, item, thread, and workspace.
4. Mark a command as processing using an atomic or idempotent update.
5. Connect to the local Codex App Server.
6. List, read, or resume the requested thread.
7. Start the requested follow-up turn.
8. Capture streamed progress and approval requests.
9. Write useful events to the Activity tab.
10. Mark the command completed or failed.

The relay must avoid processing the same command more than once. Each command should have a unique ID and a durable processing state.

## Codex Thread Integration

The Codex App Server supports the capabilities needed for this workflow:

- List stored threads, including VS Code-originated threads
- Read stored thread history without resuming it
- Resume an existing thread by ID
- Start a new turn on the resumed thread
- Stream agent and tool events
- Receive and answer command or file-change approval requests

The Sheet only needs the `thread_id`; the complete thread history remains in Codex's local thread store.

The App Server transport is currently experimental. This design is appropriate for a personal or internal development workflow, but it should not be treated as a public production service without further hardening.

## Approval Handling

There are two separate approval layers:

### Planning Approval

The user approves the scope of a planning item and authorizes implementation.

Example command:

```text
PLAN-0142 was approved in Google Sheets. Continue with implementation using the recorded acceptance criteria.
```

### Execution Approval

Codex may request approval for a command, network access, or file change. The relay can write the pending request into the Sheet and wait for the user to choose:

- Accept
- Accept for session, when supported
- Decline
- Cancel

The relay then returns that decision to the pending App Server request.

Destructive or unusually broad operations should always require explicit approval, regardless of the planning item's status.

## Security Boundaries

- Keep Codex App Server bound to localhost.
- Do not expose its WebSocket port directly to the internet.
- Let the relay initiate outbound access to Google Sheets by polling.
- Restrict the relay to explicitly configured spreadsheet IDs.
- Restrict repository access to explicitly configured workspace roots.
- Validate the requesting Google identity where available.
- Store OAuth credentials in the operating system credential store or protected local configuration.
- Never place API keys, access tokens, or refresh tokens in the Sheet.
- Record an audit event for every command and approval decision.
- Reject stale, duplicate, malformed, or unauthorized commands.

## Implementation Stages

### Stage 1: Direct Sheet Workflow

- Normalize the existing planning Sheet.
- Allow Codex to create and update planning items through the Google Sheets integration.
- Establish status definitions and the approval boundary.
- Use the workflow manually to confirm the schema is practical.

### Stage 2: Apps Script Sidebar

- Build the planning item editor.
- Add status and approval controls.
- Add the Commands and Activity tabs.
- Display relay health and recent events.

### Stage 3: Local Relay

- Implement Google authentication and polling.
- Discover and record the appropriate VS Code Codex thread.
- Resume the thread from Sheet commands.
- Write final responses and failures back to the Sheet.

This stage removes the need to return to VS Code just to say "approved," "continue," or "review."

### Stage 4: Interactive Approvals and Progress

- Stream summarized progress into the Activity tab.
- Surface Codex questions in the sidebar.
- Handle command and file-change approvals.
- Add stop, retry, and recovery controls.

### Stage 5: Operational Hardening

- Add structured logging and diagnostics.
- Add idempotency and crash recovery tests.
- Add repository and identity allowlists.
- Add startup automation for the local relay.
- Document backup and recovery procedures.

## Initial Success Criteria

The first complete version is successful when:

1. Codex can create a planning item in the Sheet from the current chat.
2. The user can approve that item from the Sheet.
3. The local relay detects the approval without an inbound public endpoint.
4. The relay resumes the correct existing Codex thread.
5. Codex continues work in the correct repository.
6. The result appears in the Sheet.
7. The user can request a follow-up or review from the Sheet.
8. Duplicate commands are not executed twice.

## References

- [Workbook update standard](SHEET_UPDATE_STANDARD.md)
- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [OpenAI plugin architecture](https://developers.openai.com/plugins/concepts/plugins)
- [Google Apps Script dialogs and sidebars](https://developers.google.com/apps-script/guides/dialogs)
- [Google Apps Script web apps](https://developers.google.com/apps-script/guides/web)
