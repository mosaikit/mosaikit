// The words of a search, as the server reads them (crates/kernel/src/search.rs, `words`).

/** The words the server searches for (at least one of 2 characters). */
export function searchable(q: string): boolean {
  return q.split(/[^\p{L}\p{N}]+/u).some((w) => w.length >= 2)
}
