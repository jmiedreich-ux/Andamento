# Andamento Product Design

## Status

Initial product direction and build sequence.

**Andamento** is the owner-approved product name as of 2026-08-14. In mosaic art, andamento is the visual flow and direction created by the placement of individual pieces. The name expresses the product's role: giving coherent direction to projects, discussions, decisions, work packages, evidence, and agent contributions without erasing their individual identity.

“Development workbench” remains a category description, not a competing product name.

## Product Thesis

Andamento is a local-first planning, decision, execution, review, and acceptance system for software work performed with AI agents.

The product is designed for an owner whose primary responsibilities are now to:

- Explore problems and shape direction.
- Make product and system decisions.
- Decompose large applications into milestones, slices, and work packages.
- Authorize bounded implementation work.
- Review evidence and provide final acceptance.

The work is the product's center of gravity. AI is a participant in the process, not the product identity and not the system of record.

## The Problem

Large applications generate more than tasks. They generate discussions, competing recommendations, individual planning points, decisions, risks, dependencies, milestones, slices, follow-up work, implementation evidence, and review findings.

Conventional chat tools preserve conversation but do not reliably turn it into governed work. Conventional project tools preserve tasks but lose the reasoning that created them. Neither gives several AI agents a safe way to contribute while keeping the owner in control of approval and acceptance.

Andamento joins those concerns without treating conversation as authorization.

## Product Principles

1. **Work before AI.** Projects, decisions, packages, evidence, and approvals dominate the interface.
2. **Discussion is first-class.** Discussion is attached to durable work context and can produce structured planning records.
3. **Agents propose; the owner decides.** Agent consensus never becomes approval automatically.
4. **Approval is explicit and immutable.** An approved work package is a versioned authorization boundary.
5. **Final acceptance belongs to the owner.** Passing tests and agent review provide evidence, not acceptance.
6. **Dissent is useful data.** The system preserves material disagreement instead of summarizing it away.
7. **Local-first and fast.** Common navigation and writes should feel immediate and should not depend on a remote planning service.
8. **Provider-neutral.** OpenAI, Anthropic, local models, and future agents participate through adapters.
9. **Evidence-led status.** The product never claims completion without the required evidence.
10. **History is append-oriented.** Decisions may be superseded, but material history is not silently rewritten.

## Authority Model

| Actor | May propose | May change planning drafts | May approve work | May execute | May review | May finally accept |
| --- | --- | --- | --- | --- | --- | --- |
| Owner | Yes | Yes | Yes | Optional | Yes | Yes |
| Facilitator agent | Yes | Within configured draft fields | No | No | No | No |
| Specialist agent | Yes | Within configured draft fields | No | No | Yes | No |
| Implementation agent | Yes | Execution notes only | No | After approval | No for its own work | No |
| Review agent | Yes | Findings and evidence only | No | No | Yes | No |
| System automation | No | Mechanical transitions only | No | Dispatch only | No | No |

An agent recording an owner's decision must attribute it to the owner. A planning status is never a substitute for an explicit approval event.

## Core Work Model

```text
Portfolio
  -> Project
      -> Milestone
          -> Slice
              -> Sub-slice (recursive when needed)
                  -> Discussion
                      -> Planning points
                          -> Decisions / Requirements / Risks / Dependencies
                  -> Work package version
                      -> Execution run
                          -> Evidence / Findings / Proposed follow-ups
                      -> Owner acceptance
```

The hierarchy is flexible rather than fixed-depth. A slice can be split, moved, or promoted. A milestone can be divided without losing the relationships and decisions that led to the change.

## Discussion and Multi-Agent Decision Rooms

A discussion is a durable room attached to a project, milestone, slice, work package, finding, or decision. It contains human messages, agent contributions, referenced artifacts, and extracted planning points.

### Participants

Each agent participant has:

- A stable identity and visible display name.
- A provider and model configuration.
- An assigned perspective such as product, architecture, implementation, QA, security, or review.
- A bounded instruction set.
- Tool permissions.
- Speaking rules, response budget, and cost limits.
- A record of the exact model and configuration used for each contribution.

### Discussion Modes

- **Direct:** Ask one participant with `@name`.
- **Panel:** Selected agents respond independently.
- **Challenge:** One or more agents critique a named proposal.
- **Cross-examination:** Agents receive each other's responses for a bounded number of rounds.
- **Specialist review:** Each participant evaluates the topic from its assigned perspective.
- **Synthesis:** A facilitator identifies agreement, disagreement, assumptions, and decisions needed.

Agents listen by default. They speak when invited, mentioned, assigned a round, or when configured to raise a material contradiction or risk. The owner can mute a participant, stop a round, or close a line of discussion.

### Individual Planning Points

Any message or selected passage may produce one or more planning points:

- Open question
- Decision
- Requirement
- Constraint
- Risk
- Dependency
- Assumption
- Proposed work
- Parking-lot item

Agents may extract and classify points, but extracted points begin as `PROPOSED`. The owner may accept, edit, merge, reject, defer, or link them. Accepted points become durable inputs to planning. Their source message and author remain traceable.

### Preventing Agent Noise

- Limit automatic participation to material risks, contradictions, or assigned review rounds.
- Collect independent answers before revealing them to other agents when diversity matters.
- Bound debates by participants, rounds, time, and spend.
- Collapse repeated arguments while retaining links to every source contribution.
- Require pushback to identify the concern, consequence, and preferred alternative.
- Make unresolved dissent visible when preparing a work package.

## Work Packages

A work package is a bounded, executable contract assembled from accepted planning records. It is not merely a task description.

An approvable work package contains:

- Intended outcome
- Included scope
- Explicit exclusions
- Acceptance criteria
- Dependencies and prerequisites
- Relevant decisions and constraints
- Known risks and unresolved assumptions
- Target repositories and allowed workspace roots
- Execution approach and agent assignment
- Required review roles
- Required acceptance evidence

### Versioning and Approval

Draft work packages remain editable. Approval creates an immutable version and an append-only approval event containing the owner, time, approved version, and authorization scope.

A material change after approval creates a new draft version. It does not silently widen the approved scope.

```text
DRAFT -> READY_FOR_APPROVAL -> APPROVED -> IN_PROGRESS
      -> READY_FOR_REVIEW -> READY_FOR_ACCEPTANCE -> ACCEPTED

Exception states: BLOCKED, CHANGES_REQUESTED, CANCELLED, SUPERSEDED
```

## Review, Evidence, and Follow-Up Work

Implementation and review agents report evidence against the approved package rather than reporting only a narrative result.

Evidence may include:

- Commits and diffs
- Automated test results
- Performance measurements
- Screenshots or recordings
- Security and dependency scans
- Manual walkthrough notes
- Deployment or release references

Review findings are classified by severity and status. A finding can block acceptance or propose follow-up work. Proposed follow-up work is not approved merely because a reviewer created it.

The owner can:

- Accept the approved work package version.
- Request changes within the approved scope.
- Create a proposed follow-up package.
- Reopen planning when a finding invalidates an earlier decision.
- Accept with an explicitly recorded waiver when policy allows.

## Primary Experience

### 1. Today

The default screen answers:

- What needs my decision?
- What is awaiting my approval?
- What is currently being executed?
- What is blocked?
- What is ready for final acceptance?

This is more useful for daily operation than opening on a generic project dashboard or chat history.

### 2. Discussion Room

The center shows the focused discussion. The context rail shows the parent project, milestone, slice, relevant decisions, and source material. A planning tray shows proposed and accepted individual points. Participant controls select agents and discussion mode.

The key action is **Prepare work package**, available without implying approval.

### 3. Planning Workspace

The planning workspace shows the milestone and slice hierarchy, outcomes, dependencies, decisions, risks, open questions, and proposed packages. It supports splitting and moving work while preserving lineage.

### 4. Work Package Approval

The approval screen compares the draft package with its sources, calls out unresolved issues, and clearly distinguishes **Approve package** from **Return for revision**.

### 5. Execution and Acceptance

The execution view shows verified progress and approval requests. The acceptance view maps evidence and findings to each acceptance criterion, with final owner controls.

### 6. Portfolio

The portfolio view spans projects and is valuable after the core loop works. It shows decisions, approvals, blockers, active packages, and acceptance queues across unrelated projects.

## Smallest Useful Product

The first release should close one complete, real loop instead of implementing the whole information architecture superficially.

### Initial Vertical Slice

1. Create or select a project with one local repository.
2. Start a discussion attached to the project or a planning item.
3. Add an OpenAI participant and an Anthropic participant through provider adapters.
4. Ask one agent, both independently, or run one bounded challenge round.
5. Capture individual points from the discussion and accept or reject them.
6. Assemble accepted points into a versioned work-package draft.
7. Approve the exact package version as owner.
8. Dispatch it to one implementation-agent adapter, initially reusing the existing Codex bridge where practical.
9. Stream concise execution activity and record evidence.
10. Record a review result and proposed follow-up items.
11. Accept the work or request changes as owner.

This vertical slice proves the differentiating workflow: multi-agent discussion becomes governed work and returns as evidence for human acceptance.

### Included Initially

- Local project and repository registration
- One-level planning items with parent relationships
- Durable discussion rooms
- Direct, panel, challenge, and synthesis modes
- OpenAI and Anthropic provider adapters
- Manual and agent-proposed planning-point capture
- Work-package drafting, versioning, and approval
- One implementation-agent adapter
- Activity streaming
- Evidence and findings
- Owner acceptance or change request
- Search across titles, summaries, and accepted points
- Complete attribution and audit events

### Deliberately Deferred

- Large portfolio reporting
- Complex scheduling and resource forecasting
- Autonomous agent-created execution
- Unlimited agent-to-agent conversation
- Full GitHub lifecycle automation
- Google Sheets synchronization
- Organization-wide identity and permissions
- Multi-machine database access
- Plugin marketplace
- Custom workflow designer

## Local-First Architecture

```text
Desktop or local web UI
          |
          v
Local application service
  |       |          |
  |       |          +--> Execution and repository adapters
  |       +-------------> Agent provider adapters
  +---------------------> SQLite database (WAL mode)
                              |
                              +--> append-only audit events
```

The UI never calls model providers directly. The local service owns credentials, authorization checks, orchestration, normalization, and database transactions.

SQLite is the initial system of record because the product is local-first and write contention is expected to be low. Use WAL mode, foreign keys, short transactions, a busy timeout, indexed foreign keys, and explicit migrations. Keep the database on a local disk.

Agent and execution adapters receive only the context and permissions needed for the current operation. They do not receive unrestricted SQL access.

## Core Data Entities

| Entity | Purpose |
| --- | --- |
| `projects` | Project-neutral workspace and repository configuration |
| `work_items` | Recursive milestones, slices, sub-slices, and planning items |
| `work_item_links` | Dependencies, splits, supersession, and cross-project relationships |
| `discussions` | Durable rooms attached to a work context |
| `participants` | Humans, agents, and system actors |
| `discussion_participants` | Role, permissions, and speaking policy within a room |
| `messages` | Attributed human and agent contributions |
| `agent_runs` | Provider request, model, timing, usage, and outcome metadata |
| `planning_points` | Proposed or accepted questions, decisions, risks, and other structured points |
| `point_sources` | Traceability from a point to messages or artifacts |
| `work_packages` | Stable package identity |
| `work_package_versions` | Immutable approved scope and acceptance contract |
| `approvals` | Explicit owner authorization events |
| `execution_runs` | Dispatch and execution lifecycle |
| `evidence` | Verifiable outputs mapped to criteria |
| `review_findings` | Review results and proposed follow-ups |
| `acceptance_events` | Owner acceptance, rejection, change request, or waiver |
| `audit_events` | Append-only material state changes and actor attribution |

SQLite full-text search can index discussion messages and structured summaries without making remote search a prerequisite.

## Provider-Neutral Agent Contract

Every adapter normalizes provider-specific behavior into:

```text
AgentRequest
  discussion_id
  participant_id
  mode
  instructions
  relevant_context
  visible_messages
  requested_output_contract
  tool_permissions
  budget

AgentContribution
  run_id
  participant_id
  provider
  model
  content
  contribution_type
  citations_or_artifacts
  proposed_points
  usage
  status
```

Agents do not literally connect their consumer chat products to one another. The Workbench orchestrator calls supported provider or local-agent interfaces, records each contribution, and supplies the appropriate contributions to subsequent rounds.

## Performance Targets

- Local navigation response: under 100 ms at the 95th percentile.
- Local mutations: visible optimistically and committed under 150 ms at the 95th percentile.
- Search response for a typical personal database: under 200 ms.
- Application usable before any provider connection completes.
- Agent output streamed as it arrives; remote model latency never blocks unrelated navigation.
- Long work runs survive UI restart and reconnect from durable state.
- No full discussion transcript is repeatedly sent when a smaller context bundle is sufficient.

These are product targets and must be measured with representative data before being treated as achieved.

## Security and Trust Boundaries

- Store provider credentials in the operating-system credential store or protected environment, never in SQLite rows or browser storage.
- Bind the application service to localhost by default.
- Treat LAN or remote access as a separately enabled capability with real authentication.
- Allowlist repository roots per project.
- Validate every execution request against the approved package version and workspace.
- Require separate approval for destructive or unusually broad commands.
- Keep raw secrets and hidden reasoning out of messages, evidence, and audit records.
- Record provider, model, tools, and actor for every material agent contribution.
- Redact sensitive context before sending it to a provider when policy requires.

## Relationship to the Existing Prototype

The current Google Sheets and Codex relay remains valuable evidence and reusable integration work.

Keep:

- Explicit planning versus execution approval.
- Stable identifiers and idempotent commands.
- Append-only activity and attribution.
- Workspace allowlists.
- Codex App Server integration experiments.
- Clear online, working, error, and preserved-history states.

Change:

- SQLite becomes authoritative instead of Google Sheets.
- The product becomes project-neutral.
- Discussion moves into the Workbench and becomes structured.
- Multiple provider agents can participate through adapters.
- Work-package versions, evidence, review, and acceptance become first-class entities.

Google Sheets can later return as an import, export, or reporting adapter. It should not constrain the primary schema or interaction model.

## Build Sequence

Delivery follows the feature-and-milestone policy in `AGENTS.md`. Each phase below becomes one or more small vertical milestones only after its design authority, blocking questions, acceptance criteria, and owner approval are recorded. A heading here is product sequencing, not implementation authorization.

### Foundation

- Local application shell and fast navigation
- SQLite migrations, repositories, transactions, and audit events
- Project registration and allowlisted repository roots
- Work-item hierarchy and stable IDs

### Discussion Loop

- Discussion rooms and messages
- Participant configuration
- OpenAI and Anthropic adapters
- Direct and independent panel responses
- Planning-point capture and owner disposition

### Approval Loop

- Work-package assembly from accepted points
- Immutable versions and explicit owner approval
- Scope-difference view between versions

### Execution Loop

- Codex implementation adapter
- Durable run state and streamed activity
- Command and file-change approval handling
- Evidence capture

### Review and Acceptance Loop

- Independent reviewer assignment
- Findings and proposed follow-ups
- Evidence-to-criterion mapping
- Owner acceptance and change requests

### Expansion

- Portfolio and Today views across many projects
- GitHub integration
- Google Sheets import/export
- Additional providers and local models
- Rich reporting and policy configuration

## First Design Validation

Before expanding the system, use one real slice from a large application and verify that the owner can:

1. Reach a better decision through two-agent discussion.
2. See and resolve the individual points that mattered.
3. Approve a package without ambiguity about scope.
4. Follow execution without reading raw agent logs.
5. Evaluate evidence against acceptance criteria.
6. Create follow-up work without accidentally authorizing it.
7. Reconstruct why the final decision and implementation occurred.

If that loop is not substantially clearer and faster than using separate chat, planning, and coding tools, the product has not yet proven its value.
