# Planning Loop Milestone 1 Design Authority

## Authority

- **Status:** Approved for implementation
- **Feature:** Planning loop
- **Milestone:** 1 — Discussion to approved package
- **Work package:** `AND-N1-PLANNING-LOOP-v1`
- **Owner approval:** The active `/goal` objective explicitly authorizes the previously bounded Night 1 planning loop and delegates implementation choices while the owner is unavailable.
- **Visitor mode:** Operate
- **Supported surface:** Local desktop web, 1024×768 through 1920×1080
- **Approved north star:** `.impeccable/mocks/planning-room-lineage-spine.png`
- **Direction seed:** `5327aabb`, assigned grounded direction 4

This authority governs Milestone 1 UI. `PRODUCT_DESIGN.md` remains broader product direction and cannot widen this milestone.

## Job, Audience, and Outcome

One software-product owner arrives with unresolved discussion and needs to turn it into an exact authorization boundary. The interface succeeds when the owner can read contributions, trace the points they create, disposition each point, review a complete package, and approve one immutable version without mistaking agent agreement for authority.

The primary evidence is not a dashboard metric. It is the visible lineage from attributed source contribution through owner decision into one package snapshot.

## Selected Direction — The Lineage Table

The visual world is an architect's tracing table: a working surface made of ruled paper, translucent trace layers, registration marks, precise source lines, and an unmistakable owner mark. It is a metaphor with a functional job—layers preserve provenance while the lineage spine makes transformation inspectable.

The approved composition uses three asymmetric regions:

1. **Discussion trace, 52–56%:** attributed contribution bands and an inline composer.
2. **Lineage spine, 7–10%:** continuous source junctions linking contributions, points, and package inputs.
3. **Decision and package station, 34–40%:** owner ledger above or beside the substantial package sheet.

At 1024 pixels, the decision ledger and package station become a tabbed right work surface while discussion and the lineage spine remain visible. The package never becomes an opaque modal over the source context.

### Direction Contract

> **THESIS:** One continuous trace proves how discussion becomes governed work; refuse the category's chat feed plus generic card sidebar.
>
> **OWN-WORLD:** Mineral drafting ground, off-white trace paper, graphite rules, muted plum lineage, acid-chartreuse owner marks, brick refusal marks, clipped paper corners, registration ticks, condensed workhorse type.
>
> **STORY:** Read attributed thinking, resolve its individual points, prepare a complete package, and place the owner's explicit mark on one version.
>
> **FIRST VIEWPORT:** Slim registration header; broad discussion trace left; narrow live lineage spine center; owner ledger and package sheet right; primary approval at the package edge.
>
> **FORM:** Architectural tracing table, grounded direction 4, seed `5327aabb`.
>
> **FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md

## Why This Direction Won

The owner's context is serious product and system planning, so the interface must feel like a place where consequential work is examined and marked. The tracing table has high audience identification and high product clarity: source layers, revisions, measurements, and a signed sheet directly support provenance and approval.

The challengers did not beat it on both required axes:

- Data-sublime black-and-white fields obscure familiar controls and read as instrumentation rather than planning.
- Nixie laboratory counters make quantities primary and recreate the dark-console silhouette explicitly excluded by the product.
- Miura deployment elegantly expresses assembly but risks literal tessellation and unfamiliar controls for routine editing.
- Cloud quarry carries transformation but turns an Operate surface into an illustrative experience.
- Pixel metropolis and cassette ephemera weaken the seriousness and reading density required here.

## Visual Independence Check

| Dimension | Historical VennuSign / Sheets / relay | Andamento authority |
| --- | --- | --- |
| Shell silhouette | Fixed dark signal rail, centered transmission log, app-wide bottom composer | Full-width light drafting surface, asymmetric workflow regions, composer contained inside discussion |
| Grayscale hierarchy | Dark shell and bright signal accents | Layered light papers, graphite rules, substantial package sheet, owner mark |
| Typography | Vennu Display plus Aptos/Segoe UI | Bahnschrift-style condensed workhorse with restrained monospaced metadata |
| Component shape | Compact control blocks, square actor markers, sheet cells | Ruled trace bands, source junctions, clipped paper corners, explicit state marks |
| Navigation | Persistent dark rail or spreadsheet tabs | Slim registration header plus contextual project/room controls |
| Discussion composition | Transmission/chat log is the application center | Discussion is one working layer whose points and package remain simultaneously visible |

The design remains distinguishable with the product name hidden and in grayscale. No historical palette, font asset, logo, layout, or component is reused.

## Information Hierarchy

1. Current package state and the owner's next required decision
2. Package completeness and exact version
3. Planning-point dispositions and unresolved items
4. Source-linked discussion content
5. Participant and provider metadata
6. Local-service and provider capability status

Agent branding never outranks contribution content. Approval uses explicit words, version, actor, and consequence—not a color-only cue.

## Navigation and Actions

### Global

- Select project
- Create project
- See local save/service status
- Return to the project's room list

### Discussion

- Create a planning room
- Add an owner contribution
- Import and attribute an external-agent contribution
- Ask Codex when available
- Retry a failed Codex run
- Capture a planning point from a contribution

### Decision ledger

- Review point type, text, source, and actor
- Accept, reject, or defer a proposed point
- Edit a proposed point by creating a replacement proposal; never rewrite decided history. Revising a decided point starts a new proposal from its attributed source.
- Filter by disposition when the list exceeds the visible region

### Package

- Prepare a draft from accepted points
- Edit required package sections
- Cancel edits back to the last durable draft
- Review an inline checkpoint naming the exact version, owner, completeness, source count, immutability, and non-execution consequence
- Confirm approval of the exact reviewed draft
- Inspect immutable version 1
- Create version 2 after approval

Milestone 1 has no delete action. Closing a transient composer or cancelling undurable field edits is reversible and needs no destructive confirmation.

## Feedback and State Treatment

- **Loading:** shaped skeleton bands preserve the final layout; no centered spinner.
- **First run:** the drafting surface teaches project registration and explains local storage.
- **Empty room:** one plain invitation to add the owner context; provider actions remain secondary.
- **Saving:** compact textual status near the affected station and a polite live-region announcement.
- **Validation:** inline rule with specific correction; valid input remains in place.
- **Agent unavailable:** explicit unavailable panel names the missing capability and keeps manual import usable.
- **Partial agent failure:** completed contributions remain; failed participant is separately attributed and retryable.
- **Stale edit:** the station pauses, shows what changed, and offers reload-and-reapply without overwriting newer data.
- **Approved:** package becomes a read-only ruled sheet with version, owner, time, and source count. A new-version action is separate.
- **Refusal:** explains why an action was refused and never clears the user's valid work.

Status always combines word and mark: proposed/dashed square, accepted/solid circle and check, deferred/clock ring, rejected/cross.

## Responsive and Overflow Rules

- At 1440 and above, all three regions remain visible.
- From 1024 to 1439, discussion plus lineage occupy the primary canvas; the right station switches between **Decisions** and **Package** with accessible tabs.
- Below 1024 remains outside Milestone 1 support, but an explicit minimum-width notice accompanies an operable compact reflow rather than hiding or clipping the application. The 320-CSS-pixel, 400%-zoom equivalent is keyboard operable without page-level horizontal overflow; this safety behavior does not establish a mobile design commitment.
- Long contributions wrap to a readable measure and can expand without horizontal scrolling.
- Long project, participant, and point names truncate visually only where the full value remains available to assistive technology and a title affordance.
- Zero, one, many, and more-than-fit rows preserve the package action and composer; inner work regions scroll independently without trapping overlays.

## Accessibility

- Native buttons, inputs, textareas, selects, headings, lists, and tab semantics are retained.
- Every control has a visible 3-pixel chartreuse/graphite focus treatment with sufficient contrast.
- Source relationships are represented in text and accessible descriptions in addition to drawn lineage paths.
- Validation, saves, agent results, conflicts, and approval are announced through scoped live regions.
- All workflow actions are keyboard complete, including tab switching and point disposition.
- Motion is limited to the active-run registration marker; reduced-motion removes that animation while preserving its textual state.
- No information depends on paper texture, transparency, color, or the decorative registration system.

## Component and Asset Inventory

| Ingredient | Required character / quantity | Medium |
| --- | --- | --- |
| Registration header | One 48–56 px ruled strip with product, project, room, local status | Semantic HTML/CSS plus small inline SVG marks |
| Discussion bands | Typically 3–12 visible; no bubbles; source labels and readable content | Semantic HTML/CSS |
| Inline composer | Multiline input, actor/import mode, cancel, submit, recovery | Semantic form controls |
| Lineage spine | One continuous rule with one junction per contribution/point; selected path emphasized | Semantic ordered lists and buttons, CSS connective rules, and exact textual relationship labels |
| Point state marks | Four distinct word-and-shape states | Inline SVG/CSS and text |
| Decision ledger | Typically 0–20 rows with owner actions and conflict feedback | Semantic list/forms |
| Package sheet | One visually substantial ruled sheet with six sections and version state | Semantic form/definition structure plus CSS |
| Owner seal | One restrained authority mark; never the only approval proof | Authored SVG with semantic adjacent text |
| Paper material | Very subtle grain across ground and sheets; never required for contrast | Produced raster texture with flat-color fallback |
| Registration/tape details | Sparse, functional edge alignment only | Authored CSS/SVG; no decorative collage |
| Icons | Small set for project, source, retry, status, and version actions | Authored inline SVG with consistent 1.75–2 px stroke |
| Primary approval | Full-width package-edge review action followed by an inline exact-version confirmation checkpoint | Semantic buttons and definition-list facts in the world's rule/owner-mark grammar |

## Data, API, and Authority Support

The UI requires service-owned endpoints for projects, discussions, messages, provider runs, planning-point capture/disposition, package drafting/versioning, and approval. Every mutation carries an idempotency key; mutable records also carry an expected version. Conflict responses include current durable state for recovery.

The browser receives no SQLite handle or provider credential. Actor role comes from the local application session; provider adapters can create attributed contributions but cannot call owner disposition or approval operations. Approval records the exact immutable package snapshot and owner event in one short transaction.

## Explicit Non-Goals

- No mobile visual system
- No dark theme
- No literal mosaic decoration
- No multi-project dashboard
- No package execution controls
- No autonomous agent debate controls
- No reused VennuSign assets or implementation markup
