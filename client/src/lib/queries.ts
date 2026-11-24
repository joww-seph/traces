import { useQuery } from '@tanstack/react-query'
import { api } from '@/api'

export type Officer = {
  id: string; fullName: string; shortName: string; position: string; office: string; active: boolean
  canReceive: boolean; designations: string[]
}
export type Settings = {
  entityName: string; defaultFundCluster: string; ppeThresholdCentavos: number
  cardRowMode: 'merged' | 'split'; publicBaseUrl: string; ppeRegistryTitle: string
  icsFormCode: string; icsFormRevision: string; parFormCode: string; parFormRevision: string
  defaultIssuedByOfficerId: string | null
}
export type PropertyType = { id: number; code: string; name: string; active: boolean }
export type Card = {
  id: string; propertyTypeId: number; propertyTypeCode: string; category: 'semi' | 'ppe'
  article: string; description: string; unit: string; active: boolean
}

export const useOfficers = (activeOnly = false) =>
  useQuery({ queryKey: ['officers', activeOnly], queryFn: () => api.get<Officer[]>(`/api/officers${activeOnly ? '?active=true' : ''}`) })

export const useReceivers = (q = '', includeInactive = false) =>
  useQuery({
    queryKey: ['officers', 'receivers', q, includeInactive],
    queryFn: () => api.get<Officer[]>(`/api/officers?canReceive=true${includeInactive ? '' : '&active=true'}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`),
  })

export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/api/settings') })

export type Unit = { code: string; name: string; active: boolean }
export const useUnits = () => useQuery({ queryKey: ['units'], queryFn: () => api.get<Unit[]>('/api/units') })
export const usePropertyTypes = () => useQuery({ queryKey: ['property-types'], queryFn: () => api.get<PropertyType[]>('/api/property-types') })
