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
