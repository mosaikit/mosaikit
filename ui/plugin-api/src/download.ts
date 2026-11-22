// Export helpers: CSV text and a download without the host. The browser saves the file; nothing leaves the page.
// Excel opens the CSV right (UTF-8 mark, quoted cells, CRLF).

/** One cell of a CSV: quoted when it has a separator, a quote or a line break; a text starting with `= + - @` is neutralised (formula injection). */
export function csvCell(v: unknown, sep = ','): string {
  if (v === null || v === undefined) return ''
  let s = v instanceof Date ? v.toISOString() : String(v)
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^[-+]?\d+([.,]\d+)?$/.test(s)) s = `'${s}`
  return s.includes(sep) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Rows of values to CSV text. `header` is the first line when given. */
export function toCsv(rows: unknown[][], opts: { header?: string[]; sep?: string } = {}): string {
  const sep = opts.sep ?? ','
  const lines = (opts.header ? [opts.header, ...rows] : rows).map((r) => r.map((c) => csvCell(c, sep)).join(sep))
  return lines.join('\r\n') + '\r\n'
}

/** Saves `data` as a file called `name` through the browser; returns the Blob that was saved. */
export function downloadFile(name: string, data: BlobPart | BlobPart[], mime = 'application/octet-stream'): Blob {
  const blob = data instanceof Blob ? data : new Blob(Array.isArray(data) ? data : [data], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.hidden = true
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return blob
}

/** Saves rows as a CSV file (UTF-8 with a mark so Excel reads the accents). */
export function downloadCsv(name: string, rows: unknown[][], opts: { header?: string[]; sep?: string } = {}): Blob {
  return downloadFile(name.endsWith('.csv') ? name : `${name}.csv`, ['﻿', toCsv(rows, opts)], 'text/csv;charset=utf-8')
}
