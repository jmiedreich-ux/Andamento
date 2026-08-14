# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated by the owner for the Night 1 build: a dependency-light local web application using Node.js 24 ECMAScript modules, the Node HTTP surface, built-in `node:sqlite`, standards-based HTML/CSS/JavaScript, and Playwright for browser acceptance. The service and UI remain separated so a later client framework can be adopted without changing the domain or database contracts.

## Users

The primary user is the product owner of one or more large software projects. They spend their time brainstorming, resolving product and system decisions, shaping milestones and slices, authorizing bounded work, reviewing evidence, and giving final acceptance rather than writing most implementation code themselves.

## Product Purpose

Andamento turns planning discussion involving humans and multiple AI agents into traceable planning points and explicit, versioned work authorization. Success means the owner can move from an ambiguous conversation to a bounded package without losing the reasoning, attribution, dissent, or approval boundary that produced it.

## Positioning

Chat products preserve conversation but do not govern authorization; project trackers preserve tasks but lose the reasoning that created them. Andamento keeps discussion attached to durable decisions and makes human approval—not agent consensus—the transition into authorized work.

## Operating Context

- Local-first operation across unrelated software projects and allowlisted repository roots.
- Focused planning rooms containing owner messages, invited agent contributions, imported external-agent contributions, and source-linked planning points.
- Small, independently useful milestones with implementation evidence, separate UI QA, independent review, and owner acceptance.
- Routine work is local; GitHub is used only at an explicit publication or review checkpoint.

## Capabilities and Constraints

- SQLite in WAL mode is authoritative and is accessed only through the localhost application service.
- Participants and provider adapters remain provider-neutral while preserving provider and model attribution.
- Discussion messages are context. Planning points begin as proposals. Only the owner may disposition points or approve a work-package version.
- Approval events are append-only, and approved package versions are immutable.
- Secrets never enter source files, SQLite, browser storage, logs, screenshots, or audit events.
- Night 1 supports desktop web from 1024 by 768 through 1920 by 1080. Mobile support is deliberately deferred.

## Brand Commitments

- The owner-approved product name is **Andamento**, referring to the visual flow created by arranging individual pieces in a mosaic.
- The interface must be unmistakably different from VennuSign, Google Sheets, and earlier workbench prototypes.
- The work and the owner's decisions remain visually primary. AI identities and chat controls are supporting elements.
- The product expresses continuity and lineage without literal mosaic-tile decoration.

## Evidence on Hand

- `PRODUCT_DESIGN.md` contains the owner-reviewed product direction and authority model.
- The earlier relay and Apps Script implementations are behavioral and integration evidence only.
- No customer claims, production benchmarks, final logo, or approved external brand assets exist and none may be fabricated.

## Product Principles

1. Work before AI.
2. Agents propose; the owner decides.
3. Approval is explicit, immutable, and traceable to its sources.
4. Local interactions remain fast and usable without provider connectivity.
5. History and attribution survive revision.

## Accessibility & Inclusion

Required actions are keyboard operable and visibly focused. Status is conveyed with text or shape in addition to color. Relationships and validation feedback use accessible names and announcements. Supported desktop widths must retain every necessary action without clipping or horizontal page overflow.
