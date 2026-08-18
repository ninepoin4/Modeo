/**
 * Runtime loader for the three.js scene renderer (Modeo native embedding).
 *
 * Vendored from omdsh-dev/dsh-genui (MIT) and de-coupled from the dsh
 * asset-route mechanism: the heavy three bundle is now a vite dynamic
 * chunk loaded ONLY when a spec contains a `scene3d` node.
 * @module modeo/genui/scene3d-lazy
 */
import type { GenuiScene3D } from './spec.ts'

/**
 * Mount a GenUI 3D scene into `container` (engine loaded on demand).
 * @param container - the DOM node to host the WebGL canvas.
 * @param scene - the declarative scene spec.
 * @returns a disposer that removes the renderer and its context.
 */
export async function mountScene(container: HTMLElement, scene: GenuiScene3D): Promise<() => void> {
  const mod = await import('./scene3d-core.ts')
  return mod.mountScene(container, scene)
}
