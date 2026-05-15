import { useQuery } from '@tanstack/react-query'
import {
  fetchKpis, fetchEventosHora, fetchHeatmap, fetchTopActividades,
  fetchClusters, fetchFirmaTemporal, fetchDuracionHabitos,
  fetchCalidadAire, fetchCalendario,
  fetchContextoSocial, fetchTendencias,
  fetchCalidadIA, fetchSistema, fetchEventsPaginated, fetchClusterStatus,
} from '@/api/client'
import type { IntervaloValue, GlobalFilters, ContextoSocialResponse, TendenciasResponse } from '@/types'

const STALE_2M = 2 * 60 * 1000
const STALE_5M = 5 * 60 * 1000
const STALE_1H = 60 * 60 * 1000

function stableKey(v: unknown): string {
  if (!v) return 'undefined'
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return [...value].sort()
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, val]) => [key, normalize(val)]),
      )
    }
    return value
  }
  return JSON.stringify(normalize(v))
}

export function useKpis(intervalo: IntervaloValue, filters?: GlobalFilters) {
  return useQuery({
    queryKey: ['kpis', intervalo, stableKey(filters)],
    queryFn: () => fetchKpis(intervalo, filters),
    staleTime: STALE_5M,
  })
}

export function useEventosHora(intervalo: IntervaloValue, filters?: GlobalFilters) {
  return useQuery({
    queryKey: ['eventosHora', intervalo, stableKey(filters)],
    queryFn: () => fetchEventosHora(intervalo, filters),
    staleTime: STALE_5M,
  })
}

export function useHeatmap(intervalo: IntervaloValue, filters?: GlobalFilters) {
  return useQuery({
    queryKey: ['heatmap', intervalo, stableKey(filters)],
    queryFn: () => fetchHeatmap(intervalo, filters),
    staleTime: STALE_5M,
  })
}

export function useTopActividades(intervalo: IntervaloValue, filters?: GlobalFilters) {
  return useQuery({
    queryKey: ['topActividades', intervalo, stableKey(filters)],
    queryFn: () => fetchTopActividades(intervalo, filters),
    staleTime: STALE_5M,
  })
}

export function useClusters(intervalo: IntervaloValue, filters?: GlobalFilters) {
  return useQuery({
    queryKey: ['clusters', intervalo, stableKey(filters)],
    queryFn: () => fetchClusters(intervalo, filters),
    staleTime: 0,
  })
}

export function useClusterJobStatus(intervalo: IntervaloValue, filters?: GlobalFilters) {
  return useQuery({
    queryKey: ['clustersStatus', intervalo, stableKey(filters)],
    queryFn: () => fetchClusterStatus(intervalo, filters),
    refetchInterval: (query) => {
      const stage = query.state.data?.stage
      return stage && stage !== 'ready' && stage !== 'failed' ? 2000 : false
    },
    staleTime: 0,
  })
}

export function useFirmaTemporal(intervalo: IntervaloValue, filters?: GlobalFilters) {
  return useQuery({
    queryKey: ['firmaTemporal', intervalo, stableKey(filters)],
    queryFn: () => fetchFirmaTemporal(intervalo, filters),
    staleTime: STALE_5M,
  })
}

export function useDuracionHabitos(intervalo: IntervaloValue, filters?: GlobalFilters) {
  return useQuery({
    queryKey: ['duracionHabitos', intervalo, stableKey(filters)],
    queryFn: () => fetchDuracionHabitos(intervalo, filters),
    staleTime: STALE_5M,
  })
}

export function useCalidadAire(intervalo: IntervaloValue, filters?: GlobalFilters) {
  return useQuery({
    queryKey: ['calidadAire', intervalo, stableKey(filters)],
    queryFn: () => fetchCalidadAire(intervalo, filters),
    staleTime: STALE_2M,
  })
}

export function useCalendario(anio: number, mes: number) {
  return useQuery({
    queryKey: ['calendario', anio, mes],
    queryFn: () => fetchCalendario(anio, mes),
    staleTime: STALE_1H,
  })
}

export function useContextoSocial(intervalo: IntervaloValue, filters?: GlobalFilters) {
  return useQuery<ContextoSocialResponse>({
    queryKey: ['contextoSocial', intervalo, stableKey(filters)],
    queryFn: () => fetchContextoSocial(intervalo, filters),
    staleTime: STALE_5M,
  })
}

export function useTendencias(intervalo: IntervaloValue, filters?: GlobalFilters, agrupacion?: string) {
  return useQuery<TendenciasResponse>({
    queryKey: ['tendencias', intervalo, stableKey(filters), agrupacion],
    queryFn: () => fetchTendencias(intervalo, filters, agrupacion),
    staleTime: STALE_5M,
  })
}

export function useCalidadIA() {
  return useQuery({
    queryKey: ['calidadIA'],
    queryFn: () => fetchCalidadIA(),
    staleTime: STALE_1H,
  })
}

export function useSistema() {
  return useQuery({
    queryKey: ['sistema'],
    queryFn: () => fetchSistema(),
    staleTime: STALE_2M,
  })
}

export function useEventsPaginated(intervalo: IntervaloValue, page: number, limit: number, filters?: GlobalFilters) {
  return useQuery({
    queryKey: ['eventsPaginated', intervalo, page, limit, stableKey(filters)],
    queryFn: () => fetchEventsPaginated(intervalo, page, limit, filters),
    staleTime: STALE_5M,
  })
}
