import type { Page } from '@playwright/test'

export interface Violation {
  id: string
  impact?: string | null
  help: string
  helpUrl?: string
  nodes: { target: unknown[] }[]
}

/** The violations as lines of text, worst first (what a failing test prints). */
export function formatViolations(violations: Violation[]): string {
  const order = ['critical', 'serious', 'moderate', 'minor']
  const rank = (v: Violation) => {
    const i = order.indexOf(v.impact ?? '')
    return i < 0 ? order.length : i
  }
  return [...violations]
    .sort((a, b) => rank(a) - rank(b))
    .map((v) => `${v.impact ?? 'unknown'}: ${v.id} - ${v.help} (${v.nodes.length} element(s), e.g. ${v.nodes[0]?.target.join(' ') ?? '?'})`)
    .join('\n')
}

type AxeBuilder = new (o: { page: Page }) => { analyze(): Promise<{ violations: Violation[] }> }

/**
 * The accessibility smoke test (axe) of the page the test is on, plugin frame included. Needs the optional package
 * `@axe-core/playwright`. Returns the violations of the impacts given (default: serious and critical).
 */
export async function accessibilityViolations(page: Page, impacts: string[] = ['serious', 'critical']): Promise<Violation[]> {
  let Builder: AxeBuilder
  try {
    const name = '@axe-core/playwright'
    Builder = ((await import(/* @vite-ignore */ name)) as { default: AxeBuilder }).default
  } catch {
    throw new Error('the accessibility check needs the package @axe-core/playwright: npm install --save-dev @axe-core/playwright')
  }
  const result = await new Builder({ page }).analyze()
  return result.violations.filter((v) => impacts.includes(v.impact ?? ''))
}

/** Fails with the list of violations when there are any. */
export async function expectAccessible(page: Page, impacts?: string[]): Promise<void> {
  const v = await accessibilityViolations(page, impacts)
  if (v.length) throw new Error(`accessibility violations:\n${formatViolations(v)}`)
}
