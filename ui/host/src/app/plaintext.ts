/** Text for a single line of a feed: Markdown links `[text](url)` and images `![alt](url)` keep only
 *  their text, so a title written as Markdown (a call link, say) does not show raw syntax or a long URL. */
export function plainText(s: string): string {
  return s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
}
