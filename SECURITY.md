# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for a security problem.

Report it privately through GitHub's
[Report a vulnerability](https://github.com/ntson9p/marknow/security/advisories/new) form,
which opens a private advisory only the maintainers can see.

Include what you would want to receive: what the issue is, how to reproduce it (a document
or a URL is ideal), and what an attacker could achieve with it. You will get an
acknowledgement as soon as it is read, and you are welcome to be credited in the fix if you
want to be.

This is a small volunteer project, so please allow reasonable time for a fix before
disclosing publicly.

## What is in scope

MarkNow is a fully client-side application. There is no backend, no user account, and no
server that stores your documents — so the interesting attack surface is **a malicious
document, opened by a trusting user**. Things worth reporting:

- **Cross-site scripting** through document content: raw HTML in markdown, link or image
  URLs (`javascript:`, `data:`), math or diagram source, frontmatter, or anything else that
  escapes the sanitizer and executes.
- **Sanitizer bypasses** in `src/core/markdown/sanitize-schema.ts` or the rendering path.
- **Escaping the export**: content in a generated standalone HTML file that executes when
  the exported file is opened.
- **Reading files the user didn't grant access to**, or writing outside the granted handle.
- **Leaking document content off-device.** The app makes no network calls for any core
  function; anything that causes one with your content in it is a bug worth reporting.
- **Supply-chain problems** in the dependency tree that actually reach the shipped bundle.

## What is out of scope

- **Documents stored in your own browser.** Drafts, snapshots and recent-file handles live
  in IndexedDB and `localStorage` on your device, unencrypted, by design. Anyone with access
  to your browser profile can read them — the same as any locally saved file. Local-disk
  encryption is the right layer for that threat, not this app.
- **Remote images you put in your own document.** If you reference `https://example.com/a.png`,
  your browser fetches it. That is the document doing what you asked.
- **Missing hardening headers on the hosted deployment** without a demonstrated impact.
- **Self-XSS** that requires the user to paste attacker-supplied code into a devtools console.
- Findings from an automated scanner with no demonstrated exploit path.

## Supported versions

The latest release on [marknow.web.app](https://marknow.web.app/) and the `main` branch are
the supported versions. There are no maintained older branches.
