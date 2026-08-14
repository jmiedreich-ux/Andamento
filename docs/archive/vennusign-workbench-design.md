# Historical VennuSign Workbench Design System

> Historical VennuSign artifact. This document is non-authoritative for Andamento. Do not copy its palette, typography, assets, layout, components, interaction composition, or branding into Andamento without explicit owner approval in an Andamento-specific design authority.

## Direction

Treat the Workbench as a live operations dispatch desk, not a generic chat app. The interface should feel dependable, quiet, and evidence-led: connection and workspace context are established first, conversation becomes a durable transmission log, and active Codex work stays visible until it resolves.

Use direct operational language. State what is known, in progress, failed, or preserved. Never imply completion or connectivity that the relay cannot prove. Status must use text and shape in addition to color.

## Palette

- **Slate rail:** `#102f43`; supporting rail panel `#153e54`; divider `#18516a`.
- **Light workspace:** app surface `#f7fafc`; page surround `#dce8ee`; composer band `#eef5f8`; white input/control surfaces.
- **Primary ink:** `#14283f`; body `#203b50`; secondary text `#607687` to `#718493`.
- **Signal blue:** primary/action `#087fa5`; bright activity accent `#36c2eb`; focus blue `#1967d2`.
- **Proof green:** `#43d18b` for online and `#167558` for user identity.
- **Signal amber:** `#ffbd59` as a small brand accent, not a dominant surface.
- **Failure/danger:** `#d93025`, `#b3261e`, and dark error text `#842d3b`; use pale red support surfaces.

Keep the palette light and neutral overall. Reserve saturated colors for identity, focus, actions, and semantic state. Do not introduce decorative gradients or color-only status cues.

## Typography

Use `Aptos`, with `Segoe UI` as fallback, for compact operational UI and body copy. Use the self-hosted `Vennu Display` face for the product lockup only. Default text is 14px. Conversation body copy is 15px at 1.65 line height and should remain comfortably readable up to roughly 72 characters per line.

Use compact, strongly weighted type for operational metadata. Uppercase 10px labels with modest tracking identify rail facts and the command deck. The product name is the only display-scale text: 24px desktop and 19px mobile. Avoid oversized headings and marketing-style copy.

## Layout

Desktop uses a centered shell capped at 1320px with a fixed 272px dark signal rail and a flexible light workspace. The rail spans the viewport height and contains brand, connection state, workspace facts, active-work status, and utility actions. The main log is centered at a maximum width of 820px; individual messages cap at 740px.

The chronological log is an unframed reading surface. Separate entries with fine horizontal rules and identify the actor with a compact square marker. Keep the composer anchored to the bottom in its own full-width band, aligned to the same 820px content measure. Do not wrap the primary experience in cards or nest panels for decoration.

Use stable spacing: generous 24px separation between messages, 8-14px control gaps, and 26-70px responsive desktop gutters. Corners are restrained at 6-8px. Shadows are subtle and structural, limited to the app shell, sticky composer, primary action, and modal.

## Controls

Controls are compact, rectangular, and at least 40px tall. Default buttons use white surfaces, slate-blue text, and visible borders. The primary action uses solid signal blue and sits at the end of the action row. Destructive actions use red semantics; confirmation of irreversible visible-state changes belongs in a modal.

Use familiar icons for icon-only utilities and always provide an accessible label and tooltip. Keep text buttons for explicit commands such as approve, review, stop, send, and clear. The textarea is the dominant input, with a visible border, white surface, comfortable 15px text, and vertical resize on desktop.

## States

- **Connecting:** neutral gray dot plus explicit “Connecting” text.
- **Online:** green dot with a restrained halo plus “Online.”
- **Offline:** red dot plus “Offline”; surface errors in the nearby feedback region.
- **Working:** persistent dark-rail status panel with cyan pulse and a plain-language progress summary.
- **Sending:** optimistic user message labeled “Sending,” followed by server reconciliation.
- **Error:** red actor marker, error-colored text, and actionable plain language.
- **Disabled:** preserve control shape and label, reduce opacity, and remove pointer affordance.
- **Focus:** strong visible blue/cyan outline with offset; never suppress keyboard focus.
- **Empty:** centered, muted prompt with no decorative illustration or promotional copy.

The clear-conversation dialog must state that visible messages and progress are removed while audit records remain. Maintain that distinction anywhere destructive controls appear.

## Responsive Behavior

At 760px and below, collapse the two-column shell into a single flow. Convert the rail into a compact sticky top header, hide secondary workspace facts, keep connection visible, and place utilities at the right. Active-work status expands below the header across its full width.

Fix the composer to the bottom edge with 14px side gutters and reserve enough main-content padding so messages never sit beneath it. Allow action buttons to share and wrap across the available width; remove the primary button’s desktop auto margin. Reduce message inset from 50px to 44px while retaining actor markers. Text and controls must wrap without overlap at narrow widths.

## Avoid

- Generic chat bubbles, floating card stacks, centered chatbot panels, or marketing-page composition.
- Decorative gradients, large illustrations, glass effects, excessive rounding, or ornamental animation.
- Hiding connection, work, failure, or audit-preservation state behind color or vague copy.
- Oversized type, dense prose, or controls that require training during a time-sensitive workflow.
- Unverified claims such as “complete,” “delivered,” or “online” without relay evidence.
- Desktop-only assumptions; mobile must preserve the complete command and status workflow.
