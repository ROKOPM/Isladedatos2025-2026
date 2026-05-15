import axios from 'axios'
import type {
  KpiData,
  ClustersResponse,
  TopActividad,
  HeatmapRow,
  EventoHora,
  CalidadIA,
  PeriodoCalendario,
  DuracionHabitosResponse,
  CalidadAireResponse,
  SistemaResponse,
  IntervaloValue,
  FirmaTemporalRow,
  ContextoSocialResponse,
  TendenciasResponse,
  EventsPaginatedResponse,
  GlobalFilters,
  FiltrosResponse,
  FeatureWeights,
  ClusterJobStatus,
} from '@/types'

const api = axios.create({
  baseURL: '/api',
  timeout: 60000,
})

function buildParams(intervalo: IntervaloValue, filters?: GlobalFilters) {
  const params: Record<string, string | number> = { intervalo }
  if (filters) {
    if (filters.campus.length > 0) params.campus = filters.campus.join(',')
    if (filters.zonas.length > 0) params.zonas = filters.zonas.join(',')
    if (filters.camaras.length > 0) params.camaras = filters.camaras.join(',')
    if (filters.dias_semana.length > 0) params.dias_semana = filters.dias_semana.join(',')
    if (filters.horas.length > 0) params.horas = filters.horas.join(',')
    if (filters.desde) params.desde = filters.desde
    if (filters.hasta) params.hasta = filters.hasta
    if (filters.smokingMode) params.smoking_mode = 'true'
  }
  return params
}

function buildClusterFilters(intervalo: IntervaloValue, filters?: GlobalFilters) {
  return {
    intervalo,
    campus: filters?.campus ?? [],
    zonas: filters?.zonas ?? [],
    camaras: filters?.camaras ?? [],
    dias_semana: filters?.dias_semana ?? [],
    horas: filters?.horas ?? [],
    desde: filters?.desde,
    hasta: filters?.hasta,
    smoking_mode: filters?.smokingMode ? 'true' : undefined,
  }
}

// ── Existing endpoints ────────────────────────────────────────────────

export async function fetchKpis(intervalo: IntervaloValue, filters?: GlobalFilters): Promise<KpiData> {
  const { data } = await api.get<KpiData>('/kpis/', { params: buildParams(intervalo, filters) })
  return data
}

export async function fetchClusters(intervalo: IntervaloValue, filters?: GlobalFilters): Promise<ClustersResponse> {
  const { data } = await api.get<ClustersResponse>('/clusters/', { params: buildParams(intervalo, filters) })
  return data
}

export async function fetchClusterStatus(intervalo: IntervaloValue, filters?: GlobalFilters): Promise<ClusterJobStatus> {
  const { data } = await api.get<ClusterJobStatus>('/clusters/status/', { params: buildParams(intervalo, filters) })
  return data
}

export async function recomputeClusters(intervalo: IntervaloValue, filters?: GlobalFilters): Promise<ClusterJobStatus> {
  const { data } = await api.post<ClusterJobStatus>('/clusters/recompute/', {
    filters: buildClusterFilters(intervalo, filters),
  })
  return data
}

export async function fetchTopActividades(intervalo: IntervaloValue, filters?: GlobalFilters): Promise<TopActividad[]> {
  const { data } = await api.get<TopActividad[]>('/top-actividades/', { params: buildParams(intervalo, filters) })
  return data
}

export async function fetchHeatmap(intervalo: IntervaloValue, filters?: GlobalFilters): Promise<HeatmapRow[]> {
  const { data } = await api.get<HeatmapRow[]>('/heatmap/', { params: buildParams(intervalo, filters) })
  return data
}

export async function fetchEventosHora(intervalo: IntervaloValue, filters?: GlobalFilters): Promise<EventoHora[]> {
  const { data } = await api.get<EventoHora[]>('/eventos-hora/', { params: buildParams(intervalo, filters) })
  return data
}

export async function fetchCalidadIA(): Promise<CalidadIA> {
  const { data } = await api.get<CalidadIA>('/calidad-ia/')
  return data
}

export async function fetchCalendario(anio?: number, mes?: number): Promise<PeriodoCalendario[]> {
  const params: Record<string, number> = {}
  if (anio) params.anio = anio
  if (mes) params.mes = mes
  const { data } = await api.get<PeriodoCalendario[]>('/calendario/', { params })
  return data
}

export async function fetchFiltros(): Promise<FiltrosResponse> {
  const { data } = await api.get<FiltrosResponse>('/filtros/')
  return data
}

// ── New endpoints ─────────────────────────────────────────────────────

export async function fetchDuracionHabitos(intervalo: IntervaloValue, filters?: GlobalFilters): Promise<DuracionHabitosResponse> {
  const { data } = await api.get<DuracionHabitosResponse>('/duracion-habitos/', { params: buildParams(intervalo, filters) })
  return data
}

export async function fetchCalidadAire(intervalo: IntervaloValue, filters?: GlobalFilters): Promise<CalidadAireResponse> {
  const { data } = await api.get<CalidadAireResponse>('/calidad-aire/', { params: buildParams(intervalo, filters) })
  return data
}

export async function fetchSistema(): Promise<SistemaResponse> {
  const { data } = await api.get<SistemaResponse>('/sistema/')
  return data
}

export async function fetchFirmaTemporal(intervalo: IntervaloValue, filters?: GlobalFilters): Promise<FirmaTemporalRow[]> {
  const { data } = await api.get<FirmaTemporalRow[]>('/firma-temporal/', { params: buildParams(intervalo, filters) })
  return data
}

export async function fetchContextoSocial(intervalo: IntervaloValue, filters?: GlobalFilters): Promise<ContextoSocialResponse> {
  const { data } = await api.get<ContextoSocialResponse>('/contexto-social/', { params: buildParams(intervalo, filters) })
  return data
}

export async function fetchTendencias(intervalo: IntervaloValue, filters?: GlobalFilters, agrupacion?: string): Promise<TendenciasResponse> {
  const params = buildParams(intervalo, filters)
  if (agrupacion) params.agrupacion = agrupacion
  const { data } = await api.get<TendenciasResponse>('/tendencias/', { params })
  return data
}

export async function fetchEventsPaginated(intervalo: IntervaloValue, page: number, limit: number, filters?: GlobalFilters): Promise<EventsPaginatedResponse> {
  const params = buildParams(intervalo, filters)
  params.page = page
  params.limit = limit
  const { data } = await api.get<EventsPaginatedResponse>('/events/', { params })
  return data
}

// ── Scientific Observatory Endpoints ─────────────────────────────────

export async function fetchSnapshots(): Promise<unknown> {
  const { data } = await api.get('/snapshots/')
  return data
}

export async function createSnapshot(payload: {
  filters_json: GlobalFilters & { intervalo: IntervaloValue }
  user_notes: string
  metadata_json?: Record<string, unknown>
}): Promise<unknown> {
  const { data } = await api.post('/snapshots/', payload)
  return data
}

export async function fetchSnapshotDetail(uuid: string): Promise<unknown> {
  const { data } = await api.get(`/snapshots/${uuid}/`)
  return data
}

export async function validateSnapshot(uuid: string): Promise<unknown> {
  const { data } = await api.get(`/validate-snapshot/${uuid}/`)
  return data
}

export async function checkGuardrails(payload: unknown): Promise<unknown> {
  const { data } = await api.post('/guardrails/', payload)
  return data
}

export async function generateMethodology(payload: unknown): Promise<unknown> {
  const { data } = await api.post('/methodology/', payload)
  return data
}

// ── Custom Clustering (Laboratorio de Clusters) ─────────────────────

export async function fetchCustomClusters(
  weights: FeatureWeights,
  filters?: GlobalFilters,
): Promise<ClustersResponse> {
  const { data } = await api.post<ClustersResponse>('/clusters/custom/', {
    filters: filters || {},
    weights,
    n_clusters: 8,
  }, { timeout: 300000 })
  return data
}
