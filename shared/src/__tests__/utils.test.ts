import { describe, expect, it } from 'vitest'
import {
  categorize, formatLongDate, formatPeso, isIsoDate, lineInput, loginInput, nextInSequence,
  normalizePropertyNo, pesoToCentavos, userCreate,
} from '../index.js'

describe('money', () => {
  it('parses pesos to centavos without float error', () => {
    expect(pesoToCentavos('96,450.00')).toBe(9645000)
    expect(pesoToCentavos('0.1')).toBe(10)
    expect(pesoToCentavos(48700)).toBe(4870000)
    expect(pesoToCentavos('1.10')).toBe(110)
    expect(pesoToCentavos('19.99')).toBe(1999)
  })
  it('rejects bad input', () => {
    expect(() => pesoToCentavos('abc')).toThrow()
    expect(() => pesoToCentavos('1.234')).toThrow()
    expect(() => pesoToCentavos('-5')).toThrow()
    expect(() => pesoToCentavos('')).toThrow()
  })
  it('formats centavos as pesos', () => {
    expect(formatPeso(9645000)).toBe('₱96,450.00')
    expect(formatPeso(0)).toBe('₱0.00')
  })
})

describe('dates', () => {
  it('validates ISO dates', () => {
    expect(isIsoDate('2026-05-12')).toBe(true)
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('2026-5-12')).toBe(false)
  })
  it('formats long dates without timezone shift', () => {
    expect(formatLongDate('2026-05-12')).toBe('May 12, 2026')
    expect(formatLongDate('2026-01-01')).toBe('January 1, 2026')
  })
})

describe('category', () => {
  it('splits at the threshold', () => {
    expect(categorize(4999999, 5000000)).toBe('semi')
    expect(categorize(5000000, 5000000)).toBe('ppe')
  })
})

describe('propertyNo', () => {
  it('normalizes and validates', () => {
    expect(normalizePropertyNo('  2026-09ICT-0199 ')).toBe('2026-09ICT-0199')
    expect(() => normalizePropertyNo('bad no/1')).toThrow()
    expect(() => normalizePropertyNo('')).toThrow()
  })
  it('increments keeping zero padding', () => {
    expect(nextInSequence('2026-09ICT-0199')).toBe('2026-09ICT-0200')
    expect(nextInSequence('2026-09ICT-0099')).toBe('2026-09ICT-0100')
    expect(nextInSequence('X-9')).toBe('X-10')
    expect(() => nextInSequence('2026-ICT-A')).toThrow()
  })
})

const goodLine = {
  line: { qty: 1, unit: 'set', unitCostCentavos: 9645000, article: 'Laptop', description: 'Laptop set', estUsefulLifeYears: 5 },
  properties: [{ propertyNo: '2026-09ICT-0199' }, { propertyNo: '2026-09ICT-0199a', componentLabel: 'Mouse' }],
}

describe('lineInput', () => {
  it('accepts a valid line', () => {
    expect(lineInput.safeParse(goodLine).success).toBe(true)
  })
  it('rejects qty 0', () => {
    expect(lineInput.safeParse({ ...goodLine, line: { ...goodLine.line, qty: 0 } }).success).toBe(false)
  })
  it('rejects zero properties', () => {
    expect(lineInput.safeParse({ ...goodLine, properties: [] }).success).toBe(false)
  })
  it('rejects repeated property numbers, case-insensitive', () => {
    const r = lineInput.safeParse({ ...goodLine, properties: [{ propertyNo: 'A-1' }, { propertyNo: 'a-1' }] })
    expect(r.success).toBe(false)
  })
  it('rejects a region outside the page', () => {
    expect(lineInput.safeParse({ ...goodLine, region: { page: 1, x: 0.9, y: 0, w: 0.5, h: 0.1 } }).success).toBe(false)
  })
})

describe('auth + user schemas', () => {
  it('login needs email and password', () => {
    expect(loginInput.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true)
    expect(loginInput.safeParse({ email: 'nope', password: 'x' }).success).toBe(false)
  })
  it('userCreate takes email, name and role only (the server makes the temporary password)', () => {
    const base = { email: 'a@b.co', displayName: 'A', role: 'supply_admin' as const }
    expect(userCreate.safeParse(base).success).toBe(true)
    expect(userCreate.safeParse({ ...base, role: 'root' }).success).toBe(false)
    expect(userCreate.safeParse({ ...base, email: 'nope' }).success).toBe(false)
  })
})
