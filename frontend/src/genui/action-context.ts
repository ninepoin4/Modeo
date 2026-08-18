/**
 * GenUI action context (Modeo native embedding).
 *
 * Vendored from omdsh-dev/dsh-genui (MIT) and de-coupled from the dsh
 * primitives package: Modeo installs its own GenuiActionContext.Provider
 * around every dsh-ui fence render, wired to the Modeo sendMessage pipeline
 * as a `[genui-action]` message back to the model.
 *
 * Absent provider = display-only (their `action` is ignored). The hook
 * never throws.
 */
import { createContext, useContext } from 'react'
import type { Context } from 'react'

/** v2 action handler: component action + its collected data. */
export type GenuiActionHandler = (action: string, payload: Record<string, unknown>) => void

/** The action context Modeo provides (local instance, host-owned). */
export const GenuiActionContext: Context<GenuiActionHandler | undefined> = createContext<GenuiActionHandler | undefined>(undefined)

/** Read the installed action handler, if any. */
export function useGenuiAction(): GenuiActionHandler | undefined {
  return useContext(GenuiActionContext)
}
