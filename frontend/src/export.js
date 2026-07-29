/**
 * Export helpers: widget data as CSV, widget or dashboard as PNG.
 *
 * The CSV side is pure and unit tested. The PNG side needs the DOM, so it
 * loads html-to-image lazily — that keeps ~40KB out of the initial bundle for
 * the majority of sessions where nobody exports anything.
 */

/** RFC 4180: quote when the value contains a delimiter, quote or newline. */
export function escapeCsvValue(value) {
  if (value === null || value === undefined) return ''
  const s = String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/** Build a CSV document from a widget result. */
export function toCsv(columns = [], rows = [], { delimiter = ',' } = {}) {
  const header = columns.map(escapeCsvValue).join(delimiter)
  const body = rows.map((row) =>
    columns.map((c) => escapeCsvValue(row[c])).join(delimiter)
  )
  return [header, ...body].join('\r\n')
}

/** Turn a widget title into a safe, readable file name stem. */
export function toFileName(title, extension) {
  const stem = String(title || 'export')
    .trim()
    .replace(/[^\w\s-]/g, '')     // drop characters that upset file systems
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'export'
  const date = new Date().toISOString().slice(0, 10)
  return `${stem}-${date}.${extension}`
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // give the browser a moment to start the download before revoking
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadCsv(title, columns, rows) {
  // BOM so Excel opens UTF-8 correctly instead of mangling accented text
  const blob = new Blob(['﻿' + toCsv(columns, rows)],
    { type: 'text/csv;charset=utf-8' })
  triggerDownload(blob, toFileName(title, 'csv'))
}

/**
 * Render a DOM element to PNG.
 * `element` should be the widget or the grid container.
 */
export async function downloadPng(element, title) {
  if (!element) throw new Error('Nothing to export')
  const { toBlob } = await import('html-to-image')

  // read the live background so the export matches the current theme
  const background = getComputedStyle(document.body).backgroundColor || '#ffffff'

  const blob = await toBlob(element, {
    backgroundColor: background,
    pixelRatio: 2,                       // legible on high-DPI screens and in slides
    cacheBust: true,
    filter: (node) => !node?.classList?.contains?.('no-export'),
  })
  if (!blob) throw new Error('Could not render the image')
  triggerDownload(blob, toFileName(title, 'png'))
}
