# Andamento Session Handoff

Updated 2026-08-15 after merging the planning-loop work to `main` and retiring its branch.

## Established

- `main` is the only branch. `feature/planning-loop-m1` was fast-forwarded onto it with all commits intact and then deleted locally and on GitHub; draft PR [#1](https://github.com/jmiedreich-ux/Andamento/pull/1) closed itself as merged. Nothing was squashed or lost.
- The working loop is: register a project → open a planning room → gather owner, Claude, Codex, and imported contributions → capture source-linked planning points → decide each one → assemble accepted points into a package → approve one exact version → dispatch it → read or revert what changed.
- **Planning loop.** Owner authority, source lineage, append-only approval events, and immutable approved versions are enforced in the service and again by SQLite triggers.
- **Unconfirmed input recovery.** A mutation ending in `REQUEST_UNCONFIRMED` holds one route-scoped record per operation slot, re-snapshotted on every route exit, reconciled against durable state before restoring, and resubmitted under the original idempotency key. It never crosses a project or room boundary, and it is written through to SQLite so a full reload or a service restart cannot discard it.
- **Package execution.** Dispatch is a separate owner act after approval. It reads the allowlisted repository, produces a unified diff recorded as immutable evidence, and applies it. Every touched file is snapshotted first, so Revert restores the exact prior state without requiring git.
- **Live Claude.** `Ask Claude` calls the Anthropic Messages API through `@anthropic-ai/sdk`, defaulting to `claude-opus-5` and overridable with `ANDAMENTO_ANTHROPIC_MODEL`. The credential is read from a gitignored `.env` at startup and never reaches SQLite, logs, audit records, or the browser.
- **Agent-proposed points.** A participant reads one contribution and proposes typed candidates. A candidate carries no disposition and no authority; it becomes a planning point only when the owner captures it, through the same path as text the owner typed, and the resulting point starts PROPOSED. Capture and dismissal are one-way and recorded.
- **Home view.** The root route answers one cross-project question: what is waiting on the owner? Undecided points, draft packages with their missing sections, approved-but-never-dispatched versions, and stopped work not yet retried.
- Local gates on `main`: `npm test` **86/86**, `npm run test:e2e` **10/10**, `npm audit --audit-level=high` **0 vulnerabilities**, **25** runtime invariants passing. Eight ordered migrations.
- Working style, set by the owner on 2026-08-15: coding first, minimal process. Commit at a completed slice rather than after every edit. Do not gate routine local work behind git.

## Known Incomplete Work

1. Execution has been proved against the live Codex bridge on a scratch repository, not yet on a large real one.
2. `Ask Claude` has no execute capability, so Claude can recommend and challenge but cannot produce a change set.
3. No independent review covers the execution, apply/revert, Claude, or home-view work. The earlier review round covered a superseded commit.
4. The Impeccable detector ran exactly once, long before the current UI. It must **not** be rerun; use a bounded critique or finish review.

## Assumed

- The product remains local-first and single-owner, while preserving participant, provider, and source attribution.

## Deliberately Deferred

- Multi-agent rounds, remote sync, authentication, mobile support, and CI. CI is **NOT CONFIGURED**; local validation is the gate.

## Decided 2026-08-15

- Unsent planning input **does** survive a full page reload and a service restart. Held input is written through to SQLite (`input_drafts`, migration 007) rather than browser storage, and is retired by the same transaction that makes its input durable.
- `@anthropic-ai/sdk` is adopted as the project's first runtime dependency. The SDK owns the wire contract, retries, and typed errors; the adapter owns how a response or failure becomes a durable record.

## Exact Next Action

Pick the next capability from the backlog in `PROJECT_STATUS.md` and build it on `main`.
