export const PROPERTY_NO_RE = /^[A-Za-z0-9-]+$/

export function normalizePropertyNo(input: string): string {
  const s = input.trim()
  if (!PROPERTY_NO_RE.test(s)) throw new Error(`Invalid property number: "${input}"`)
  return s
}

// '2026-09ICT-0099' -> '2026-09ICT-0100' (keeps zero padding)
export function nextInSequence(propertyNo: string): string {
  const m = /^(.*?)(\d+)$/.exec(propertyNo)
  if (!m) throw new Error(`Property number does not end in digits: "${propertyNo}"`)
  const next = String(BigInt(m[2]) + 1n).padStart(m[2].length, '0')
  return m[1] + next
}

// ── Property number series: YYYY-MM{CODE}-NNNN with an optional component letter (a, b, c…) ──
const SERIES_RE = /^(\d{4})-(\d{2})([A-Z]{2,8})-(\d+)([a-z]?)$/

export type PropertyNoSeries = { year: number; month: number; code: string; n: number; suffix: string }

// null for numbers in other or older formats (e.g. 1998-05-140-TSE000-RSTL15)
export function parseSeries(no: string): PropertyNoSeries | null {
  const m = SERIES_RE.exec(no)
  return m ? { year: Number(m[1]), month: Number(m[2]), code: m[3], n: Number(m[4]), suffix: m[5] } : null
}

export function formatPropertyNo(s: { year: number; month: number; code: string; n: number }): string {
  return `${s.year}-${String(s.month).padStart(2, '0')}${s.code}-${String(s.n).padStart(4, '0')}`
}

// first unused letter after the ones a set already has
export function nextComponentSuffix(existing: string[]): string {
  const used = new Set(existing)
  for (let i = 0; i < 26; i++) {
    const c = String.fromCharCode(97 + i)
    if (!used.has(c)) return c
  }
  throw new Error('A set can have at most 26 components')
}

export type NumberSlot = { groupKey: string; year: number; month: number; code: string; typed: string }

// The entry form fills every empty property number with the next one of its series (year + type). `bases[groupKey]` is
// the first free running number the server suggested for that group. Numbers typed anywhere on the form are kept and
// skipped, so two rows never get the same suggestion; the unique index on the server stays the real guard.
export function suggestNumbers(slots: NumberSlot[], bases: Record<string, number>): string[] {
  const taken = new Set(slots.map((s) => s.typed.trim().toUpperCase()).filter(Boolean))
  const next = { ...bases }
  return slots.map((s) => {
    if (s.typed.trim()) return s.typed.trim()
    for (;;) {
      const no = formatPropertyNo({ year: s.year, month: s.month, code: s.code, n: next[s.groupKey] ?? 1 })
      next[s.groupKey] = (next[s.groupKey] ?? 1) + 1
      if (!taken.has(no.toUpperCase())) { taken.add(no.toUpperCase()); return no }
    }
  })
}
