import { categorize, isIsoDate, nextComponentSuffix, pesoToCentavos, suggestNumbers, type NumberSlot } from '@traces/shared'

export type Entry = {
  key: string
  typeId: string; article: string; unit: string
  description: string; qty: string; cost: string; dateAcquired: string; life: string
  mains: { no: string; serial: string }[]
  comps: { label: string; no: string; serial: string }[]
}

let counter = 0
const uid = () => `r${Date.now().toString(36)}${(counter++).toString(36)}`

export const NO_SERIAL = 'N/A'

export const blankEntry = (from?: Entry): Entry => ({
  key: uid(), typeId: from?.typeId ?? '', article: '', unit: 'unit',
  description: '', qty: '1', cost: '', dateAcquired: from?.dateAcquired ?? '', life: '', mains: [{ no: '', serial: NO_SERIAL }], comps: [],
})

export const duplicate = (e: Entry): Entry => ({ ...e, key: uid(), mains: e.mains.map(() => ({ no: '', serial: NO_SERIAL })), comps: e.comps.map((c) => ({ ...c, no: '', serial: NO_SERIAL })) })

export const isBlank = (e: Entry) => !e.description.trim() && !e.cost.trim() && !e.article.trim()

export const centavosOf = (e: Entry) => { try { return e.cost.trim() ? pesoToCentavos(e.cost) : null } catch { return null } }
export const categoryOf = (e: Entry, threshold: number | undefined) => { const c = centavosOf(e); return c === null || threshold === undefined ? null : categorize(c, threshold) }
export const typeIdOf = (e: Entry) => Number(e.typeId) || undefined
export const unitOf = (e: Entry) => e.unit.trim()
export const articleOf = (e: Entry) => e.article.trim()
export const parCountOf = (entries: Entry[], threshold: number | undefined) => entries.reduce((n, e) => n + (categoryOf(e, threshold) === 'ppe' ? e.mains.length : 0), 0)

export function withQty(e: Entry, qty: string): Entry {
  const n = Math.min(Math.max(Number.parseInt(qty, 10) || 1, 1), 300)
  const mains = Number.isInteger(Number(qty)) && Number(qty) >= 1 ? e.mains.slice(0, n) : e.mains
  while (Number.isInteger(Number(qty)) && Number(qty) >= 1 && mains.length < n) mains.push({ no: '', serial: NO_SERIAL })
  return { ...e, qty, mains }
}

export type Slot = { entry: number; unit: number; group: string | null; year: number; month: number; code: string }
export function slotsOf(entries: Entry[], codes: Record<number, string>): Slot[] {
  return entries.flatMap((e, entry) => e.mains.map((_, unit) => {
    const t = typeIdOf(e)
    const ok = t !== undefined && codes[t] && isIsoDate(e.dateAcquired)
    return { entry, unit, group: ok ? `${e.dateAcquired.slice(0, 4)}|${t}` : null, year: Number(e.dateAcquired.slice(0, 4)), month: Number(e.dateAcquired.slice(5, 7)), code: ok ? codes[t!] : '' }
  }))
}

const NO_SERIES = '\u0000'
export function numbersOf(entries: Entry[], slots: Slot[], bases: Record<string, number>) {
  const slotList: NumberSlot[] = slots.map((s) => ({
    groupKey: s.group ?? 'none', year: s.year, month: s.month, code: s.code,
    typed: entries[s.entry].mains[s.unit].no.trim() || (s.group ? '' : NO_SERIES),
  }))
  const filled = suggestNumbers(slotList, bases).map((no) => (no === NO_SERIES ? '' : no))
  let at = 0
  const mains = entries.map((e) => e.mains.map(() => filled[at++]))
  const comps = entries.map((e, i) => {
    const main = mains[i][0] ?? ''
    const used: string[] = e.comps.filter((c) => c.no.trim() && main && c.no.trim().startsWith(main)).map((c) => c.no.trim().slice(main.length))
    return e.comps.map((c) => {
      if (c.no.trim()) return c.no.trim()
      if (!main) return ''
      const letter = nextComponentSuffix(used)
      used.push(letter)
      return `${main}${letter}`
    })
  })
  return { mains, comps }
}
