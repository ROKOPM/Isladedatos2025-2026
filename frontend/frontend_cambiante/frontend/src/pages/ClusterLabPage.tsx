import { useState, useMemo, useCallback, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Grid3X3, Filter, Info, Loader2, AlertTriangle, Table, FlaskConical, RotateCcw, RefreshCw, Database, Network, CheckCircle2, ChevronDown, Eye, EyeOff } from 'lucide-react'
import { useClusterJobStatus, useClusters } from '@/hooks/queries'
import { VectorScatterCanvas } from '@/components/dashboard/vector-scatter-canvas'
import { FeatureWeightsPanel } from '@/components/analytics/FeatureWeightsPanel'
import { DataWarningToast, ToastContainer } from '@/components/ui/data-warning-toast'
import { EmptyState } from '@/components/ui/empty-state'
import { SCI_COLORS } from '@/scientific/ScientificColorRegistry'
import { fetchCustomClusters, recomputeClusters } from '@/api/client'
import type { ColorBy } from '@/components/dashboard/vector-scatter-canvas'
import type { IntervaloValue, GlobalFilters, FeatureWeights, ClusterPoint } from '@/types'

interface Props {
  intervalo: IntervaloValue
  filters?: GlobalFilters
}

interface RawEventRow {
  id: number
  timestamp: string
  actividad: string
  fumando: boolean
  conteo_personas: number
  riesgo: string
  pm10: number
  zona: string
  camara: string
}

interface RawEventsData {
  total_events: number
  data: RawEventRow[]
  metadata: {
    smoking_events: number
    total_pages: number
  }
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: { error?: string } } }).response
    if (response?.data?.error) return response.data.error
  }
  return fallback
}

function clusterDisplayName(p: ClusterPoint): string {
  return p.habit_name || p.cluster_name || p.etiqueta || 'Patrón conductual'
}

function clusterTechnicalName(p: ClusterPoint): string {
  return p.cluster_name || p.etiqueta || clusterDisplayName(p)
}

function metaFamilyName(p: ClusterPoint): string | undefined {
  const meta = p.meta_habit_name || p.meta_etiqueta
  const habit = clusterDisplayName(p)
  return meta && meta !== habit ? meta : undefined
}

const colorLabels: Record<ColorBy, string> = {
  cluster: 'Por hábito',
  fumando: 'Por fumado',
  actividad: 'Por actividad',
  hora: 'Por hora',
  pm10: 'Por PM10',
}

export function ClusterLabPage({ intervalo, filters }: Props) {
  const queryClient = useQueryClient()
  const clustersQuery = useClusters(intervalo, filters)
  const statusQuery = useClusterJobStatus(intervalo, filters)

  const [selectedCluster, setSelectedCluster] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'2d' | 'raw'>('2d')
  const [showSemanticFamilies, setShowSemanticFamilies] = useState(false)
  const [showDescriptions, setShowDescriptions] = useState(false)
  const [colorBy, setColorBy] = useState<ColorBy>('cluster')
  const [eventsData, setEventsData] = useState<RawEventsData | null>(null)
  const [eventsLoading, setEventsLoading] = useState(false)
  const [eventsPage, setEventsPage] = useState(1)

  // Custom clustering state
  const [customPoints, setCustomPoints] = useState<ClusterPoint[] | null>(null)
  const [isCustom, setIsCustom] = useState(false)
  const [isCustomLoading, setIsCustomLoading] = useState(false)
  const [lastFilterHash, setLastFilterHash] = useState('')
  const [customError, setCustomError] = useState<string | null>(null)
  const [showPanel, setShowPanel] = useState(false)
  const [isRecomputing, setIsRecomputing] = useState(false)

  const currentFilterHash = useMemo(() => {
    if (!filters) return ''
    return JSON.stringify(filters)
  }, [filters])

  const filtersChanged = isCustom && currentFilterHash !== lastFilterHash && lastFilterHash !== ''

  const points = useMemo(() => customPoints ?? clustersQuery.data?.puntos ?? [], [customPoints, clustersQuery.data?.puntos])
  const status = clustersQuery.data?.status ?? statusQuery.data
  const metadata = clustersQuery.data?.metadata
  const isCurrent = isCustom ? true : metadata?.is_current

  const loadEventsData = useCallback(async (page: number) => {
    setEventsLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('intervalo', intervalo)
      params.set('page', page.toString())
      params.set('limit', '100')
      if (filters?.campus?.length) params.set('campus', filters.campus.join(','))
      if (filters?.zonas?.length) params.set('zonas', filters.zonas.join(','))
      if (filters?.camaras?.length) params.set('camaras', filters.camaras.join(','))
      if (filters?.dias_semana?.length) params.set('dias_semana', filters.dias_semana.join(','))
      if (filters?.horas?.length) params.set('horas', filters.horas.join(','))
      if (filters?.desde) params.set('desde', filters.desde)
      if (filters?.hasta) params.set('hasta', filters.hasta)
      const res = await fetch(`/api/events/?${params.toString()}`)
      if (!res.ok) throw new Error('Error al cargar observaciones')
      const data = await res.json() as RawEventsData
      setEventsData(data)
      setEventsPage(page)
    } catch {
      // silently fail — UI shows empty state
    } finally {
      setEventsLoading(false)
    }
  }, [filters, intervalo])

  useEffect(() => {
    if (viewMode === 'raw') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadEventsData(1)
    }
  }, [loadEventsData, viewMode])

  const handleGenerate = useCallback(async (weights: FeatureWeights) => {
    setIsCustomLoading(true)
    setCustomError(null)

    try {
      const resp = await fetchCustomClusters(weights, filters)
      setCustomPoints(resp.puntos)
      setIsCustom(true)
      setLastFilterHash(currentFilterHash)
    } catch (e: unknown) {
      setCustomError(errorMessage(e, 'Error al generar clusters'))
      setCustomPoints(null)
    } finally {
      setIsCustomLoading(false)
    }
  }, [filters, currentFilterHash])

  const handleReset = useCallback(() => {
    setCustomPoints(null)
    setIsCustom(false)
    setCustomError(null)
    setLastFilterHash('')
  }, [])

  const handleRecompute = useCallback(async () => {
    setIsRecomputing(true)
    setCustomError(null)
    try {
      await recomputeClusters(intervalo, filters)
      await queryClient.invalidateQueries({ queryKey: ['clustersStatus'] })
      await queryClient.invalidateQueries({ queryKey: ['clusters'] })
    } catch (e: unknown) {
      setCustomError(errorMessage(e, 'No se pudo solicitar la actualización del análisis'))
    } finally {
      setIsRecomputing(false)
    }
  }, [filters, intervalo, queryClient])

  const activeFilterSummary = useMemo(() => {
    const intervaloLabel = intervalo
      .replace(' days', ' días')
      .replace(' day', ' día')
      .replace(' hours', ' horas')
      .replace(' hour', ' hora')
    const parts: string[] = [`Periodo: ${intervaloLabel}`]
    if (filters?.campus?.length) parts.push(`Campus: ${filters.campus.join(', ')}`)
    if (filters?.zonas?.length) parts.push(`Zonas: ${filters.zonas.join(', ')}`)
    if (filters?.camaras?.length) parts.push(`Cámaras: ${filters.camaras.join(', ')}`)
    if (filters?.dias_semana?.length) parts.push(`Días: ${filters.dias_semana.join(', ')}`)
    if (filters?.horas?.length) parts.push(`Horas: ${filters.horas.join(', ')}`)
    if (filters?.desde || filters?.hasta) parts.push(`Fechas: ${filters.desde ?? 'inicio'} a ${filters.hasta ?? 'actual'}`)
    return parts
  }, [filters, intervalo])

  const clusterSummaries = useMemo(() => {
    const counts: Record<string, number> = {}
    points.forEach((p) => {
      const name = clusterDisplayName(p)
      counts[name] = (counts[name] || 0) + 1
    })
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count], i) => ({
        etiqueta: name,
        conteo: count,
        color: SCI_COLORS.clusters[i % SCI_COLORS.clusters.length],
      }))
  }, [points])

  const semanticSummaries = useMemo(() => {
    const byName = new Map<string, {
      name: string
      technical: string
      family?: string
      count: number
      smoking: number
      activities: Map<string, number>
    }>()
    points.forEach((p) => {
      const name = clusterDisplayName(p)
      const current = byName.get(name) ?? {
        name,
        technical: clusterTechnicalName(p),
        family: metaFamilyName(p),
        count: 0,
        smoking: 0,
        activities: new Map<string, number>(),
      }
      current.count += 1
      if (p.fumando) current.smoking += 1
      current.activities.set(p.actividad, (current.activities.get(p.actividad) ?? 0) + 1)
      byName.set(name, current)
    })
    return Array.from(byName.values())
      .sort((a, b) => b.count - a.count)
      .map((item, i) => ({
        ...item,
        color: SCI_COLORS.clusters[i % SCI_COLORS.clusters.length],
        percentage: points.length > 0 ? Math.round((item.count / points.length) * 1000) / 10 : 0,
        activity: Array.from(item.activities.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'sin actividad dominante',
        smokingRate: item.count > 0 ? Math.round((item.smoking / item.count) * 1000) / 10 : 0,
      }))
  }, [points])

  const colorMap = useMemo(() => {
    const m: Record<string, string> = {}
    clusterSummaries.forEach((c) => { m[c.etiqueta] = c.color })
    return m
  }, [clusterSummaries])

  const filteredPoints = useMemo(() => {
    if (!selectedCluster) return points
    return points.filter((p) => {
      return clusterDisplayName(p) === selectedCluster
    })
  }, [points, selectedCluster])

  const stage = status?.stage ?? 'queued'
  const isBusy = Boolean(status?.job_id) && !['ready', 'failed'].includes(stage)
  const hasFailed = stage === 'failed'
  const analysisCurrent = isCurrent !== false && !filtersChanged
  const records = status?.records_total || points.length
  const progress = Math.max(0, Math.min(100, status?.progress ?? 0))
  const updated = status?.updated_at ? new Date(status.updated_at).toLocaleString('es-MX') : 'sin registro'
  const stageLabel: Record<string, string> = {
    queued: 'Listo para generar',
    loading_data: 'Preparando observaciones',
    vectorizing: 'Calculando variables',
    pca: 'Calculando PCA',
    kmeans: 'Agrupando hábitos',
    labeling: 'Interpretando hábitos',
    meta_habits: 'Organizando categorías de hábitos',
    writing_results: 'Guardando resultado',
    ready: 'Análisis actualizado',
    failed: 'No se pudo completar',
  }
  const statusTitle = hasFailed
    ? 'No se pudo completar'
    : isBusy || isRecomputing
      ? stageLabel[stage] ?? 'Generando análisis'
      : analysisCurrent
        ? 'Análisis actualizado'
        : 'Los filtros cambiaron'
  const statusDescription = hasFailed
    ? (status?.error || 'Intenta ampliar el periodo o reducir filtros.')
    : isBusy || isRecomputing
      ? 'Actualizando hábitos para los filtros activos.'
      : analysisCurrent
        ? 'Los hábitos corresponden a los filtros actuales.'
        : 'Genera nuevamente el análisis para actualizar el mapa.'
  const selectedSummary = selectedCluster
    ? semanticSummaries.find((item) => item.name === selectedCluster)
    : undefined
  const smokingEvents = filteredPoints.filter((d) => d.fumando).length
  const smokingRiskPercentage = filteredPoints.length > 0 ? (smokingEvents / filteredPoints.length) * 100 : 0
  const smokingRiskLevel = smokingRiskPercentage >= 15 ? 'Alto' : smokingRiskPercentage >= 5 ? 'Moderado' : 'Bajo'
  const smokingRiskStyle = smokingRiskPercentage >= 15
    ? 'border-destructive/30 bg-destructive/10 text-destructive'
    : smokingRiskPercentage >= 5
      ? 'border-primary/25 bg-primary/10 text-primary'
      : 'border-accent/25 bg-accent/10 text-accent'

  return (
    <div className="space-y-4">
      <ToastContainer>
        <DataWarningToast
          id="clusterlab-methodology-v1"
          title="Laboratorio de Hábitos"
          body="Los agrupamientos son resultados exploratorios de PCA 2D y K-Means sobre variables conductuales agregadas; no representan categorías diagnósticas ni clínicas."
          variant="info"
        />
      </ToastContainer>

      <section className="sci-panel sticky top-0 z-20 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85">
        <div className="p-3 lg:p-4 space-y-3">
          <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
            <div className="min-w-0 flex items-start gap-3">
              <div className={`mt-0.5 h-9 w-9 shrink-0 rounded flex items-center justify-center border ${
                hasFailed
                  ? 'bg-destructive/10 text-destructive border-destructive/25'
                  : analysisCurrent
                    ? 'bg-primary/10 text-primary border-primary/25'
                    : 'bg-warning/10 text-warning border-warning/30'
              }`}>
                {hasFailed ? <AlertTriangle className="w-4 h-4" /> : isBusy || isRecomputing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-editorial text-base font-bold text-foreground">Laboratorio de Hábitos</h2>
                  {isCustom && <span className="gov-badge gov-badge-info normal-case tracking-normal">Pesos personalizados</span>}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{statusTitle}. {statusDescription}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mr-0 xl:mr-1">
                <div className="rounded border border-border bg-background/65 px-3 py-2">
                  <span className="block text-[10px] text-muted-foreground">N</span>
                  <span className="text-sm font-semibold text-foreground">{records.toLocaleString('es-MX')}</span>
                </div>
                <div className="rounded border border-border bg-background/65 px-3 py-2">
                  <span className="block text-[10px] text-muted-foreground">Hábitos</span>
                  <span className="text-sm font-semibold text-foreground">{semanticSummaries.length.toLocaleString('es-MX')}</span>
                </div>
                <div className="hidden sm:block rounded border border-border bg-background/65 px-3 py-2">
                  <span className="block text-[10px] text-muted-foreground">Mapa</span>
                  <span className="text-sm font-semibold text-foreground">PCA 2D</span>
                </div>
              </div>

              <Button
                size="sm"
                onClick={handleRecompute}
                disabled={isRecomputing || isBusy}
                className="h-9 text-xs gap-1.5"
                aria-label="Generar análisis para los filtros actuales"
              >
                {isRecomputing || isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Generar análisis
              </Button>
              <Button
                variant={showPanel ? 'default' : 'outline'}
                size="sm"
                onClick={() => setShowPanel((v) => !v)}
                className="h-9 text-xs gap-1.5"
                aria-expanded={showPanel}
                aria-controls="habit-variables-panel"
              >
                <FlaskConical className="w-3.5 h-3.5" />
                Ajustar variables
              </Button>
              <Button
                variant={showDescriptions ? 'default' : 'outline'}
                size="sm"
                onClick={() => setShowDescriptions((v) => !v)}
                className="h-9 text-xs gap-1.5"
                aria-pressed={showDescriptions}
              >
                {showDescriptions ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                {showDescriptions ? 'Ocultar descripciones' : 'Mostrar descripciones'}
              </Button>
            </div>
          </div>

          {(isBusy || progress > 0) && (
            <div className="space-y-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-secondary" aria-label={`Avance del análisis ${progress}%`}>
                <div className="h-full bg-primary transition-all duration-500" style={{ width: `${progress}%` }} />
              </div>
              {isBusy && <p className="text-[11px] text-muted-foreground">{progress}% completado</p>}
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            {activeFilterSummary.slice(0, 5).map((item) => (
              <span key={item} className="rounded border border-border bg-background/60 px-2 py-1 text-[11px] text-muted-foreground">
                {item}
              </span>
            ))}
            {activeFilterSummary.length > 5 && (
              <span className="rounded border border-border bg-background/60 px-2 py-1 text-[11px] text-muted-foreground">
                +{activeFilterSummary.length - 5} filtros
              </span>
            )}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_380px] gap-4 items-start">
        <div className="min-w-0 space-y-4">
        {showPanel && (
          <div id="habit-variables-panel" className="max-w-full xl:max-w-[380px]">
            <FeatureWeightsPanel
              onGenerate={handleGenerate}
              onReset={handleReset}
              isLoading={isCustomLoading}
              filtersChanged={filtersChanged}
              isCustom={isCustom}
            />
          </div>
        )}

        <section className={`sci-panel overflow-hidden ${clustersQuery.isLoading ? 'opacity-60' : ''}`}>
          <div className="sci-panel-header flex flex-col gap-3">
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
            <div>
              <h3 className="font-editorial text-lg font-bold text-foreground">Mapa de hábitos observados</h3>
              <p className="text-xs font-instrument text-muted-foreground mt-1">
                {isCustom
                  ? 'Resultado generado con pesos personalizados. Cada punto conserva su observación original.'
                  : 'Proyección PCA del espacio conductual. Cada punto es una observación agregada.'}
              </p>
              {customError && (
                <p className="text-[10px] font-instrument mt-1 text-destructive flex items-center gap-1" role="alert">
                  <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                  {customError}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                <Button
                  variant={viewMode === '2d' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setViewMode('2d')}
                  className="h-8 text-xs gap-1.5"
                >
                  <Grid3X3 className="w-3.5 h-3.5" />
                  PCA 2D
                </Button>
                <Button
                  variant={viewMode === 'raw' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setViewMode('raw')}
                  className="h-8 text-xs gap-1.5"
                >
                  <Table className="w-3.5 h-3.5" />
                  Observaciones
                </Button>
                {isCustom && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleReset}
                    className="h-8 text-xs gap-1.5 text-muted-foreground"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Restaurar
                  </Button>
                )}
            </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground mr-1">Color del mapa:</span>
                {(['cluster', 'fumando', 'actividad', 'hora', 'pm10'] as ColorBy[]).map(opt => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setColorBy(opt)}
                    aria-pressed={colorBy === opt}
                    aria-label={`Colorear mapa ${colorLabels[opt].toLowerCase()}`}
                    className={`px-2.5 py-1 text-[11px] rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      colorBy === opt
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-border text-muted-foreground hover:border-foreground hover:text-foreground'
                    }`}
                  >
                    {colorLabels[opt]}
                  </button>
                ))}
            </div>
          </div>

          <div className="p-0">
            {(clustersQuery.isError && !isCustom) && (
              <EmptyState
                icon={AlertTriangle}
                title="No se pudieron cargar los hábitos"
                description="No hubo respuesta con resultados para el filtro activo. Reintenta o solicita una actualización del análisis."
                className="py-16"
              />
            )}

            {/* Loading real durante carga custom */}
            {isCustomLoading && (
              <div className="h-[460px] lg:h-[560px] w-full flex items-center justify-center border-t border-border">
                <div className="flex flex-col items-center gap-3 text-muted-foreground">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <p className="text-xs">Calculando componentes principales y agrupamientos con pesos personalizados...</p>
                </div>
              </div>
            )}

            {/* Skeleton durante carga inicial */}
            {!isCustomLoading && clustersQuery.isLoading && !isCustom && (
              <div className="h-[460px] lg:h-[560px] w-full px-2 flex flex-col items-center justify-center gap-4 border-t border-border">
                <div className="w-full max-w-md space-y-3">
                  <div className="h-[280px] rounded-lg bg-secondary/30 animate-pulse flex items-center justify-center">
                    <div className="text-center space-y-2">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground mx-auto" />
                      <p className="text-xs text-muted-foreground animate-pulse">Cargando observaciones compatibles con el filtro activo...</p>
                    </div>
                  </div>
                  <div className="flex gap-2 justify-center">
                    {[1,2,3,4].map(i => (
                      <div key={i} className="h-6 w-20 rounded-md bg-secondary/30 animate-pulse" />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Contenido normal cuando no hay carga */}
            {!isCustomLoading && !clustersQuery.isError && !(clustersQuery.isLoading && !isCustom) && (
              <>
                {viewMode === 'raw' ? (
                  <div className="p-4 flex flex-col h-[460px] lg:h-[560px]">
                    {eventsLoading && !eventsData ? (
                      <div className="flex-1 flex items-center justify-center">
                        <Loader2 className="w-7 h-7 animate-spin text-muted-foreground" />
                      </div>
                    ) : eventsData ? (
                      <div className="flex-1 flex flex-col min-h-0">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-3">
                          <div className="flex flex-col">
                            <h3 className="text-sm font-medium">{eventsData.total_events.toLocaleString()} observaciones encontradas</h3>
                            {eventsData.metadata.smoking_events > 0 && (
                              <span className="text-[10px] text-destructive bg-destructive/10 px-1.5 py-0.5 rounded w-fit mt-1">
                                {eventsData.metadata.smoking_events.toLocaleString()} observaciones con fumado
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" className="h-7 text-xs" disabled={eventsPage <= 1 || eventsLoading} onClick={() => loadEventsData(eventsPage - 1)}>Anterior</Button>
                            <span className="text-xs font-mono text-muted-foreground">Página {eventsPage} de {eventsData.metadata.total_pages}</span>
                            <Button variant="outline" size="sm" className="h-7 text-xs" disabled={eventsPage >= eventsData.metadata.total_pages || eventsLoading} onClick={() => loadEventsData(eventsPage + 1)}>Siguiente</Button>
                          </div>
                        </div>
                        <div className="flex-1 overflow-auto rounded-lg border border-border relative custom-scrollbar">
                          {eventsLoading && (
                            <div className="absolute inset-0 bg-background/50 flex items-center justify-center z-10">
                              <Loader2 className="w-6 h-6 animate-spin text-primary" />
                            </div>
                          )}
                          <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-secondary/90 backdrop-blur z-10">
                              <tr>
                                <th className="text-left p-2.5 font-medium border-b border-border">Fecha y hora</th>
                                <th className="text-left p-2.5 font-medium border-b border-border">Actividad</th>
                                <th className="text-left p-2.5 font-medium border-b border-border">Fumando</th>
                                <th className="text-right p-2.5 font-medium border-b border-border">Personas</th>
                                <th className="text-center p-2.5 font-medium border-b border-border">Riesgo</th>
                                <th className="text-right p-2.5 font-medium border-b border-border">PM10</th>
                                <th className="text-left p-2.5 font-medium border-b border-border hidden sm:table-cell">Ubicación</th>
                              </tr>
                            </thead>
                            <tbody>
                              {eventsData.data.map((r) => (
                                <tr key={r.id} className="border-b border-border/50 hover:bg-secondary/30 last:border-0 transition-colors">
                                  <td className="p-2.5 font-mono whitespace-nowrap text-muted-foreground">{r.timestamp}</td>
                                  <td className="p-2.5 font-medium truncate max-w-[150px]">{r.actividad}</td>
                                  <td className="p-2.5">
                                    {r.fumando ? (
                                      <span className="inline-block px-1.5 py-0.5 rounded bg-destructive/10 text-destructive font-mono text-[10px]">Sí</span>
                                    ) : (
                                      <span className="inline-block px-1.5 py-0.5 rounded bg-secondary text-muted-foreground font-mono text-[10px]">No</span>
                                    )}
                                  </td>
                                  <td className="p-2.5 text-right font-mono">{r.conteo_personas}</td>
                                  <td className="p-2.5 text-center">
                                    {r.riesgo === 'alto' ? (
                                      <span className="inline-block px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-mono text-[10px] uppercase">Alto</span>
                                    ) : (
                                      <span className="text-muted-foreground font-mono text-[10px] capitalize">{r.riesgo}</span>
                                    )}
                                  </td>
                                  <td className="p-2.5 text-right font-mono">{r.pm10}</td>
                                  <td className="p-2.5 text-muted-foreground truncate max-w-[150px] hidden sm:table-cell">
                                    {r.zona} <span className="opacity-50">· {r.camara}</span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <div className="flex-1 flex items-center justify-center text-muted-foreground">
                        <EmptyState
                          icon={Database}
                          title="Sin observaciones para este filtro"
                          description="Amplía el rango temporal o reduce restricciones de ubicación/horario para inspeccionar observaciones individuales."
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="px-4 pb-3 flex flex-wrap items-center gap-2">
                      <Button variant={selectedCluster === null ? 'default' : 'outline'} size="sm" onClick={() => setSelectedCluster(null)} className="h-8 text-xs">
                        <Filter className="w-3 h-3 mr-1" />
                        Ver todos
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {selectedCluster ? `Mostrando: ${selectedCluster}` : `${points.length.toLocaleString('es-MX')} observaciones en el mapa`}
                      </span>
                    </div>

                    {points.length === 0 ? (
                      <div className="h-[460px] lg:h-[560px] flex items-center justify-center border-t border-border">
                        <EmptyState
                          title="Sin observaciones suficientes para graficar"
                          description="Amplía el rango temporal o reduce filtros. El laboratorio solo interpreta patrones cuando hay puntos compatibles con los filtros actuales."
                        />
                      </div>
                    ) : (
                      <div className="h-[430px] sm:h-[500px] lg:h-[620px] w-full px-2 relative">
                        <VectorScatterCanvas points={filteredPoints} colorMap={colorMap} colorBy={colorBy} />
                      </div>
                    )}

                    <div className="px-4 py-3 border-t border-border bg-secondary/30">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="flex flex-wrap gap-3">
                          {colorBy === 'cluster' && clusterSummaries.map((c) => (
                            <div key={c.etiqueta} className="flex items-center gap-1.5 text-xs">
                              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                              <span className="text-muted-foreground max-w-[220px] truncate" title={c.etiqueta}>{c.etiqueta}</span>
                            </div>
                          ))}
                          {colorBy === 'fumando' && (
                            <>
                              <div className="flex items-center gap-1.5 text-xs">
                                <div className="w-2.5 h-2.5 rounded-full bg-destructive" />
                                <span className="text-muted-foreground">Fumando</span>
                              </div>
                              <div className="flex items-center gap-1.5 text-xs">
                                <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                                <span className="text-muted-foreground">No fumando</span>
                              </div>
                            </>
                          )}
                          {colorBy === 'hora' && (
                            <span className="text-xs text-muted-foreground">Color continuo por hora local de observación.</span>
                          )}
                          {colorBy === 'pm10' && (
                            <span className="text-xs text-muted-foreground">Verde = bajo (&lt;54) · Ámbar = moderado · Rojo = alto (&gt;154)</span>
                          )}
                          {colorBy === 'actividad' && (
                            <span className="text-xs text-muted-foreground">Color único por tipo de actividad detectada</span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">
                          {smokingEvents > 0 && (
                            <div className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 ${smokingRiskStyle}`}>
                              {smokingRiskLevel === 'Alto' ? <AlertTriangle className="w-3.5 h-3.5" /> : <Info className="w-3.5 h-3.5" />}
                              <span className="font-semibold">Riesgo {smokingRiskLevel}</span>
                              <span className="text-muted-foreground">
                                {smokingEvents.toLocaleString('es-MX')} obs. con fumado ({smokingRiskPercentage.toFixed(1)}%)
                              </span>
                            </div>
                          )}
                          <div className="inline-flex items-center gap-1.5">
                            <Info className="w-3.5 h-3.5" />
                            <span>
                              {selectedSummary
                                ? `${selectedSummary.percentage}% del conjunto seleccionado`
                                : `${filteredPoints.length.toLocaleString('es-MX')} observaciones en lectura`}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </section>
        </div>

        <aside className="sci-panel 2xl:sticky 2xl:top-36 overflow-hidden">
          <div className="sci-panel-header flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-editorial text-base font-bold text-foreground">Hábitos detectados</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Selecciona un hábito para filtrar el mapa.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedCluster(null)}
                disabled={selectedCluster === null}
                className="h-8 text-xs"
              >
                Ver todos
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={showDescriptions ? 'default' : 'outline'}
                size="sm"
                onClick={() => setShowDescriptions((v) => !v)}
                className="h-8 text-xs gap-1.5"
                aria-pressed={showDescriptions}
              >
                {showDescriptions ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                {showDescriptions ? 'Ocultar descripciones' : 'Mostrar descripciones'}
              </Button>
              <Button
                variant={showSemanticFamilies ? 'default' : 'outline'}
                size="sm"
                onClick={() => setShowSemanticFamilies((v) => !v)}
                className="h-8 text-xs gap-1.5"
                aria-pressed={showSemanticFamilies}
              >
                <Network className="w-3.5 h-3.5" />
                {showSemanticFamilies ? 'Ocultar categorías de hábitos' : 'Mostrar categorías de hábitos'}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Categorías de hábitos muestra el grupo semántico amplio al que pertenece cada hábito detectado.
            </p>
          </div>

          <div className="max-h-none 2xl:max-h-[calc(100vh-15rem)] overflow-y-auto custom-scrollbar p-3 space-y-2">
            {semanticSummaries.length === 0 ? (
              <EmptyState
                title="Sin hábitos para mostrar"
                description="Cuando haya observaciones suficientes, aparecerán aquí los agrupamientos detectados."
                className="py-10"
              />
            ) : (
              semanticSummaries.map((item) => (
                <button
                  key={item.name}
                  type="button"
                  onClick={() => setSelectedCluster(selectedCluster === item.name ? null : item.name)}
                  aria-pressed={selectedCluster === item.name}
                  className={`w-full text-left rounded border p-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    selectedCluster === item.name
                      ? 'border-primary bg-primary/10'
                      : 'border-border bg-background/60 hover:border-primary/40 hover:bg-secondary/30'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-1 h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xl font-semibold text-foreground leading-none">{item.percentage}%</span>
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap">N = {item.count.toLocaleString('es-MX')}</span>
                      </div>
                      <p className="mt-2 text-sm font-semibold text-foreground leading-snug" title={item.name}>
                        {item.name}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="gov-badge border-border bg-secondary text-muted-foreground normal-case tracking-normal">{item.activity}</span>
                        {item.smokingRate > 0 && (
                          <span className="gov-badge gov-badge-warn normal-case tracking-normal">{item.smokingRate}% fumado</span>
                        )}
                      </div>
                      {showSemanticFamilies && item.family && (
                        <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
                          Categoría de hábito: {item.family}
                        </p>
                      )}
                      {showDescriptions && (
                        <div className="mt-2 space-y-1 border-t border-border/70 pt-2 text-[11px] text-muted-foreground leading-relaxed">
                          <p>Este agrupamiento reúne observaciones con actividad dominante “{item.activity}”.</p>
                          <p>Agrupamiento: {item.technical}.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>
      </div>

      <section className="sci-panel">
        <button
          type="button"
          onClick={() => setShowPanel((v) => v)}
          className="sr-only"
          aria-controls="habit-variables-panel"
        >
          Abrir variables
        </button>
        <details className="group">
          <summary className="sci-panel-header cursor-pointer list-none flex items-center justify-between hover:bg-secondary/30 transition-colors">
            <div className="flex items-start gap-3">
              <Info className="w-4 h-4 text-muted-foreground mt-0.5" />
              <div>
                <h3 className="font-editorial text-base font-bold text-foreground">Detalles técnicos</h3>
                <p className="text-xs text-muted-foreground">Método, etapa y momento de actualización. Cerrado por defecto.</p>
              </div>
            </div>
            <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-border p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-xs">
            <div className="rounded border border-border bg-background/60 p-3">
              <span className="block text-muted-foreground">Método</span>
              <span className="font-semibold text-foreground">PCA 2D + K-Means</span>
            </div>
            <div className="rounded border border-border bg-background/60 p-3">
              <span className="block text-muted-foreground">Estado</span>
              <span className="font-semibold text-foreground">{stageLabel[stage] ?? 'Análisis'}</span>
            </div>
            <div className="rounded border border-border bg-background/60 p-3">
              <span className="block text-muted-foreground">Actualizado</span>
              <span className="font-semibold text-foreground">{updated}</span>
            </div>
            <div className="rounded border border-border bg-background/60 p-3">
              <span className="block text-muted-foreground">Observaciones en mapa</span>
              <span className="font-semibold text-foreground">{filteredPoints.length.toLocaleString('es-MX')}</span>
            </div>
          </div>
        </details>
      </section>
    </div>
  )
}
