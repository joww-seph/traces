import { describe, expect, it } from 'vitest'
import {
  categorize, formatLongDate, formatPeso, formatPropertyNo, isIsoDate, itemInput, lineInput, loginInput, nextComponentSuffix,
  nextInSequence, normalizePropertyNo, parseSeries, suggestNumbers, pesoToCentavos, propertyTypeInput, reportQuery, userCreate,
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
  line: { qty: 1, unitCostCentavos: 9645000, description: 'Laptop set', estUsefulLifeYears: 5, dateAcquired: '2026-09-01' },
  item: { itemId: '0b6f2c1e-8a3d-4c55-9b1e-3f2a7d9c4e10' },
  properties: [{ propertyNo: '2026-09ICT-0199' }, { propertyNo: '2026-09ICT-0199a', componentLabel: 'Mouse' }],
}

describe('lineInput', () => {
  it('accepts a valid line', () => {
    expect(lineInput.safeParse(goodLine).success).toBe(true)
  })
  it('rejects a missing dateAcquired and an unknown key', () => {
    const { dateAcquired: _d, ...noDate } = goodLine.line
    expect(lineInput.safeParse({ ...goodLine, line: noDate }).success).toBe(false)
    expect(lineInput.safeParse({ ...goodLine, line: { ...goodLine.line, article: 'Laptop' } }).success).toBe(false)
  })
  it('takes the card as an existing id or a new one, not both and not neither', () => {
    const newCard = { new: { propertyTypeId: 1, article: 'Laptop', description: 'Lenovo ThinkPad E14 Gen 5', unit: 'unit' } }
    expect(lineInput.safeParse({ ...goodLine, item: newCard }).success).toBe(true)
    expect(lineInput.safeParse({ ...goodLine, item: { ...newCard, itemId: goodLine.item.itemId } }).success).toBe(false)
    expect(lineInput.safeParse({ ...goodLine, item: {} }).success).toBe(false)
    const { item: _i, ...noItem } = goodLine
    expect(lineInput.safeParse(noItem).success).toBe(false)
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

describe('property number series', () => {
  it('parses the YYYY-MMTYPE-NNNN format', () => {
    expect(parseSeries('2026-03ICT-0187')).toEqual({ year: 2026, month: 3, code: 'ICT', n: 187, suffix: '' })
    expect(parseSeries('2026-09ICT-202')).toMatchObject({ n: 202 })
    expect(parseSeries('2026-09ICT-0199a')).toMatchObject({ n: 199, suffix: 'a' })
  })
  it('ignores older formats', () => {
    expect(parseSeries('1998-05-140-TSE000-RSTL15')).toBeNull()
  })
  it('formats with 4 digits and the month of acquisition', () => {
    expect(formatPropertyNo({ year: 2026, month: 3, code: 'ICT', n: 7 })).toBe('2026-03ICT-0007')
    expect(formatPropertyNo({ year: 2026, month: 10, code: 'OE', n: 12345 })).toBe('2026-10OE-12345')
  })
  it('picks the next free component letter', () => {
    expect(nextComponentSuffix([])).toBe('a')
    expect(nextComponentSuffix(['a', 'b'])).toBe('c')
    expect(nextComponentSuffix(['b'])).toBe('a')
  })
})

describe('property types, cards and reports', () => {
  it('property type code is 2-8 capital letters', () => {
    expect(propertyTypeInput.safeParse({ code: 'ICT', name: 'x' }).success).toBe(true)
    expect(propertyTypeInput.safeParse({ code: 'ict1', name: 'x' }).success).toBe(false)
  })
  it('a card needs type, article, model and unit', () => {
    expect(itemInput.safeParse({ propertyTypeId: 1, article: 'Laptop', description: 'ThinkPad', unit: 'unit' }).success).toBe(true)
    expect(itemInput.safeParse({ propertyTypeId: 1, article: 'Laptop', description: '', unit: 'unit' }).success).toBe(false)
  })
  it('the report needs an officer and a category; the type and date are optional', () => {
    const id = '0b6f2c1e-8a3d-4c55-9b1e-3f2a7d9c4e10'
    expect(reportQuery.safeParse({ officerId: id, category: 'ppe' }).success).toBe(true)
    expect(reportQuery.safeParse({ officerId: id, category: 'ppe', typeId: '2', asAt: '2026-12-31' })).toMatchObject({ success: true, data: { typeId: 2 } })
    expect(reportQuery.safeParse({ category: 'ppe' }).success).toBe(false)
  })
})

describe('suggestNumbers (the entry form fills the empty property numbers)', () => {
  const slot = (over: object = {}) => ({ groupKey: '2026|1', year: 2026, month: 10, code: 'ICT', typed: '', ...over })
  it('continues the series of each year + type from its base, in order, with the month of each row', () => {
    const out = suggestNumbers([slot(), slot({ month: 11 }), slot({ groupKey: '2026|3', code: 'OE' }), slot()], { '2026|1': 203, '2026|3': 8 })
    expect(out).toEqual(['2026-10ICT-0203', '2026-11ICT-0204', '2026-10OE-0008', '2026-10ICT-0205'])
  })
  it('keeps what was typed and never suggests a number that is already on the form', () => {
    const out = suggestNumbers([slot({ typed: '2026-10ICT-0204' }), slot(), slot(), slot({ typed: 'LEGACY-1' })], { '2026|1': 203 })
    expect(out).toEqual(['2026-10ICT-0204', '2026-10ICT-0203', '2026-10ICT-0205', 'LEGACY-1'])
  })
  it('does not collide case-insensitively and starts at 1 without a base', () => {
    expect(suggestNumbers([slot({ typed: '2026-10ict-0001' }), slot()], {})).toEqual(['2026-10ict-0001', '2026-10ICT-0002'])
  })
})
