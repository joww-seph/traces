// Money is integer centavos everywhere. Never use floats.
export function pesoToCentavos(input: string | number): number {
  const s = String(input).trim().replace(/[,\s₱]/g, '')
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s)
  if (!m) throw new Error(`Invalid peso amount: "${input}"`)
  const centavos = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0)
  if (!Number.isSafeInteger(centavos)) throw new Error(`Peso amount too large: "${input}"`)
  return centavos
}

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })

export function formatPeso(centavos: number): string {
  return peso.format(centavos / 100)
}
