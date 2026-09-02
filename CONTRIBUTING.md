# Contributing to MarkNow

Thanks for being here. This project is genuinely open to contributions, and small ones are
welcome — a bug report with a reproduction is worth as much as a patch.

## The short version

```bash
git clone https://github.com/ntson9p/marknow.git
cd marknow
npm ci
npm run dev          # http://localhost:5173
```

Before you open a pull request:

```bash
npm run typecheck && npm run lint && npm test
```

That is the same gate CI applies (plus `npm run build`, `npm run bundle-size` and
`npm run e2e`).

## Where the answers live

This project writes down what it intends to do before building it. When you are unsure
whether something is a bug or deliberate, check these first:

| File                                                         | What it holds                                                                                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`docs/requirements.md`](docs/requirements.md)               | The normative spec. Numbered `FR-*` requirements, the markdown flavor table (§6), the decision log (`D1`–`D15`), performance budgets, release criteria. |
| [`docs/implementation-plan.md`](docs/implementation-plan.md) | Architecture, the editor sync protocol, the round-trip strategy, milestones M0–M8.                                                                      |
| [`docs/issues/findings.md`](docs/issues/findings.md)         | A WYSIWYG audit worklog. Most findings are fixed; kept for the measurements and the diagnostic style.                                                   |

Code comments carry requirement numbers (`FR-5.9`, `D13`) on purpose — follow them back to
the spec when you need the reasoning.

## Good first contributions

- **Report a markdown document that breaks.** Attach the `.md` file. Markdown edge cases are
  where this app lives or dies, and a good reproduction is the hard part of the fix.
- **Add a round-trip fixture.** Drop a `.md` file into [`tests/roundtrip/fixtures/`](tests/roundtrip/fixtures)
  and the corpus picks it up automatically — no registration needed. A _failing_ fixture is a
  legitimate pull request by itself; you do not have to fix it to contribute it.
- **Surface an existing setting.** `src/features/settings/store.ts` already supports editor
  font size, line numbers, default mode, draft interval, and the full markdown style
  preference set (bullet marker, emphasis marker, fence style, list indent, rule style). The
  Settings panel exposes two of them. The state is wired; the UI is missing.
- **Take one of the two open findings** in `docs/issues/findings.md` (both low priority — the
  status table at the top of that file says which).
- **Improve the Firefox/Safari fallbacks.** Those browsers get "save a copy" and base64
  images instead of in-place save and an `assets/` folder. There is room to do better.

## How the code is organised

```
src/
  app/         shell, top bar, status bar, mode switching, global shortcuts, stores
  core/
    document/  the canonical DocumentStore — one markdown string, one source of truth
    markdown/  the shared unified/remark pipeline (parse, render, style, callouts)
    storage/   File System Access provider, download fallback, IndexedDB (Dexie)
  editors/
    raw/       CodeMirror 6 source editor
    preview/   read-only rendered view
    wysiwyg/   Milkdown editor, plugins (slash menu, bubble menu, block handles), node views
  features/    self-contained features: diff, export, images, outline, snapshots, …
```

The one architectural rule worth internalising: **editors never talk to each other.** They
read from and write to the `DocumentStore` through an origin-tagged, debounced sync protocol.
If you find yourself importing one editor from another, that is the bug.

Likewise, there is exactly one markdown grammar. The preview, the raw-mode highlighting and
the WYSIWYG parse/serialize all run through `src/core/markdown/`. Adding a second parser for
a new feature is how flavors drift apart, so please don't.

## Round-trip: the rule that governs edits

Two different promises, and they are not the same:

1. **Raw mode is byte-faithful.** Text the user did not touch is written back unchanged. Any
   change that makes raw mode reformat untouched text is a bug, full stop.
2. **WYSIWYG edits normalize style.** Re-serialization may change marker characters and
   spacing, but never content, structure or meaning — including syntax the rich editor
   cannot represent, which must round-trip verbatim.

`tests/roundtrip/` enforces rule 2 against a 62-fixture corpus with two assertions per
fixture: idempotence (`f(f(x)) === f(x)`) and AST-equivalence (`parse(f(x)) ≡ parse(x)`).
**The corpus only grows.** Fixtures are added when a bug is found and never removed or
weakened — that is what keeps it a ratchet rather than a rubber stamp.

## Tests

| Command                                      | Scope                                       |
| -------------------------------------------- | ------------------------------------------- |
| `npm test`                                   | Unit + round-trip (Vitest, jsdom)           |
| `npm run test:watch`                         | Same, watching                              |
| `npm run e2e`                                | End-to-end (Playwright, Chromium + Firefox) |
| `npx playwright test tests/e2e/diff.spec.ts` | A single e2e spec                           |

E2E specs stub the File System Access API with an in-page fake (`tests/e2e/helpers.ts`), so
file open/save flows are deterministic and run identically in Firefox, which has no such API.
Use those helpers rather than inventing a new stub.

New behaviour should come with a test. Bug fixes should come with a test that fails before
the fix.

## Style and conventions

- **TypeScript strict.** No `any` escapes without a comment explaining why.
- **Prettier and ESLint** are the arbiters — run `npm run format` and don't hand-argue style.
- **Comments explain _why_, not _what_.** The existing code sets the bar: comments cite
  requirement numbers and explain the non-obvious constraint that forced the shape of the
  code. Match that density; don't narrate the obvious.
- **Line endings are LF**, enforced by [`.gitattributes`](.gitattributes). This matters more
  than usual here: the round-trip fixtures are byte-significant markdown, where a lone `\n`
  is a soft break. A CRLF checkout silently breaks nine of them.

### Commit messages

Conventional-commit prefixes, scoped by milestone or feature:

```
feat(m0): app shell with mode switcher and theme toggle
fix(sync): guard echo loop on wysiwyg replace
test(roundtrip): add gfm table fixtures
docs(readme): document the review-changes flow
```

## Pull requests

- Keep them focused. One behaviour change per PR is much easier to review and revert.
- Describe what a user would notice, not just what the code does.
- Say which requirement (`FR-*`) the change serves, or propose a spec change if none fits.
- Screenshots or a short clip for anything visual. `scripts/screenshots/capture.mjs` can
  produce clean, deterministic ones if that helps.
- CI must be green. If a check fails on something you believe is unrelated, say so in the PR
  rather than disabling it.

## Performance budgets

The initial JavaScript payload is capped at **350 KB gzipped** and enforced by
`npm run bundle-size` in CI. Heavy things — Mermaid, KaTeX, the diff engine — are lazily
loaded on first use and must stay that way. If a change pushes past the budget, the fix is
usually a dynamic `import()`, not a bigger budget.

## Accessibility

`tests/e2e/axe.spec.ts` scans for serious and critical WCAG 2.1 A/AA violations in both
themes and both editor modes. New UI needs keyboard operation, a visible focus ring, and an
accessible name. `prefers-reduced-motion` is respected throughout — keep it that way.

## Reporting bugs

Open an issue with:

- What you did, what you expected, what happened.
- The `.md` document that triggers it, or the smallest fragment that still does.
- Browser and OS, and whether it reproduces in another browser.

For anything security-related, see [SECURITY.md](SECURITY.md) instead.

## Code of conduct

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md). The short version:
be kind, especially to people who are new.

## Licence

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE) that covers this project.
