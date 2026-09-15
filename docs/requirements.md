# MarkNow — Software Requirements Specification

**Version:** 1.0 · **Date:** 2026-07-24 · **Status:** Approved (decisions locked with product owner)

---

## 1. Overview

MarkNow is a **web-based, local-first WYSIWYG markdown editor**. It gives one document three synchronized views:

1. **Raw mode** — a code editor for the markdown source with a live preview column.
2. **WYSIWYG mode** — a Google-Docs-like rich editing experience that reads and writes markdown.
3. **Dual mode** — raw source on the left, WYSIWYG on the right, editing the same document live.

The product serves developers and non-technical writers equally: writers get a friendly rich editor that never shows them syntax; developers get a first-class source editor — and both always work on the same plain `.md` file that the user owns on disk.

**Product principles**

- **The markdown text is the single source of truth.** Every mode is a projection of it; what raw mode shows is exactly what is saved.
- **Users own their files.** Real `.md` files on the user's disk; no server, no account, fully offline-capable.
- **No data loss, ever.** Continuous local drafts guard every keystroke between explicit saves.
- **One grammar everywhere.** A single markdown parser configuration drives the raw highlighting, the preview, and the WYSIWYG editor, so a document can never render differently between modes.

## 2. Goals and non-goals

### Goals (v1)

- Polished editing in all three modes for the full supported markdown flavor (§6).
- Local-first document lifecycle: open/save real files, drafts, crash recovery, version snapshots.
- Google-Docs-grade WYSIWYG interactions: toolbar, bubble menu, slash commands, drag handles.
- Responsive: full experience on desktop; fully usable single-pane experience on phones/tablets.
- Offline-capable PWA.

### Non-goals (v1) — explicitly out of scope

| Excluded | Reason | Revisit |
|---|---|---|
| Real-time collaboration | Product decision (stated up front) | — |
| Comments / annotations | Requires sidecar data + anchor tracking; large scope | v2 candidate |
| Track changes / suggestions | Same sidecar problem plus diff UX | v2 candidate |
| Publish / share to web | Conflicts with no-server decision | v2 candidate |
| Cloud sync / accounts | v1 is local-first; storage layer is built behind an interface so sync can be added without rewrite | v1.x/v2 |
| Multi-tab, folder workspace | Single-document v1; shell designed so tabs can be added later | v1.x |
| Plugin/extension API | Premature before internals stabilize | v2 |

## 3. Users and personas

| Persona | Description | What they need |
|---|---|---|
| **Dev writer** | Writes READMEs, docs-as-code, technical notes; lives in editors and git | Fast raw mode, GFM fidelity, predictable serialization, keyboard-first |
| **Non-technical writer** | Drafts articles, meeting notes, content; knows Google Docs, not markdown | WYSIWYG that never leaks syntax, familiar toolbar/shortcuts, zero setup |
| **Hybrid** | Technical writer / PM; switches between structure work and source tweaks | Instant mode switching, dual mode, outline navigation |

Defaults follow the "both audiences equally" decision: **WYSIWYG is the default mode for new users; the last-used mode is remembered per device.**

## 4. Decision log

Decisions made interactively with the product owner on 2026-07-24. These are binding for v1.

| # | Topic | Decision | Rationale / rejected alternatives |
|---|---|---|---|
| D1 | Storage | **Local-first**: File System Access API (Chromium) + open/download fallback elsewhere; IndexedDB for drafts, recents, snapshots. Storage behind a provider interface for future cloud sync. | Rejected: in-app-only library (users don't own files), cloud app (doubles scope), drive-sync (OAuth complexity) |
| D2 | Document scope | **Single document** at a time + recent-files list; shell leaves room for tabs later | Rejected for v1: multi-tab, folder workspace |
| D3 | Audience | **Developers and writers equally**; WYSIWYG default, last mode remembered | — |
| D4 | Mobile | **Responsive, desktop-first**: single-pane with mode switcher on small screens; dual mode desktop-only | Rejected: desktop-only, full mobile parity |
| D5 | Markdown flavor | CommonMark + **GFM + Math (KaTeX) + Mermaid + frontmatter + callouts** (§6) | All selected |
| D6 | WYSIWYG UX | **Toolbar + shortcuts + autoformat, bubble menu, slash commands, drag handles** — all in scope | All selected |
| D7 | Document features | **Find & replace, outline + word count, export PDF/HTML, version snapshots** — all in scope | All selected |
| D8 | Big extras | **Images paste/drop only**; comments, track changes, publish rejected | Scope protection |
| D9 | WYSIWYG engine | **Milkdown** (ProseMirror + remark internally) | Markdown-native round-trip; official plugins cover the feature list. Rejected: Tiptap (HTML-native, custom serializer burden), Lexical (shallow markdown), raw ProseMirror (cost), CM6 live-preview hybrid (can't reach Docs feel) |
| D10 | UI framework | **React** + TypeScript | First-class bindings for all editor libs, deepest ecosystem. Rejected: Svelte, Vue, no-framework |
| D11 | Raw editor | **CodeMirror 6** | ~10× lighter than Monaco, real mobile support, first-class markdown mode. Rejected: Monaco |
| D12 | Styling/UI | **Tailwind CSS + shadcn/ui** (Radix primitives) | Accessible chrome primitives as owned code; CSS-variable theming. Rejected: Mantine/MUI, hand-rolled CSS |
| D13 | Round-trip policy | **Normalize on WYSIWYG edit**: consistent, configurable output style; raw mode never reformats | Rejected for v1: strict byte-preservation (block-level patching — v1.x candidate) |
| D14 | Image storage | **`assets/` folder beside the `.md`** (relative links, portable); automatic base64-embed fallback in non-Chromium browsers | Rejected as primary: base64-only, app-internal storage |
| D15 | Save model | **Explicit Ctrl+S** writes disk; **continuous IndexedDB draft** guards every change; recovery offered on reopen | Rejected: silent autosave-to-disk (v1.x opt-in toggle candidate) |

Supporting stack (architect's picks, owner informed): Vite, TypeScript strict, unified/remark/rehype pipeline, Zustand, Dexie, vite-plugin-pwa, Vitest + Playwright.

## 5. Functional requirements

Requirement IDs are stable and referenced by the implementation plan. "Must" = v1 release blocker.

### FR-1 Document lifecycle

- **FR-1.1** New document: opens an empty untitled doc; first save triggers save-as.
- **FR-1.2** Open: file picker for `.md`/`.markdown`/`.txt`. Chromium: File System Access API with a re-usable handle; other browsers: file input upload.
- **FR-1.3** Save (Ctrl+S): writes in place via the stored handle (Chromium). Fallback browsers: downloads the file ("Save a copy") with clear messaging that in-place save is unavailable.
- **FR-1.4** Save As (Ctrl+Shift+S) with filename suggestion.
- **FR-1.5** Recent files list (welcome screen + menu): name, path hint, last-opened time; reopens via persisted handle with permission re-prompt when required.
- **FR-1.6** Dirty state is always visible (title-bar dot); closing the tab with unsaved changes triggers the browser leave-warning.
- **FR-1.7** **Draft guard:** every change is persisted to IndexedDB within 1 s of idle. If the app reopens and the draft is newer than the file, a recovery banner offers *Restore draft* / *Discard* with a preview diff.
- **FR-1.8** Drag-and-drop of an `.md` file anywhere on the app opens it.

*Acceptance:* kill the tab mid-edit → reopen → recovery banner restores every keystroke. Save on Chromium modifies the original file in place.

### FR-2 Mode shell

- **FR-2.1** Three modes: **Raw**, **WYSIWYG**, **Dual**; switchable via segmented control in the top bar and shortcuts (Ctrl+Shift+1/2/3).
- **FR-2.2** Mode switching preserves content exactly (per D13 semantics) and keeps the reading position (best-effort cursor/scroll mapping).
- **FR-2.3** Last-used mode, theme, and layout sizes persist per device.
- **FR-2.4** Dual mode: draggable splitter (default 50/50, persisted); raw left, WYSIWYG right.
- **FR-2.5** Below the small-screen breakpoint (§9), dual mode is unavailable; the shell falls back to single-pane with the mode switcher.

### FR-3 Raw mode (CodeMirror 6)

- **FR-3.1** Markdown syntax highlighting, including nested highlighting of fenced code blocks (top ~15 languages lazy-loaded).
- **FR-3.2** Editing affordances: line numbers (toggle), active-line highlight, bracket/emphasis auto-pairing, list continuation on Enter, Tab/Shift-Tab indent for lists, multiple cursors, undo/redo.
- **FR-3.3** Preview column beside the editor (toggleable, Ctrl+Shift+P), with synchronized scrolling (§FR-4.3).
- **FR-3.4** Raw mode **never reformats** the user's text (D13). Typing and saving are byte-faithful.
- **FR-3.5** Formatting shortcuts operate on source text (Ctrl+B wraps selection in `**`), matching VS Code behavior.

### FR-4 Preview

- **FR-4.1** Renders the full flavor (§6) via the shared unified pipeline; output sanitized (§8 security).
- **FR-4.2** Updates live, debounced ≤ 250 ms after typing stops.
- **FR-4.3** Scroll sync raw↔preview, bidirectional, based on source-position mapping (not percentage).
- **FR-4.4** Preview is the styling reference: WYSIWYG mode and HTML/PDF export share its typography theme.

### FR-5 WYSIWYG mode (Milkdown)

- **FR-5.1** Full editing of the supported flavor with **no markdown syntax visible**: headings, emphasis, links (edit popover), lists, task lists, blockquotes, callouts, tables, code blocks (with language picker + highlighting), math, images, horizontal rules, footnotes.
- **FR-5.2** **Fixed toolbar**: undo/redo, block-type dropdown (paragraph/H1–H6/quote/code), bold, italic, strikethrough, inline code, link, list buttons, task list, table insert, image insert, math insert, more-menu. Reflects the current selection state. The table button opens a size grid on hover or click — sweep it, and the cell under the pointer is the table you get, rows counted from the header down (never fewer than two, since a header with nothing under it is not a table). The three list buttons are setters over one axis — bullet, numbered, task — each converting the selected items from whatever they are now, and lifting them out of the list when clicked on the kind they already are. Scope is the items the selection covers, matching the source pane (FR-3.5).
- **FR-5.3** **Keyboard shortcuts**: the Google-Docs/standard set (§9.3) plus **markdown autoformat input rules** — typing `## `, `- `, `1. `, `> `, `` ``` ``, `**bold**`, `$math$` transforms live.
- **FR-5.4** **Bubble menu** on text selection: bold, italic, strikethrough, code, link, and turn-into. Serves as the primary formatting surface on touch devices. Off by default; shown when the quick-actions preference asks for it (FR-13.3).
- **FR-5.5** **Slash commands**: `/` opens a filterable insert menu (headings, lists, table, code block, math block, mermaid, callout, image, divider…).
- **FR-5.6** **Drag handles**: hover grip per block for reordering with drop indicator; `+` affordance to insert a block below.
- **FR-5.7** **Tables**: add/remove row/column, header row toggle, column alignment, Tab navigation between cells — via a table-scoped toolbar/popover.
- **FR-5.8** **Math**: inline `$…$` and block `$$…$$` rendered with KaTeX; clicking opens a source popover editor with live preview; invalid LaTeX shows a graceful error chip.
- **FR-5.9** **Mermaid**: rendered read-only in place; click to edit source in a popover with re-render on apply.
- **FR-5.10** **Callouts** (`> [!NOTE|TIP|WARNING|IMPORTANT|CAUTION]`): rendered as styled boxes with icon; type picker; content editable inline.
- **FR-5.11** **Raw HTML blocks/inline** in the source are preserved verbatim and shown as inert, clearly-marked chips with a source-editing popover. HTML is never executed inside the WYSIWYG editor.
- **FR-5.12** **Frontmatter** never appears as body text: it is split off at the document layer and edited via a metadata panel (§FR-10.4).
- **FR-5.13** Copy/paste: pasting rich text (from Docs/Word/web) converts to markdown-backed content; copying out provides both rich text and markdown flavors.
- **FR-5.14** Undo/redo history is per-editing-session and survives mode switches (acceptable v1 simplification: history resets when the *other* pane rewrites the doc in dual mode).

### FR-6 Dual mode synchronization

- **FR-6.1** Both panes edit the same store; edits propagate to the other pane, debounced ≤ 400 ms, without focus steal, echo loops, or visible cursor jumps in the pane being typed in.
- **FR-6.2** WYSIWYG edits re-serialize through the normalization policy (D13); the raw pane therefore shows normalized markdown for edited content. Raw-pane edits never trigger reformatting of untouched text.
- **FR-6.3** Best-effort scroll sync between panes (top-level block mapping).
- **FR-6.4** A document that fails WYSIWYG parsing (pathological input) must never corrupt the store: raw remains editable, WYSIWYG shows a non-blocking error state.

### FR-7 Markdown flavor — see §6 for the normative spec

### FR-8 Images (D14)

- **FR-8.1** Paste or drag-drop an image in any editing mode inserts it at the cursor.
- **FR-8.2** Primary storage: written to `assets/` beside the document (name: `<slug>-<shorthash>.<ext>`), inserted as relative `![](assets/…)`. Requires one-time folder permission (Chromium); the permission prompt explains why.
- **FR-8.3** Fallback (no folder access / non-Chromium): embed as base64 data URI with a per-image size warning above 200 KB.
- **FR-8.4** Relative image paths in opened documents resolve and display when folder access is available; otherwise a placeholder prompts to grant access.
- **FR-8.5** WYSIWYG image UX: click to select, alt-text editing, remove; (resize is v1.x).

### FR-9 Find & replace

- **FR-9.1** Ctrl+F opens a find bar scoped to the active pane; Enter/Shift+Enter cycles matches with highlight + count.
- **FR-9.2** Replace / Replace-all (Ctrl+H) in both raw and WYSIWYG modes.
- **FR-9.3** Raw mode additionally offers regex, case-sensitivity, and whole-word toggles (CodeMirror search).

### FR-10 Outline, counts, metadata

- **FR-10.1** Collapsible outline sidebar listing the heading tree; click scrolls/jumps in the active mode; current section highlighted.
- **FR-10.2** Status bar: words, characters, reading time; selection-scoped counts when a selection exists.
- **FR-10.3** Status bar also shows: cursor line:col (raw), save state ("Saved · 2 min ago" / "Unsaved changes"), markdown flavor indicator.
- **FR-10.4** Frontmatter metadata panel: key/value editing of the YAML block (title, tags, custom); creates/removes the block; invalid YAML falls back to a raw-text editing field with an error notice.

### FR-11 Export

- **FR-11.1** Export → **HTML**: a single self-contained `.html` (inlined styles, KaTeX CSS, pre-rendered Mermaid SVG, embedded images) matching the preview typography.
- **FR-11.2** Export → **PDF**: print-quality output via a dedicated print stylesheet and the browser print-to-PDF dialog (page margins, page-break-avoid rules for code/tables, link URLs in footnotes optional).
- **FR-11.3** Copy as rich text (for pasting into Docs/Word/email).

### FR-12 Version snapshots (local history)

- **FR-12.1** Automatic snapshots to IndexedDB: on every save, and every 5 minutes while dirty. Retention: newest 50 kept verbatim, older thinned (per doc, cap ~200).
- **FR-12.2** History panel: timestamped list with trigger labels (save/auto/restore point).
- **FR-12.3** Selecting a snapshot shows a **diff view** against the current text; one-click restore (current state is snapshotted first).

### FR-13 Settings & theming

- **FR-13.1** Theme: light / dark / system, instant switch, applied across editors and preview.
- **FR-13.2** Markdown style preferences (drives D13 normalization): bullet marker (`-`/`*`/`+`), emphasis marker (`*`/`_`), fence style, list indent, rule style. Defaults: `-`, `*`, backticks.
- **FR-13.3** Editor preferences: font size, line numbers, default mode, draft-autosave interval, quick actions on selection (the FR-5.4 bubble menu; default hidden).
- **FR-13.4** All settings persist locally; a "Reset to defaults" exists.

## 6. Markdown flavor specification (normative)

Baseline **CommonMark**, extended with:

| Extension | Syntax | Raw | Preview | WYSIWYG |
|---|---|---|---|---|
| GFM tables | pipe tables | highlight | render | full editing (FR-5.7) |
| GFM task lists | `- [ ]` / `- [x]` | highlight | interactive-looking checkboxes (read-only in preview) | clickable checkboxes |
| GFM strikethrough | `~~x~~` | highlight | render | full |
| GFM autolinks | bare URLs | highlight | linked | linked |
| GFM footnotes | `[^1]` | highlight | rendered with backlinks | insert/edit |
| Math | `$…$`, `$$…$$` (KaTeX) | highlight | render | FR-5.8 |
| Mermaid | ` ```mermaid ` fence | highlight | render (lazy-loaded) | FR-5.9 |
| Frontmatter | leading `---` YAML | highlight | hidden from output | metadata panel (FR-10.4) |
| Callouts | `> [!NOTE]` GitHub/Obsidian style | highlight | styled boxes | FR-5.10 |
| Raw HTML | inline/block | highlight | sanitized render | inert chip (FR-5.11) |

**Round-trip rules (D13):**

1. Raw-mode editing and saving are byte-faithful — the app never rewrites text the user didn't touch in raw mode.
2. Any WYSIWYG edit re-serializes the document body using the style preferences (FR-13.2). Content, structure, and meaning are always preserved; syntax *style* (marker characters, spacing) is normalized.
3. Constructs the WYSIWYG cannot represent (unknown syntax, raw HTML) round-trip **verbatim** — they must never be dropped or mangled.
4. A golden-file round-trip test corpus enforces rules 2–3 in CI (see implementation plan).

## 7. Non-functional requirements

### Performance budgets (mid-range laptop, 100 KB document unless noted)

| Metric | Budget |
|---|---|
| Initial JS (gzipped, excluding lazy KaTeX/Mermaid/language chunks) | ≤ 350 KB |
| First load to interactive (cold, broadband) | ≤ 2 s |
| Keystroke → paint, raw mode | ≤ 16 ms p95 |
| Keystroke → paint, WYSIWYG | ≤ 50 ms p95 |
| Cross-pane sync visible in dual mode | ≤ 500 ms |
| Mode switch | ≤ 300 ms |
| 1 MB document | opens and remains editable (degraded preview debounce acceptable) |

### Reliability

- No user-visible data loss under: tab crash, browser close, power loss (bounded by the ≤ 1 s draft interval), failed save, or WYSIWYG parse failure (FR-6.4).
- Storage errors (permission revoked, disk full, quota) surface as actionable, non-blocking notices.

### Security & privacy

- Preview/export HTML is sanitized (allowlist schema); raw HTML never executes inside editors; KaTeX/Mermaid render without `dangerously`-style injection. No remote content is fetched by documents except explicit image URLs.
- No telemetry, no network calls required for any core function. The app is fully client-side.

### Accessibility

- Target **WCAG 2.1 AA**: complete keyboard operability (toolbar roving tabindex, focus-visible states, Esc closes overlays), ARIA roles on toolbar/menus/dialogs (via Radix), AA contrast in both themes, `prefers-reduced-motion` respected, editor regions labeled for screen readers.

### Browser support matrix

| Tier | Browsers | Experience |
|---|---|---|
| 1 | Chrome, Edge (last 2 majors), desktop | Everything incl. in-place save + `assets/` images |
| 2 | Firefox, Safari (last 2 majors), desktop | Full editing; open/"save a copy" fallback; base64 image fallback |
| 3 | iOS Safari, Android Chrome (current) | Responsive single-pane; touch formatting via bubble menu; dual mode unavailable |

### Offline (PWA)

- Installable; app shell, fonts, KaTeX assets precached; previously-used lazy chunks cached. Full functionality offline for Tier-1/2 flows.

## 8. UX specification

### 8.1 Layout — desktop

```
┌────────────────────────────────────────────────────────────────┐
│ ☰  Title (● dirty)          [ Raw | WYSIWYG | Dual ]   ⋯  🌙   │ top bar
├──────────┬─────────────────────────────────────────────────────┤
│ Outline  │  WYSIWYG toolbar (WYSIWYG/Dual only)                │
│ (toggle) ├────────────────────────┬────────────────────────────┤
│          │  Raw editor            │  Preview  (Raw mode)       │
│          │                        │  — or —                    │
│          │                        │  WYSIWYG  (Dual mode)      │
├──────────┴────────────────────────┴────────────────────────────┤
│ 1,240 words · 6 min read      L12:C4        Saved · 2 min ago  │ status bar
└────────────────────────────────────────────────────────────────┘
```

- ☰ menu: New, Open, Recent, Save, Save As, Export (HTML/PDF/Copy rich), History, Metadata, Settings.
- WYSIWYG single mode: document centered on a Google Docs sheet — a ~72ch text measure (≈6.5in at the document font) between 1in page margins, so the card comes out the width of US Letter. Margins collapse to a thumb-width gutter below 768px.
- Split columns (raw-mode preview, dual-mode WYSIWYG) fill their pane with no measure cap: the divider is the width control there, so dragging it resizes the rendered document itself (FR-2.4). The centred measure belongs to single mode, which has no divider.

### 8.2 Layout — small screens (< 768 px)

Single pane + mode switcher (Raw ⇄ WYSIWYG; no dual, preview replaces raw as a toggle). Toolbar collapses to priority actions + overflow sheet; bubble menu is the primary formatting surface; outline and menus become sheets/drawers. Virtual-keyboard-safe insets (`visualViewport`).

### 8.3 Keyboard shortcuts (v1 set)

| Action | Shortcut | | Action | Shortcut |
|---|---|---|---|---|
| Save / Save As | Ctrl+S / Ctrl+Shift+S | | Bold / Italic / Strike | Ctrl+B / Ctrl+I / Ctrl+Shift+X |
| Open / New | Ctrl+O / Ctrl+Alt+N | | Inline code | Ctrl+E |
| Mode: Raw/WYSIWYG/Dual | Ctrl+Shift+1/2/3 | | Link | Ctrl+K |
| Toggle preview (raw) | Ctrl+Shift+P | | Heading 1–3 | Ctrl+Alt+1/2/3 |
| Find / Replace | Ctrl+F / Ctrl+H | | Lists (bullet/ordered/task) | Ctrl+Shift+8/7/9 |
| Outline toggle | Ctrl+Shift+O | | Undo / Redo | Ctrl+Z / Ctrl+Y |
| Slash menu | `/` at block start | | Quote | Ctrl+Shift+B |

(macOS: Cmd equivalents.) A searchable shortcut sheet lives under ⋯ → "Keyboard shortcuts".

### 8.4 Visual design

- Clean, content-first, Docs-adjacent: neutral chrome, document surface elevated on subtle background; Tailwind Typography-derived document theme shared by preview/WYSIWYG/export.
- Light/dark via CSS variables; system font stack for UI, user-selectable content font (serif/sans/mono) is v1.x.

## 9. Release criteria (v1 definition of done)

1. All "Must" FRs pass acceptance checks on the Tier-1 matrix; Tier-2/3 pass their scoped experiences.
2. Round-trip golden corpus: 100% pass (rules in §6).
3. Performance budgets met (§7) on the reference fixture set, enforced in CI.
4. Accessibility audit (axe + manual keyboard pass) with no serious violations.
5. E2E suite green: lifecycle, all three modes, dual-mode sync, images, export, recovery flows.
6. Zero known data-loss bugs.

## 10. Roadmap after v1 (non-binding)

- **v1.x:** multi-tab · autosave-to-disk toggle (D15 alt) · strict byte-preservation via block-level patching (D13 alt) · image resize · content font options · folder workspace (explorer sidebar)
- **v2:** optional cloud sync provider behind the storage interface · comments sidecar · publish/share · plugin API
