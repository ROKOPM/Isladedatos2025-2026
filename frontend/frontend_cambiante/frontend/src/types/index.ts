// ── KPIs ──────────────────────────────────────────────────────────────
export interface KpiData {
  tasa_fumado: number | null
  tasa_fumado_delta: number | null
  hora_pico: string | null
  hora_pico_n: number | null
  metodo_pico: string | null
  metodo_incidencia: string | null
  eventos_riesgo: number | null
  pm10_promedio: number | null
  patrones_activos: number | null
  total_registros?: number | null
  fecha_desde?: string | null
  fecha_hasta?: string | null
}

// ── Clusters (Comportamientos) ──────────────────────────────────────
export interface ClusterPoint {
  id: number
  umap_x: number
  umap_y: number
  cluster_id: number
  etiqueta: string
  cluster_name?: string
  habit_name?: string
  meta_etiqueta: string
  meta_habit_name?: string
  description?: string
  dominant_features?: string[]
  warnings?: string[]
  fumando: boolean
  actividad: string
  hora: number
  pm10: number
}

// ── Feature Weights para clustering custom ─────────────────────────
export type FeatureGroup = 'actividad' | 'postura' | 'interaccion' | 'riesgo' | 'fumando' | 'ambiental' | 'turno'

export interface FeatureWeights {
  actividad: number
  postura: number
  interaccion: number
  riesgo: number
  fumando: number
  ambiental: number
  turno: number
}

export const DEFAULT_FEATURE_WEIGHTS: FeatureWeights = {
  actividad: 3,
  postura: 1,
  interaccion: 1,
  riesgo: 1,
  fumando: 5,
  ambiental: 1,
  turno: 0.5,
}

export const FEATURE_GROUP_LABELS: Record<FeatureGroup, string> = {
  actividad: 'Actividad',
  postura: 'Postura',
  interaccion: 'Interacción Social',
  riesgo: 'Riesgo/Salud',
  fumando: 'Fumando',
  ambiental: 'Ambiental',
  turno: 'Turno',
}

export const FEATURE_GROUP_DESC: Record<FeatureGroup, string> = {
  actividad: '8 dimensiones: caminar, comer, descansar, estudiar, reunión, celular, otro, escena vacía',
  postura: '5 dimensiones: caminando, parado, sentado, recostado, otro',
  interaccion: '5 dimensiones: solo, pareja, grupo pequeño, grupo grande, multitud',
  riesgo: '4 niveles según cuartiles de personas: bajo, moderado, alto, crítico',
  fumando: '1 dimensión binaria: fumando detectado (peso x5 por defecto)',
  ambiental: '5 dimensiones: presencia, conteo normalizado, smog alto, temperatura, humedad',
  turno: '3 turnos: mañana (6-12), tarde (12-18), noche (18-6)',
}

export const WEIGHT_OPTIONS = [0, 0.5, 1, 2, 3, 5]

export interface ClusterSummary {
  etiqueta: string
  conteo: number
  color: string
}

export interface ClustersResponse {
  puntos: ClusterPoint[]
  tasas_fumado: { etiqueta: string; total: number; fumando: number; tasa: number }[]
  total_registros?: number
  nota?: string
  meta_labels?: Record<string, string>
  cluster_profiles?: Record<string, unknown>
  quality_metrics?: Record<string, number | null>
  warnings?: string[]
  status?: ClusterJobStatus
  metadata?: ClusterMetadata
}

export type ClusterJobStage =
  | 'queued'
  | 'loading_data'
  | 'vectorizing'
  | 'pca'
  | 'kmeans'
  | 'labeling'
  | 'meta_habits'
  | 'writing_results'
  | 'ready'
  | 'failed'

export interface ClusterJobStatus {
  job_id: string
  started_at: string | null
  updated_at: string
  stage: ClusterJobStage
  progress: number
  estimated_seconds_remaining: number | null
  elapsed_seconds: number
  records_total: number
  records_processed: number
  cache_status: 'hit' | 'miss' | 'stale' | 'disabled'
  message: string
  query_hash?: string
  requested_query_hash?: string
  filters?: Record<string, unknown>
  feature_mask?: Record<string, boolean>
  clustering_config?: Record<string, unknown>
  duration_seconds?: number
  timings?: Record<string, number>
  error?: string
}

export interface ClusterMetadata {
  query_hash: string
  labels_query_hash?: string
  filters: Record<string, unknown>
  feature_mask: Record<string, boolean>
  clustering_config: Record<string, unknown>
  is_current: boolean
  cache_status: string
  sql_ms?: number
  labels_ms?: number
  total_ms?: number
  points_returned?: number
  labels_metadata?: Record<string, unknown>
}

// ── Top Actividades ─────────────────────────────────────────────────
export interface TopActividad {
  actividad: string
  conteo: number
  porcentaje: number
}

// ── Heatmap ─────────────────────────────────────────────────────────
export interface HeatmapCell {
  hora: number
  valor: number
}

export interface HeatmapRow {
  dia: string
  horas: HeatmapCell[]
}

// ── Eventos por hora ────────────────────────────────────────────────
export interface EventoHora {
  hora: string
  total: number
  fumadores: number
  min_val?: number
  q1?: number
  mediana?: number
  q3?: number
  max_val?: number
  n_dias?: number
  [key: string]: string | number | undefined  // actividades dinámicas
}

// ── Calidad IA ──────────────────────────────────────────────────────
export interface CalidadIA {
  total: number
  resumen_corto: number
  pct_corto: number
  pct_valido: number
}

// ── Calendario ──────────────────────────────────────────────────────
export interface PeriodoCalendario {
  fecha: string
  tipo_periodo: string
  nombre_periodo: string
}

// ── Duración de hábitos (NUEVO) ─────────────────────────────────────
export interface SesionHabito {
  actividad: string
  inicio: string
  fin: string
  capturas: number
  personas_promedio: number
  duracion_minutos: number
}

export interface DuracionHabitosResponse {
  sesiones: SesionHabito[]
  resumen: {
    mediana_global: number | null
    actividad_mas_larga: string | null
    duracion_mas_larga: number | null
    actividad_mas_frecuente: string | null
    frecuencia_max: number | null
  }
}

// ── Calidad del Aire (NUEVO) ────────────────────────────────────────
export interface LecturaAire {
  timestamp: string
  pm10: number | null
  temperatura: number
  humedad: number
}

export interface CorrelacionPM10Fumado {
  pm10: number
  tasa_fumado: number
  hora: number
  personas: number
}

export interface ResumenFranja {
  franja: string
  pm10_promedio: number
  temperatura_promedio: number
  humedad_promedio: number
  eventos_fumado: number
}

export interface FumadoEvento {
  hora_utc: string
  eventos_fumando: number
}

export interface CalidadAireResponse {
  actual: {
    pm10: number | null
    temperatura: number | null
    humedad: number | null
    calidad_aire_label: string | null
  }
  timeline: LecturaAire[]
  fumado: FumadoEvento[]
  correlacion: CorrelacionPM10Fumado[]
  resumen_franjas: ResumenFranja[]
}

// ── Sistema (NUEVO) ─────────────────────────────────────────────────
export interface CapaPipeline {
  nombre: string
  completados: number
  pendientes: number
  total: number
}

export interface LecturaDavis {
  timestamp: string
  pm10: number | null
  temperatura: number | null
  humedad: number | null
  presion: number | null
  viento: number | null
}

export interface HechoReciente {
  id: number
  timestamp: string
  conteo_personas: number
  fumando: boolean
  actividad: string
  patron_ia: string
  nivel_riesgo: string
  pm10: number | null
}

export interface SistemaResponse {
  capas: CapaPipeline[]
  lecturas_davis: LecturaDavis[]
  hechos_recientes: HechoReciente[]
  info_pipeline: string
}

// ── Firma Temporal (NUEVO) ──────────────────────────────────────────
export interface FirmaTemporalRow {
  hora: number
  actividad: string
  patron_ia: string
  frecuencia: number
}

// ── Intervalo ───────────────────────────────────────────────────────
export type IntervaloValue = '1 day' | '7 days' | '15 days' | '30 days' | '90 days' | '3650 days'

export interface GlobalFilters {
  campus: string[]
  zonas: string[]
  camaras: string[]
  dias_semana: string[]
  horas: string[]
  desde?: string
  hasta?: string
  smokingMode?: boolean
}

export interface GeoOption {
  camara: string
  zona: string
  campus: string
}

export interface FiltrosResponse {
  geo: GeoOption[]
  habitos: string[]
}

// ── Contexto Social (Propuesta 1) ──────────────────────────────────
export interface ContextoSocialItem {
  contexto: string
  eventos: number
  porcentaje: number
  total_contexto: number
  tasa_fumado: number
}

export interface ContextoHoraItem {
  hora: number
  Solo: number
  Pareja: number
  Grupo: number
}

export interface ContextoSocialResponse {
  por_contexto: ContextoSocialItem[]
  fumado_solo: number
  fumado_pareja: number
  fumado_grupo: number
  total_fumado: number
  total_observaciones: number
  por_hora: ContextoHoraItem[]
}

// ── Tendencias Evolutivas (Propuesta 6) ─────────────────────────
export interface TendenciaItem {
  periodo: string
  total: number
  fumado: number
  tasa_fumado: number
  pm10_promedio: number
}

export interface TendenciasResponse {
  tendencias: TendenciaItem[]
  resumen: {
    tasa_inicial: number | null
    tasa_final: number | null
    cambio_pct: number | null
    tendencia: string
  }
}

// ── Eventos Paginados (Sprint 1) ──────────────────────────────────
export interface EventRow {
  id: number
  timestamp: string
  actividad: string
  fumando: boolean
  conteo_personas: number
  riesgo: string
  pm10: number | null
  camara: string
  zona: string
  campus: string
}

export interface EventsPaginatedResponse {
  data: EventRow[]
  total_events: number
  period: { start?: string; end?: string }
  metadata: {
    smoking_events: number
    page: number
    limit: number
    total_pages: number
  }
}
