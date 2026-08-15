# Planning Loop Open Questions

## Blocking

No owner product decision blocks the implementation. Route-scoped pending-input recovery is implemented and executed. The durability boundary below is recorded for an explicit owner decision; it is not answered silently.

## Decided

- **Should unsent planning input survive a full page reload or a browser process interruption?** **Yes**, decided 2026-08-15. Held input is written through to the local service and stored in SQLite (migration 007, `input_drafts`), not in browser storage: SQLite is already the authoritative store, and a durable record also survives a service restart and a different browser window. A draft is undurable working text, never an authority record - it carries no disposition, approval, or lineage, and is retired by the same transaction that makes its input durable. Asserted by the `unconfirmed-input-recovery` Playwright specification and proved by inversion.
- **Should the project adopt `@anthropic-ai/sdk`?** **Yes**, decided 2026-08-15. It is the project's first runtime dependency, which supersedes the dependency-light note in `PRODUCT.md` for provider adapters. The SDK owns the wire contract, retries, and typed errors; the adapter owns how a response or failure becomes a durable planning record.

## Deliberately Deferred

- Which Anthropic credential mechanism and model should power live Claude contributions?
- Which bounded multi-agent modes should follow direct contribution: independent panel, challenge, or synthesis?
- Should repository roots be selected through a native folder picker or typed and validated by the local service?
- What minimum mobile width should a later responsive milestone support?
- Which execution adapter and additional approval boundary should consume `READY_FOR_EXECUTION` packages?

These questions do not change or authorize Milestone 1 scope.
