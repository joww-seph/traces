import { useQuery } from '@tanstack/react-query'
import { api } from '@/api'

export type Officer = { id: string; fullName: string; shortName: string; position: string; office: string; active: boolean }
export type Settings = {
  entityName: string; defaultFundCluster: string; ppeThresholdCentavos: number
  cardRowMode: 'merged' | 'split'; publicBaseUrl: string; ppeRegistryTitle: string
}

export const useOfficers = (activeOnly = false) =>
  useQuery({ queryKey: ['officers', activeOnly], queryFn: () => api.get<Officer[]>(`/api/officers${activeOnly ? '?active=true' : ''}`) })

export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/api/settings') })
