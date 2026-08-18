/**
 * Runtime loader for the mermaid engine (Modeo native embedding).
 *
 * Vendored from omdsh-dev/dsh-genui (MIT) and de-coupled from the dsh
 * asset-route mechanism: the heavy mermaid bundle is now a vite dynamic
 * chunk — `import('./mermaid-core.ts')` pulls the mermaid package in as a
 * separate chunk loaded ONLY when a spec contains a `mermaid` node. The
 * main client bundle stays small; most conversations never download
 * mermaid at all.
 *
 * The pure source utilities stay statically exported from mermaid-safe so
 * tests (and any consumer) can use them without the engine.
 * @module modeo/genui/mermaid-lazy
 */
export { assertSafeSvg, repairMermaidSource } from './mermaid-safe.ts'

/**
 * Render mermaid source to an SVG string (engine loaded on demand).
 * @param code - the mermaid diagram source.
 * @returns the rendered SVG markup (verified free of script/event handlers).
 * @throws when the kind is not whitelisted, rendering fails, or the output
 *   fails the sanitization check.
 */
export async function renderMermaid(code: string): Promise<string> {
  const mod = await import('./mermaid-core.ts')
  return mod.renderMermaid(code)
}
