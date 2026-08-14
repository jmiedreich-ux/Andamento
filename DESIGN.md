---
name: Andamento
description: "An architectural tracing-table interface for traceable planning and explicit owner approval."
colors:
  mineral-ground: "#e9ece6"
  ground-deep: "#d7dbd2"
  trace-paper: "#fbfbf5"
  trace-layer: "rgb(250 250 243 / 88%)"
  graphite: "#232923"
  graphite-soft: "#596159"
  rule: "#aeb4aa"
  rule-strong: "#747c73"
  lineage-plum: "#684176"
  lineage-plum-soft: "#ebe3ed"
  owner-chartreuse: "#d8ed31"
  owner-deep: "#556100"
  owner-action-ink: "#202500"
  owner-hover: "#e2f447"
  brick: "#a83f39"
  brick-soft: "#f5e4e1"
  amber: "#876c00"
  amber-soft: "#f1edcf"
  focus-violet: "#6650a1"
typography:
  display:
    fontFamily: '"Bahnschrift", "Bahnschrift SemiCondensed", "Arial Narrow", "Segoe UI", sans-serif'
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.018em"
  headline:
    fontFamily: '"Bahnschrift", "Bahnschrift SemiCondensed", "Arial Narrow", "Segoe UI", sans-serif'
    fontSize: "1.22rem"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.018em"
  title:
    fontFamily: '"Bahnschrift", "Bahnschrift SemiCondensed", "Arial Narrow", "Segoe UI", sans-serif'
    fontSize: "1.03rem"
    fontWeight: 680
    lineHeight: 1.2
    letterSpacing: "-0.018em"
  body:
    fontFamily: '"Bahnschrift", "Bahnschrift SemiCondensed", "Arial Narrow", "Segoe UI", sans-serif'
    fontSize: "0.91rem"
    fontWeight: 400
    lineHeight: 1.48
    letterSpacing: "normal"
  label:
    fontFamily: '"Cascadia Mono", "Consolas", monospace'
    fontSize: "0.68rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "0.055em"
rounded:
  square: "0px"
  control: "2px"
  round: "50%"
spacing:
  micro: "5px"
  field: "6px"
  tight: "8px"
  control: "12px"
  station: "14px"
  section: "18px"
  sheet: "24px"
components:
  button-default:
    backgroundColor: "{colors.trace-paper}"
    textColor: "{colors.graphite}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
    height: "34px"
  button-primary:
    backgroundColor: "{colors.owner-chartreuse}"
    textColor: "{colors.owner-action-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
    height: "34px"
  button-primary-hover:
    backgroundColor: "{colors.owner-hover}"
    textColor: "{colors.owner-action-ink}"
    rounded: "{rounded.control}"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.graphite}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
    height: "34px"
  text-field:
    backgroundColor: "{colors.trace-paper}"
    textColor: "{colors.graphite}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "9px 10px"
  tab-active:
    backgroundColor: "{colors.lineage-plum-soft}"
    textColor: "{colors.graphite}"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
    height: "42px"
  trace-container:
    backgroundColor: "{colors.trace-layer}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.control}"
  package-sheet:
    backgroundColor: "{colors.trace-paper}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.square}"
    padding: "16px 18px 18px"
---

# Design System: Andamento

## Overview

**Creative North Star: "The Lineage Table"**

Andamento is an architect's tracing table for consequential planning: a light mineral work surface where translucent paper, ruled stations, registration marks, and a continuous lineage spine make every transformation inspectable. Its density is purposeful and operational. Discussion, owner decisions, and the package remain visibly related instead of dissolving into a chat feed or a stack of generic cards.

The visual hierarchy gives the work and the owner's next decision priority over provider identity. Graphite establishes the instrument-like structure, muted plum carries provenance, and acid chartreuse appears sparingly where owner authority or approved readiness must be unmistakable. The result remains recognizably Andamento in grayscale and with the product name hidden; it does not borrow the dark shell, spreadsheet silhouette, typography, or component language of earlier interfaces.

**Key Characteristics:**

- A light mineral ground with translucent paper stations and sparse physical grain.
- An asymmetric discussion–lineage–decision composition built around one continuous source trace.
- Graphite rules and clipped paper corners instead of generic rounded cards.
- Chartreuse reserved for owner authority and affirmative package state.
- Condensed UI type paired with restrained monospaced metadata.

## Colors

The palette behaves like drafting media: quiet mineral neutrals carry long work sessions, plum traces provenance, chartreuse marks human authority, and brick or amber isolate refusal and attention states.

### Primary

- **Owner Chartreuse** (#d8ed31): Fills primary actions, accepted state marks, ready-state bands, and the owner's square actor mark.
- **Owner Deep** (#556100): Supplies borders and text wherever chartreuse needs a legible authority edge.
- **Owner Action Ink** (#202500): Keeps text on the brightest authority controls dark and stable.
- **Owner Hover** (#e2f447): Brightens only an already-authoritative action under pointer hover.

### Secondary

- **Lineage Plum** (#684176): Carries source roles, capture seams, selected tabs, registration marks, and undecided lineage nodes.
- **Lineage Plum Soft** (#ebe3ed): Provides the translucent-looking wash behind captured edits, active agent modes, and source nodes.

### Tertiary

- **Brick** (#a83f39): Marks explicit refusal or failed work.
- **Brick Soft** (#f5e4e1): Gives refusal and failure states a quiet field.
- **Amber** (#876c00): Marks unavailable capability, deferment, warning, and recoverable attention.
- **Amber Soft** (#f1edcf): Gives warning and deferment states a quiet field.
- **Focus Violet** (#6650a1): Draws the universal keyboard focus outline; it is deliberately distinct from workflow status colors.

### Neutral

- **Mineral Ground** (#e9ece6): Carries the drafting surface.
- **Ground Deep** (#d7dbd2): Separates inset package and fallback regions.
- **Trace Paper** (#fbfbf5): Forms opaque sheets and controls.
- **Trace Layer** (rgb(250 250 243 / 88%)): Forms lightly translucent working stations over the ground.
- **Graphite** (#232923): Carries primary content and structural rules.
- **Graphite Soft** (#596159): Carries secondary metadata.
- **Rule** (#aeb4aa): Builds internal dividers.
- **Rule Strong** (#747c73): Marks station boundaries and consequential edges.

**The Authority Mark Rule.** Chartreuse identifies owner authority or a consequential affirmative transition; it never identifies agent activity.

**The Redundancy Rule.** Every status pairs color with a word and a distinct mark, so no workflow meaning depends on hue alone.

## Typography

**Display Font:** Bahnschrift with Bahnschrift SemiCondensed, Arial Narrow, Segoe UI, and sans-serif fallbacks

**Body Font:** Bahnschrift with the same condensed-to-system fallback chain

**Label/Mono Font:** Cascadia Mono with Consolas and monospace fallbacks

**Character:** The condensed UI stack reads like a precise workshop instrument without becoming a technical console. Monospaced metadata is deliberately smaller and rarer, used for registration labels, versions, counts, source coordinates, timestamps, and state names.

### Hierarchy

- **Display** (Bahnschrift, weight 700, 2rem, line-height 1.05): Limited to project registration and onboarding titles.
- **Headline** (Bahnschrift, weight 700, 1.22rem, line-height 1.15): Introduces empty states and major station-level concepts.
- **Title** (Bahnschrift, weight 680, 1.03rem, line-height 1.2): Carries station titles, room rows, and package headings within dense work surfaces.
- **Body** (Bahnschrift, weight 400, 0.91rem, line-height 1.48): Carries contribution and instruction copy, with contribution text held to a readable measure of roughly 72 characters.
- **Label** (Cascadia Mono, weight 650, 0.68rem, line-height 1.2): Uses uppercase for registration and field metadata; sentence-case monospaced text remains conversational.

**The Workhorse Rule.** Condensed UI type carries the work; monospaced type identifies coordinates and state but never takes over paragraphs or primary decisions.

## Layout

The application uses a 58-pixel registration header above a viewport-height drafting surface. At 1280 pixels and wider, the workspace is an asymmetric 54% discussion trace, 8% lineage spine, and 38% owner station; the owner station itself stacks the decision ledger over the package. Stations use ruled heads, independent vertical scrolling, and sticky package actions so long data never hides the next governing action.

From 1024 through 1279 pixels, discussion and lineage remain beside a tabbed right station; metadata and compact action labels progressively reduce near 1090 pixels. At 1023 pixels and below, the implementation exposes a compact-layout notice and stacks discussion, horizontal lineage, and the tabbed owner station. Below 640 pixels the registration header becomes two rows and forms collapse to one column. This compact reflow preserves browser-zoom access down to the 320-pixel minimum, but it is not a mobile product commitment.

Spacing follows a tight drafting rhythm: the frontmatter scale moves from five- and six-pixel internal separations through eight- to fourteen-pixel control/station spacing, then eighteen- and twenty-four-pixel section spacing. Onboarding and project-register sheets widen the rhythm for deliberate setup, while the active workspace remains dense.

**The Visible Lineage Rule.** Never replace the source spine or package context with an opaque modal; navigation changes the active station while provenance stays reachable.

## Elevation & Depth

Depth is structural rather than atmospheric. Most working surfaces remain flat and are separated by graphite rules, tonal paper layers, translucency, and independent scroll planes. A medium paper lift is reserved for freestanding registration sheets and the package sheet; station, header, junction, and authority-action shadows are shallower. The paper-grain PNG is tiled at very low opacity with multiply blending and has no contrast or information role.

### Shadow Vocabulary

- **Paper Lift** (`0 8px 22px rgba(35, 41, 35, 0.15), 0 2px 5px rgba(35, 41, 35, 0.12)`): Lifts onboarding, project-register, and package sheets from the mineral ground.
- **Registration Lift** (`0 3px 12px rgba(35, 41, 35, 0.08)`): Keeps the registration strip distinct while content scrolls.
- **Station Lift** (`0 3px 12px rgba(35, 41, 35, 0.07)`): Separates working trace from the ground without producing cards.
- **Junction Pin** (`0 2px 5px rgba(35, 41, 35, 0.12)`): Gives lineage nodes the feel of pinned source coordinates.
- **Authority Action** (`0 4px 10px rgba(85, 97, 0, 0.18)`): Identifies primary and approval actions.

**The Paper-Stack Rule.** Add depth only when one implemented sheet or control must sit above another; routine rows and sections stay flat and ruled.

## Shapes

The system is predominantly rectilinear: controls use a restrained two-pixel corner, tabs and ruled bands are square, and large paper sheets clip one upper-right corner instead of adopting a generic rounded-card silhouette. Registration and project sheets use a 22-pixel cut; package sheets use an 18-pixel cut.

Circles have semantic work. Source and accepted-point junctions are round; proposed points are dashed squares, owner contributions use a filled square, imported contributions use a rotated square, and rejected or superseded states use a cross. The 94-pixel double-ring owner seal is the sole ceremonial circle and always sits beside explicit approval text.

**The Instrument Rule.** Geometry must identify source, actor, disposition, or authority; decorative blobs, pill containers, and arbitrary rounding do not belong on the tracing table.

## Components

### Buttons

- **Shape:** Compact rectangular controls use the control radius and a minimum 34-pixel height; active press moves down by one pixel.
- **Primary:** Chartreuse with dark owner-action ink and a restrained authority shadow; it is used for creation, confirmation, and package progression.
- **Hover / Focus:** Primary hover brightens the chartreuse. Every variant receives the same three-pixel focus-violet outline with a two-pixel offset.
- **Default / Text:** Default actions are paper controls with graphite borders. Text actions remove the resting border and background but regain a quiet ruled surface on hover.

### Cards / Containers

- **Corner Style:** Working stations and trace bands are square-to-two-pixel structures; freestanding sheets use clipped upper-right corners.
- **Background:** Stations use the trace layer, rows use a lighter trace-paper wash, and package regions sit on the deeper mineral ground.
- **Shadow Strategy:** Only freestanding sheets and major planes use the vocabulary in Elevation & Depth.
- **Border:** One-pixel rules organize content; two-pixel graphite rules mark station or package boundaries.
- **Internal Padding:** Dense stations use the control and station steps; sheet content uses section and sheet steps.

### Inputs / Fields

- **Style:** Native text inputs, textareas, and selects use a one-pixel strong rule, trace-paper field, control radius, and compact inset padding.
- **Focus:** The universal focus-violet outline sits outside the control and does not replace its border.
- **Error / Disabled:** Validation remains inline and preserves valid input; disabled controls retain their shape and label at reduced opacity.

### Navigation

The slim registration header combines brand mark, project selector, room return, local status, and one square icon action. At narrower widths the room return moves into the discussion head, and the owner station exposes native tab semantics with a plum bottom rule on the active tab. Links retain an underline or ruled-button silhouette rather than masquerading as cards.

### Discussion Trace

Contributions are ruled horizontal bands, not chat bubbles. A narrow byline column carries actor, provider, model, and time; readable content occupies the center; source capture remains a compact edge action. Owner, imported, running, and failed contributions change their mark, wash, and explicit role label together.

### Lineage Spine

The continuous graphite spine uses labeled source nodes, child point nodes, package-membership rings, and a terminal package block. Every visual relationship is duplicated in the control's accessible name and can move keyboard focus to the related source, decision, or package.

### Package Sheet

The package is a substantial ruled sheet with six durable sections, version history, a sticky review edge, and a separate exact-version approval checkpoint. Approved versions add a strong owner edge, read-only content, explicit readiness copy, source count, owner/time attribution, and the restrained owner seal.

## Do's and Don'ts

### Do:

- **Do** preserve the light tracing-table silhouette, asymmetric work regions, and continuous source-to-package lineage.
- **Do** keep chartreuse rare and attach it to owner authority, accepted state, or explicit readiness.
- **Do** use graphite rules, clipped paper corners, and low-opacity grain to communicate material structure.
- **Do** pair every state color with visible text, distinct geometry, and an accessible relationship or announcement.
- **Do** keep the package action reachable while long discussion, decision, and package regions scroll independently.

### Don't:

- **Don't** turn contributions into chat bubbles or make AI identity the visual center of the application.
- **Don't** replace the lineage spine or exact-version checkpoint with a generic sidebar, summary card, or modal.
- **Don't** introduce a dark console shell, spreadsheet chrome, pill-heavy controls, literal mosaic decoration, or historical interface assets.
- **Don't** use texture, transparency, color, or the owner seal as the only proof of meaning or approval.
- **Don't** imply mobile product support from the compact browser-zoom safety reflow.
