# Planning Loop Open Questions

## Blocking

No owner product decision blocks the implementation. Route-scoped pending-input recovery is implemented and executed. The durability boundary below is recorded for an explicit owner decision; it is not answered silently.

## Awaiting Owner Decision

- **Should unsent planning input survive a full page reload or a browser process interruption?**

  Milestone 1 recovers unconfirmed input only inside the running browser session. An unconfirmed message, capture, replacement, package edit, or planning-room title is held in memory, bound to its project and planning room, restored when the owner returns to that exact route, and resubmitted under the original request-bound idempotency key so a lost receipt cannot create a duplicate durable record. A full page reload or a browser restart discards unsent input; only durable records reload from SQLite, which is what the approved milestone design and the feature path map require.

  Making unsent input survive a reload requires either a durable service-side draft record or an explicitly approved browser-storage policy. Neither is approved, `AGENTS.md` constrains what may be written to browser storage, and a draft holds owner planning content, so this is a product decision rather than an implementation detail an agent may choose. The executed boundary is asserted by the `unconfirmed-input-recovery` Playwright specification, which types an unsent draft, reloads, and confirms durable state returns while the unsent draft does not.

## Deliberately Deferred

- Which Anthropic credential mechanism and model should power live Claude contributions?
- Which bounded multi-agent modes should follow direct contribution: independent panel, challenge, or synthesis?
- Should repository roots be selected through a native folder picker or typed and validated by the local service?
- What minimum mobile width should a later responsive milestone support?
- Which execution adapter and additional approval boundary should consume `READY_FOR_EXECUTION` packages?

These questions do not change or authorize Milestone 1 scope.
