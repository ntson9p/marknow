# MarkNow WYSIWYG UX findings

A worklog from a WYSIWYG audit pass, kept because the measurements and the reasoning are
worth more than the conclusions. **Most of it is already fixed** — the status table below
is authoritative; the numbered entries that follow are the original notes, preserved as
written so the diagnosis stays readable next to the fix.

| # | Finding | Status |
|---|---|---|
| 1 | Nested-list indent costs 12px where sibling gaps cost 4px | Fixed — `9f115d0` |
| 2 | Backspace on a solo list item needs two presses | Retracted — harness artifact |
| 3 | Callout title offset from its icon | Fixed — `05b93a3` |
| 4 | Tab in a code block ejects focus from the editor | Fixed — `c40e342` |
| 5 | No way to add content after a trailing code block | Fixed — `7002274` |
| 6 | Enter in a table cell jumps past the whole table | Fixed — `411a2a6` |
| 7 | "Add row" and "Delete row" live on separate handles | **Open** (low) |
| 8 | Block math input rule never fires on `$$` + space | Fixed — `7b25192` |
| 9 | Live-typed mermaid fence renders only after a mode round-trip | **Open** (low) |
| 10 | Toolbar-inserted image overlaps adjacent text | Retracted — mismeasured |
| 11 | Live-typed nested list emits a spurious blank line | Fixed — `0bfa380` |

Every fix above carries a regression test; see `tests/e2e/wysiwyg-*.spec.ts` and
`src/editors/wysiwyg/plugins/`.

## Findings

1. **Inconsistent list-nesting vertical spacing.** When a list item indents into
   a new nested sub-list, the gap above the first nested item is 12px, but the
   gap between sibling items at the same level is only 4px, and outdenting back
   to a shallower level does not restore any extra spacing (also 4px). This 3x
   inconsistency makes nested lists look uneven/bug-like rather than
   intentional visual grouping. (Measured precisely via getBoundingClientRect;
   screenshot: 06-bullet-list-fresh.png)

2. **~~Backspace on a solo list item needs two presses, not one.~~ RETRACTED —
   not a bug; the solo/multi contrast was an artifact of two diagnostic scripts
   running at different speeds.** The symptom is real but only reachable when
   Backspace arrives within ~10ms of a caret-moving key, which scripted input
   can do and typing cannot. Moved to the harness-artifacts section below,
   which has the measurements.

3. **Callout title text is oddly offset from its icon in the WYSIWYG editor**
   (not in the read-only preview). `.wysiwyg-root .callout-title` (wysiwyg.css
   line ~225) sets `justify-content: space-between` on a row with 3 flex
   items — the icon (`::before`), the title text (`.callout-title-text`), and
   the type picker (`<select class="callout-picker">`, invisible via
   `opacity: 0` until hover but still occupying layout width). With 3 items
   and space-between, the title text lands roughly centered in the remaining
   space instead of sitting flush next to the icon. Measured: title text sits
   ~198px from the row's left edge on a 503px-wide row, with an 87.6px
   invisible picker still claiming space on the right. The preview
   (`.md-doc .callout-title`, no justify-content override, just `gap`)
   renders this correctly — icon and title flush together on the left. Fix
   direction: push only the picker right (e.g. `margin-left: auto` on
   `.callout-picker`) instead of `justify-content: space-between` on the row.
   (Screenshot: 21b-callout.png)

4. **[HIGH] Tab inside a code block ejects focus from the editor entirely,
   instead of indenting.** Click into a code block's CodeMirror content, type
   text, press Tab: `document.activeElement` goes from `.cm-content` to
   nothing (focus lands on `<body>`), no indent/tab character is inserted, and
   all further keystrokes are silently swallowed until the user clicks back
   into the block. Verified precisely via `document.activeElement.className`
   before/after Tab, and by confirming a post-Tab keystroke never reaches the
   code content. Every plain-text/code editor convention (and CodeMirror's own
   defaults, when wired up) treats Tab as "indent the current line," not
   "leave the editor" — this will trip up virtually anyone writing
   indented code in a WYSIWYG code block. Likely missing an
   `indentWithTab`-style keymap on the code block's CodeMirror instance.
   (Screenshots: 23a/23b-code-block*.png, 24-codeblock-tab.png)

5. **[HIGH] No working way to add content after a trailing code block —
   every discoverable path either no-ops or silently retypes into the code.**
   With a code block as the last node in the document:
   - Enter on an empty last line inside the block does **not** exit it (just
     adds another empty code line) — confirmed by dumping the block's own
     content and the toolbar still reading "Code block" afterward.
   - Clicking in the empty space below the block moves
     `document.activeElement` to the outer `ProseMirror` container (not into
     any paragraph — `editor.locator('> p')` finds nothing), and any text
     typed afterward is **silently discarded entirely** — verified the code
     block's content is byte-for-byte unchanged and no paragraph exists
     anywhere in the doc after typing.
   - The block-handle's own "+" ("insert block below") button *does* insert a
     real empty `<p>` right after the code block in the document — but focus
     never moves there. `document.activeElement` is still `cm-content`
     immediately after the click, so the next keystrokes land back inside the
     code fence (e.g. typing "AAA" produces `const x = 1;AAA` inside the code
     block, while the new paragraph stays permanently empty).
   Net effect: a user who writes a code block as their last piece of content
   and then wants to add a closing paragraph has no reliable way to do it —
   every button/keystroke a reasonable person would try either does nothing
   or quietly writes into the wrong place. (Screenshots:
   25-codeblock-exit.png, 26/27-codeblock-click-below*.png,
   30-codeblock-plus-v2.png)

6. **[MEDIUM] Enter in the first cell of a table jumps all the way past the
   entire table**, not just out of the current row. With a fresh 3x3 table,
   clicking the top-left header cell, typing "line one", then pressing Enter:
   focus leaves the table completely and a new paragraph is created *after
   the last row* — verified via document structure dump (table block still
   has 3 rows, unchanged, and a new empty `<p>` appears as the table's next
   sibling). Typing "line two" afterward lands in that trailing paragraph,
   visually far below the still-empty remaining cells. Markdown table cells
   can't hold a real line break, so exiting the table on Enter is defensible,
   but skipping over two untouched rows to land below the whole table (rather
   than, say, moving to the cell directly below, à la spreadsheet Enter
   behavior) is easy to not notice — the two blank rows stay sitting there
   and the user's next line of text is now decoupled from the table with no
   visual cue that a jump happened. (Screenshot: 34-table-enter-trace.png)

7. **[LOW, discoverability only] "Add row" lives on a separate, easy-to-miss
   affordance from "Delete row".** Hovering a row and clicking its
   row-drag-handle (the grip on the left) only offers "Delete row" — no add
   action there. Add row/column *does* exist, but only appears as a thin line
   handle when hovering the exact boundary *between* two rows/columns
   (confirmed: hovering a row's bottom edge reveals `[data-role="x-line-drag-
   handle"]` with an "Add row" button; clicking it took the table from 3 rows
   to 4). Since the delete action and the add action live on two differently
   -triggered, spatially separate handles, a user who finds "Delete row" via
   the obvious grip handle may not discover that adding a row requires
   hovering a precise 1px boundary line instead. Not a functional bug — a
   minor discoverability gap.

8. **[HIGH] Block math input rule never fires — `$$` + space does nothing,
   even though it's implemented in source.** `src/editors/wysiwyg/input-
   rules.ts` defines `mathBlockInputRule` with regex `/^\$\$\s$/` ("typing
   `$$` then space on an empty line creates a math block", per its own
   comment). Live-tested by pressing `$`, `$`, then Space key-by-key and
   checking DOM state after each keystroke: the text "$$ " is inserted
   literally and stays literal text — `[data-type="math-block"]` count is 0.
   Reproduced in the first paragraph of a fresh doc and in a second paragraph
   after other content (ruling out a first-block special case). By contrast,
   its sibling rules in the very same `wysiwygInputRules` array both work
   correctly when tested the same way: `mathInlineInputRule` (`$e^{i\pi}+1=0$`
   → renders as KaTeX immediately) and `calloutInputRule` (`> [!note] ` →
   renders as a styled callout), so this isn't a registration problem with
   the whole rule set — something specific to the block-math rule (or a
   higher-priority rule elsewhere consuming the same keystroke first) is
   swallowing the match. Note: block math loaded *from an existing file*
   (parseMarkdown path) still renders fine — this is specifically the
   live-typing input rule that's broken, which is why the project's own
   e2e suite (which seeds pre-written markdown rather than typing "$$ " live)
   never caught it. (Screenshot: 40a-block-math-created.png)

9. **[LOW] A live-typed mermaid fence stays a plain code block until a mode
   round-trip re-parses it — it doesn't render as a diagram on its own.**
   Typing ` ```mermaid ` + diagram source creates a normal syntax-highlighted
   code block (language tag "mermaid"), and it stays that way even after
   blurring/clicking elsewhere. Switching to Raw mode and back to WYSIWYG
   (forcing a markdown round-trip) does correctly render it as a `.diagram-
   node` with a live SVG — so the parser/renderer both work fine; only the
   "render live as you type" step is missing. Likely intentional (keeps the
   block a live source editor while you're actively typing it, same as any
   other code block), but users accustomed to Obsidian-style live diagram
   preview may expect it to render sooner. Low priority.

10. **~~[MEDIUM] Inserting an image via the toolbar makes it overlap the
    adjacent paragraph text.~~ RETRACTED — not a bug; the original measurement
    was wrong.** The claim was that a toolbar-inserted 200x100 image "visually
    overlaps upward over the text". Re-measured properly and it does not: the
    original check compared the image's rect against the *paragraph element's*
    rect, and since the paragraph contains the image those always intersect, so
    the test could only ever report an overlap. Measuring the text glyphs
    instead (a DOM Range over the paragraph's text nodes) gives

        img:  top 199  bottom 299  left 621.97  right 821.97
        text: top 282  bottom 303  left 370.50  right 621.97
        overlaps: false

    The edges abut exactly at 621.97 and the paragraph's line box grows from
    ~21px to 136px to accommodate the image — textbook `inline-block` layout,
    confirmed visually too (shots 80a/80b). What remains is a design
    preference, not a defect: "Insert image" places the image inline at the
    caret, which is what `text ![](src)` means in CommonMark. There is no
    block-image node in markdown, so rendering a lone image as a block would
    make one paragraph *look* like two. Left as is deliberately.

11. **[MEDIUM] Live-typing a nested list emits a spurious blank line, silently
    turning a tight list into a loose one.** Found while investigating #1.
    Building `- one / - two / Tab / nested a / nested b / Shift-Tab / three` by
    hand in the WYSIWYG editor serializes as

        - one
        - two
                      <- blank line
          - nested a
          - nested b
        - three

    while the *same list loaded from a file* round-trips byte-identically with
    no blank line. Dumping the real ProseMirror attrs (via `pmViewDesc`) shows
    every live-created `list_item` carrying `spread=true` where the parsed ones
    carry `false` — upstream defaults `list_item.spread` to `true` while both
    list nodes default to `false`, and the `- ` input rule builds its item with
    `createAndFill()` and no attrs. `mdast-util-to-markdown` consults an item's
    spread only when joining the item's *own* children, which is why a flat
    list looks fine and the blank line appears the moment an item gains a
    nested list. Same defect for ordered and task lists — they share the
    schema. `splitListItem`/`sinkListItem` copy attrs from the item they act
    on, so appending or Tab-nesting inside a loaded list was already correct;
    creation was the only vector.

    Why it matters: it changes the bytes written to the user's file for the
    most ordinary list gesture, and it makes the two panes disagree about that
    file. `mdast-util-to-hast` escalates any loose *item* to the whole list, so
    the preview wraps every item in `<p>` and renders 12px gaps, while Milkdown
    reads only `list.spread` and renders the same file tight at 4px:

        - one / - two / <blank> /   -> list.spread=false, items false,true,false
          - nested a / - three           preview: <li><p>one</p>… (loose)
                                         wysiwyg: tight

    Fixed by overriding the attr default to `false` in
    `src/editors/wysiwyg/plugins/list-spread-fix.ts`, which already owns this
    class of bug. Parsing is untouched, so genuinely loose files still
    round-trip. Independent of #1, whose fix is CSS-only and correct either
    way.

## Notes / non-issues (test harness artifacts, not app bugs)

- **Backspace at the start of a list item looks like a no-op when the key
  arrives <10ms after a caret-moving key** (was finding #2, retracted above).
  The threshold is sharp, and the pause *after typing* is irrelevant — only the
  pause before Backspace matters:

      afterType  afterHome   first Backspace
           0ms        0ms    NO-OP
           0ms       10ms    dissolved (works)
         200ms        0ms    NO-OP

  The claimed "solo needs two presses, multi needs one" contrast does not
  survive a direct control — both shapes fail together and succeed together
  when given the same timing:

      NO-OP   solo,  Home->Backspace immediately
      NO-OP   multi, ArrowUp->Backspace immediately
      works   solo,  human speed (60ms/key)
      works   multi, human speed (60ms/key)

  The original comparison used two scripts with different numbers of caret keys
  before Backspace (`16-backspace-solo-item.mjs` one, `15-backspace-first-item
  .mjs` three) that happened to land on opposite sides of the threshold; it is
  jitter around the CDP round-trip time, not key count — a solo run given three
  caret keys still failed.

  Mechanism: `Home` is not intercepted by any keymap, so the browser moves the
  DOM selection and ProseMirror learns of it asynchronously via
  `selectionchange`. Until then the preset's `liftFirstListItem` bails on
  `$from.parentOffset !== 0`, and `joinBackward` also consults
  `view.endOfTextblock('backward', state)`, which reads live DOM state. Both
  guards decline, no other handler claims the key, and the result is a clean
  no-op with no text deleted. Once the selection is observed, one press
  dissolves the item — verified across six variants (`- ` + immediate
  Backspace, ordered lists, `Ctrl+Home`, `ArrowLeft`, `Home`, and an item
  preceded by a paragraph).

  Deliberately not fixed: the reflex gesture the finding worried about (type
  `- `, immediately Backspace) works, because typing supplies the settle time.
  Guarding against it would mean overriding the editor's most load-bearing key
  to re-derive the caret from the DOM, to chase an input rate humans cannot
  produce.

- Switching mode (WYSIWYG → Raw) immediately after typing, with zero wait,
  showed an apparently-empty Raw pane. This is because the WYSIWYG → store
  sync is debounced (~400-600ms, matching the app's own test suite which
  explicitly waits before checking synced content); adding that wait made
  Raw mode show the correct text every time. Not re-testing as a real bug —
  requires switching modes within under ~400ms of the last keystroke, which
  is at the edge of plausible human speed via mouse click (vs. my
  zero-delay scripted key press).

- Two ordered-list fragments separated by unrelated content (e.g. a task
  list) each restart numbering at 1 instead of continuing — this is correct
  CommonMark behavior for interrupted lists (matches Obsidian/Typora), not a
  bug. Only relevant because my own test script inserted content between two
  list fragments; not a real user-facing issue.

- `window.confirm()` (used by New Document / Open File "discard changes?"
  flows) is not reliably automatable through the connectOverCDP reconnect
  session used for this testing session — a Playwright-internal auto-dismiss
  races the explicit dialog listener. Confirmed by reading actions.ts: the
  confirm flow and message text are implemented correctly
  (`confirmDiscardIfDirty` in src/features/files/actions.ts). Not re-tested
  live end-to-end; treat as code-reviewed but not click-tested.
