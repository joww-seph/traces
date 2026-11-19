import { useSyncExternalStore } from 'react'

// Physical count by QR scan (decision 2026-11-19). The count this phone is counting for is remembered in the browser, so the
// scan page (a public page) shows the count panel only on a device where staff started or resumed a count.
export type Count = {
  id: string; officerId: string; officerName: string; category: 'semi' | 'ppe'; asAt: string; closedAt: string | null
  total: number; counted: number; unserviceable: number
}
export type ScanResult = Count & { propertyNo: string; article: string; condition: 'serviceable' | 'unserviceable' }

const KEY = 'traces:count'
const EVENT = 'traces:count'

export function getActiveCountId(): string | null {
  try { return localStorage.getItem(KEY) } catch { return null }
}
export function setActiveCountId(id: string | null) {
  try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY) } catch { /* storage unavailable: no count on this device */ }
  window.dispatchEvent(new Event(EVENT))
}
const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb); window.addEventListener('storage', cb)
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener('storage', cb) }
}
export const useActiveCountId = () => useSyncExternalStore(subscribe, getActiveCountId, () => null)
