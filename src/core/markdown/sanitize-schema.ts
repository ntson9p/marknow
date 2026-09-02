import { defaultSchema } from 'rehype-sanitize';

type Schema = typeof defaultSchema;

/**
 * Sanitize allowlist (§7 security): GitHub-style default schema extended for
 * the MarkNow flavor — math (KaTeX runs *after* sanitize on trusted, locally
 * generated output), mermaid fences, callout boxes, highlight classes, and
 * data:/blob: image sources for the base64/asset-resolver flows (D14).
 * Raw HTML in documents passes through this schema — scripts, event handlers,
 * and dangerous protocols are stripped; HTML never executes in editors.
 */
export const sanitizeSchema: Schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      // language-* fences, remark-math output, mermaid
      ['className', /^language-./, 'math-inline', 'math-display'],
    ],
    span: [...(defaultSchema.attributes?.span ?? []), ['className', 'math-inline', 'math-display']],
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      ['className', 'math', 'math-display', 'callout-title', 'callout', /^callout-./],
    ],
    th: [...(defaultSchema.attributes?.th ?? []), 'align'],
    td: [...(defaultSchema.attributes?.td ?? []), 'align'],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src ?? []), 'data', 'blob'],
  },
};
