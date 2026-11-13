// Date-only values are "YYYY-MM-DD" strings; never go through the local timezone.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December']

export function isIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

export function formatLongDate(s: string): string {
  if (!isIsoDate(s)) throw new Error(`Invalid date: "${s}"`)
  const [y, mo, d] = s.split('-').map(Number)
  return `${MONTHS[mo - 1]} ${d}, ${y}`
}
