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

// who may be "Received by": only officers on the accountable list; q also searches their programs
// `includeInactive`: the report also lists officers who left but may still hold property
export const useReceivers = (q = '', includeInactive = false) =>
  useQuery({
    queryKey: ['officers', 'receivers', q, includeInactive],
    queryFn: () => api.get<Officer[]>(`/api/officers?canReceive=true${includeInactive ? '' : '&active=true'}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`),
  })

export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/api/settings') })

export const usePropertyTypes = () => useQuery({ queryKey: ['property-types'], queryFn: () => api.get<PropertyType[]>('/api/property-types') })
