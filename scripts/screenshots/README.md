# README screenshots

Every screenshot in the README is generated from the real app by
[`capture.mjs`](capture.mjs), so they can be regenerated whenever the UI changes instead of
slowly going stale.

```bash
npm run dev -- --port 4173 --strictPort   # terminal 1
npm run screenshots                       # terminal 2
```

Output lands in [`docs/screenshots/`](../../docs/screenshots). To redo just one:

```bash
npm run screenshots -- hero-dark slash-menu
```

## How it stays deterministic

- **One fixed document.** [`demo-doc.md`](demo-doc.md) is seeded into the app through the
  same File System Access stub the e2e suite uses, so no file picker is involved and the
  content never varies.
- **Theme and layout are pinned** by writing `marknow.theme` and `marknow.ui` to
  localStorage before the app boots — mode, outline visibility and split ratios included.
- **Motion is frozen.** Transitions and animations are zeroed and the caret layers hidden,
  so two runs of the same shot are pixel-identical.
- **Async renderers are awaited.** Mermaid, KaTeX and web fonts all load lazily; each shot
  waits for the ones it needs before the shutter, rather than sleeping and hoping.
- **2× device scale**, so the images stay crisp on retina displays.

## Adding a shot

Add an entry to the `SHOTS` object in `capture.mjs`. Each one gets a fresh browser context,
so shots never leak state into each other. Prefer `openDoc()` for anything that needs the
demo document already open.

Keep the frame tight — a screenshot that is half empty background reads as an accident. Use
a shorter viewport or a `clip` region when the content does not fill the default 1440×900.
