// `msk.t`: the texts inside the page of a plugin. The key is the English phrase; a language plugin brings the
// translations (`lang/ui/<plugin id>.json`), the shell hands them over in the `context`.

export type Vars = Record<string, string | number>

/** Replaces `{name}` with `vars.name` (an unknown name becomes the empty string, as in the crud view). */
export function fill(text: string, vars?: Vars): string {
  return vars ? text.replace(/\{(\w+)\}/g, (_, v: string) => String(vars[v] ?? '')) : text
}

/** The translation of `phrase`: the texts of the language plugin, then the plugin's own table for that language
 *  (`own`), otherwise the English phrase itself. */
export function translate(
  phrase: string,
  vars: Vars | undefined,
  texts: Record<string, string> | undefined,
  own: Record<string, string> | undefined,
): string {
  const hit = texts && Object.prototype.hasOwnProperty.call(texts, phrase) ? texts[phrase] : undefined
  const mine = own && Object.prototype.hasOwnProperty.call(own, phrase) ? own[phrase] : undefined
  return fill(hit || mine || phrase, vars)
}
