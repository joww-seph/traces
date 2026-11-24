import { useSyncExternalStore } from 'react'

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
  try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY) } catch { }
  window.dispatchEvent(new Event(EVENT))
}
const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb); window.addEventListener('storage', cb)
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener('storage', cb) }
}
export const useActiveCountId = () => useSyncExternalStore(subscribe, getActiveCountId, () => null)
