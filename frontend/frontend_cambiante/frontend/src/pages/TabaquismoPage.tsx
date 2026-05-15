import { useMemo } from 'react'
import {
  XAxis, YAxis, ResponsiveContainer, LabelList,
  AreaChart, Area, LineChart, Line,
  BarChart, Bar, Cell,
} from 'recharts'
import { Cigarette, AlertTriangle, Loader2, Info, Wind, Clock } from 'lucide-react'
import { useTendencias, useTopActividades, useFirmaTemporal, useKpis, useClusters, useCalidadAire } from '@/hooks/queries'
import { QueryError } from '@/components/ui/query-error'
import { EmptyState } from '@/components/ui/empty-state'
import { TurnoBands } from '@/components/analytics/TurnoBands'
import { ClusterIntelligencePanel } from '@/components/analytics/ClusterIntelligencePanel'
import { DataWarningToast } from '@/components/ui/data-warning-toast'
import type { IntervaloValue, GlobalFilters } from '@/types'

interface Props {
  intervalo: IntervaloValue
  filters?: GlobalFilters
}


export function TabaquismoPage({ intervalo, filters }: Props) {
  // Ensure we fetch only smoking events for this module
  const smokingFilters = {
    campus: filters?.campus ?? [],
    zonas: filters?.zonas ?? [],
    camaras: filters?.camaras ?? [],
    dias_semana: filters?.dias_semana ?? [],
    horas: filters?.horas ?? [],
    desde: filters?.desde,
    hasta: filters?.hasta,
    smokingMode: true as const,
  }

  const kpisQuery = useKpis(intervalo, smokingFilters)
  const topActQuery = useTopActividades(intervalo, smokingFilters)
  const firmaQuery = useFirmaTemporal(intervalo, smokingFilters)
  const tendenciasQuery = useTendencias(intervalo, smokingFilters, 'dia')
  const clustersQuery = useClusters(intervalo, smokingFilters)
  const calidadQuery = useCalidadAire(intervalo, smokingFilters)

  const kpis = kpisQuery.data
  const topAct = topActQuery.data ?? []
  const firma = firmaQuery.data ?? []
  const tendencias = tendenciasQuery.data?.tendencias ?? []
  const tasasFumado = clustersQuery.data?.tasas_fumado ?? []

  const impactoFumadoresData = useMemo(() => {
    const correlacion = calidadQuery.data?.correlacion ?? []
    if (!correlacion.length) return null
    let pm10Sin = 0; let countSin = 0
    let pm10Con = 0; let countCon = 0
    correlacion.forEach(d => {
      if (d.tasa_fumado <= 0) { pm10Sin += d.pm10; countSin++ }
      else { pm10Con += d.pm10; countCon++ }
    })
    const avgSin = countSin > 0 ? Math.round(pm10Sin / countSin) : 0
    const avgCon = countCon > 0 ? Math.round(pm10Con / countCon) : 0
    const aumentoPct = avgSin > 0 ? Math.round(((avgCon - avgSin) / avgSin) * 100) : 0
    return {
      chartData: [
        { escenario: 'Sin fumadores', pm10: avgSin, fill: 'hsl(var(--chart-2))', n: countSin },
        { escenario: 'Con fumadores', pm10: avgCon, fill: 'hsl(var(--chart-5))', n: countCon },
      ],
      aumentoPct, avgSin, avgCon, nSin: countSin, nCon: countCon,
    }
  }, [calidadQuery.data])

  const firmaPorHora = useMemo(() => {
    const hours: Record<number, number> = {}
    Array.from({ length: 24 }).forEach((_, i) => hours[i] = 0)
    firma.forEach(row => {
      hours[row.hora] += row.frecuencia
    })
    return Object.entries(hours).map(([h, val]) => ({
      hora: `${h.padStart(2, '0')}:00`,
      horaNum: parseInt(h),
      incidencias: val
    })).sort((a, b) => a.horaNum - b.horaNum)
  }, [firma])

  return (
    <div className="space-y-5 animate-fade-in pb-10">
      
      {/* HEADER PANELS */}
      <div className="sci-panel bg-secondary/20">
        <div className="p-5 flex items-start gap-4">
          <div className="w-12 h-12 rounded bg-tobacco/10 flex items-center justify-center shrink-0 border border-tobacco/20">
            <Cigarette className="w-6 h-6 text-tobacco" />
          </div>
          <div>
            <h2 className="text-sm font-editorial font-bold text-foreground">Observatorio de Tabaquismo Universitario</h2>
            <p className="text-xs font-instrument text-muted-foreground mt-1 mb-2 max-w-2xl">
              Análisis observacional de incidencias visuales de fumado en espacios del campus.
              El objetivo es describir patrones agregados por horario, actividad co-ocurrente y contexto ambiental.
            </p>
            <div className="flex flex-wrap gap-2">
              <span className="gov-badge gov-badge-warn">Observacional · no causal</span>
              <span className="gov-badge border-border bg-background">Filtro fumado aplicado</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Contextual toasts ─────────────────────────────────────── */}
      <DataWarningToast
        id="tabaquismo-methodology-v2"
        title="Aviso metodológico"
        body="Módulo observacional. La IA detecta fumado visible; no es diagnóstico de salud ni conteo de personas fumadoras únicas. Las dinámicas grupales son co-ocurrentes y descriptivas."
        variant="info"
      />

      <section className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-tobacco/10 text-sm font-bold text-tobacco">1</span>
          <div>
            <h2 className="font-editorial text-lg font-bold text-foreground">Resumen de tabaquismo observado</h2>
            <p className="text-sm text-muted-foreground">Señales visibles de fumado agregadas por periodo y filtros activos.</p>
          </div>
        </div>

      {/* ── KPI Cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="sci-panel p-4">
          <div className="flex items-center gap-2 mb-2">
            <Cigarette className="w-4 h-4 text-tobacco" />
            <span className="text-xs font-instrument text-muted-foreground uppercase tracking-wider">Tasa de Fumado</span>
          </div>
          {kpisQuery.isLoading ? <div className="h-8 bg-secondary/50 animate-pulse rounded" /> : (
            <>
              <p className="text-3xl font-bold text-tobacco">{kpis?.tasa_fumado != null ? `${kpis.tasa_fumado.toFixed(1)}%` : '—'}</p>
              <p className="text-xs font-instrument text-muted-foreground mt-1">N = {(kpis?.total_registros ?? 0).toLocaleString('es-MX')} observaciones</p>
            </>
          )}
        </div>
        <div className="sci-panel p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-instrument text-muted-foreground uppercase tracking-wider">Hora Pico</span>
          </div>
          {kpisQuery.isLoading ? <div className="h-8 bg-secondary/50 animate-pulse rounded" /> : (
            <p className="text-3xl font-bold">{kpis?.hora_pico ?? '—'}</p>
          )}
          {kpis?.hora_pico_n != null && (
            <p className="text-xs font-mono text-muted-foreground mt-1">N = {kpis.hora_pico_n.toLocaleString('es-MX')} observaciones en esa hora</p>
          )}
        </div>
        <div className="sci-panel p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-destructive" />
            <span className="text-xs font-instrument text-muted-foreground uppercase tracking-wider">Eventos de Riesgo</span>
          </div>
          {kpisQuery.isLoading ? <div className="h-8 bg-secondary/50 animate-pulse rounded" /> : (
            <p className={`text-3xl font-bold ${(kpis?.eventos_riesgo ?? 0) > 0 ? 'text-destructive' : ''}`}>{kpis?.eventos_riesgo?.toLocaleString('es-MX') ?? '—'}</p>
          )}
        </div>
        <div className="sci-panel p-4">
          <div className="flex items-center gap-2 mb-2">
            <Wind className="w-4 h-4 text-environment" />
            <span className="text-xs font-instrument text-muted-foreground uppercase tracking-wider">PM10 Promedio</span>
          </div>
          {kpisQuery.isLoading ? <div className="h-8 bg-secondary/50 animate-pulse rounded" /> : (
            <>
              <p className="text-3xl font-bold">{kpis?.pm10_promedio ?? '—'} <span className="text-sm font-normal text-muted-foreground">µg/m³</span></p>
            </>
          )}
        </div>
      </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-tobacco/10 text-sm font-bold text-tobacco">2</span>
          <div>
            <h2 className="font-editorial text-lg font-bold text-foreground">Distribución temporal</h2>
            <p className="text-sm text-muted-foreground">Cuándo aparecen con mayor frecuencia las señales visibles de fumado.</p>
          </div>
        </div>

      {/* TENDENCIAS LONGITUDINALES */}
      <div className="sci-panel">
        <div className="sci-panel-header flex-col items-start gap-1">
          <h3 className="font-editorial text-base font-bold text-foreground">
            Tendencia temporal de señales de fumado
          </h3>
          <p className="text-xs font-instrument text-muted-foreground">
            Evolución diaria de observaciones con indicios visibles de fumado.
            {tendencias.length > 0 && ` — N = ${tendencias.reduce((s, d) => s + d.total, 0).toLocaleString('es-MX')} observaciones`}
          </p>
        </div>
        <div className="p-4">
          {tendenciasQuery.isLoading ? (
            <div className="h-[300px] flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : tendencias.length === 0 ? (
            <div className="h-[300px] flex items-center justify-center border border-dashed border-border rounded-lg">
              <EmptyState
                title="Sin serie longitudinal de fumado"
                description="No hay suficientes observaciones con fumado para este rango. Amplía la ventana temporal o reduce filtros."
              />
            </div>
          ) : (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={tendencias} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <XAxis
                    dataKey="periodo"
                    tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={{ stroke: 'hsl(var(--border))' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={false} tickLine={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="fumado"
                    stroke="hsl(var(--chart-5))"
                    strokeWidth={2}
                    dot={{ r: 3, fill: "hsl(var(--background))", stroke: "hsl(var(--chart-5))", strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* TOP ACTIVIDADES ASOCIADAS */}
        <div className="sci-panel order-2">
          <div className="sci-panel-header flex-col items-start gap-1">
            <h3 className="font-editorial text-base font-bold flex items-center gap-2 text-foreground">
              <Info className="w-4 h-4 text-primary" />
              Actividades asociadas a fumado visible
            </h3>
            <p className="text-xs font-instrument text-muted-foreground">
              Actividades identificadas simultáneamente con señales visibles de fumado.
            </p>
          </div>
          <div className="p-4">
            {topActQuery.isError ? (
              <QueryError onRetry={() => topActQuery.refetch()} />
            ) : topActQuery.isLoading ? (
              <div className="py-8 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : topAct.length === 0 ? (
              <EmptyState
                title="Sin observaciones con fumado visible"
                description="El filtro activo no contiene señales visibles de fumado. Amplía el periodo o revisa filtros de zona y horario."
              />
            ) : (
              <div className="space-y-3">
                {topAct.slice(0, 7).map((item, index) => (
                  <div key={item.actividad} className="space-y-1.5">
                    <div className="flex items-start justify-between gap-2 text-sm">
                      <div className="flex items-start gap-2 min-w-0">
                        <span className="w-5 h-5 rounded-full bg-secondary flex items-center justify-center text-xs font-mono font-medium text-muted-foreground shrink-0 mt-0.5">
                          {index + 1}
                        </span>
                        <span className="font-medium text-xs leading-snug">{item.actividad}</span>
                      </div>
                      <span className="font-mono text-xs text-muted-foreground shrink-0">
                        {item.porcentaje.toFixed(1)}% · N = {item.conteo.toLocaleString('es-MX')} observaciones
                      </span>
                    </div>
                    <div className="h-1.5 bg-secondary/50 rounded overflow-hidden">
                      <div 
                        className="h-full rounded transition-all bg-chart-5/80"
                        style={{ width: `${item.porcentaje}%` }} 
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* DISTRIBUCIÓN HORARIA */}
        <div className="sci-panel flex flex-col order-1">
          <div className="sci-panel-header flex-col items-start gap-1">
            <h3 className="font-editorial text-base font-bold flex items-center gap-2 text-foreground">
              <Cigarette className="w-4 h-4 text-chart-5" />
              Distribución horaria de fumado visible
            </h3>
            <p className="text-xs font-instrument text-muted-foreground">
              Volumen de observaciones por hora del día. Zonas sombreadas indican turnos matutino y vespertino.
              {firmaPorHora.length > 0 && ` — N = ${firmaPorHora.reduce((s, h) => s + h.incidencias, 0).toLocaleString('es-MX')} observaciones`}
            </p>
          </div>
          <div className="p-4 flex-1">
            {firmaQuery.isLoading ? (
              <div className="h-[260px] flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : firmaPorHora.length === 0 ? (
              <div className="h-[260px] flex items-center justify-center">
                <EmptyState
                  title="Sin distribución horaria"
                  description="No hay observaciones con fumado visible suficientes para construir una firma por hora con el filtro activo."
                />
              </div>
            ) : (
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={firmaPorHora} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="smokeGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--chart-5))" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="hsl(var(--chart-5))" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <TurnoBands x1Matutino="07:00" x2Matutino="14:00" x1Vespertino="14:00" x2Vespertino="21:00" />
                    <XAxis
                      dataKey="hora"
                      tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }}
                      axisLine={{ stroke: 'hsl(var(--border))' }}
                      tickLine={false}
                      interval={3}
                    />
                    <YAxis tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                    <Area
                      type="monotone" dataKey="incidencias"
                      stroke="hsl(var(--chart-5))" strokeWidth={2}
                      fill="url(#smokeGrad)"
                      dot={{ fill: 'hsl(var(--chart-5))', strokeWidth: 0, r: 3 }}
                      activeDot={{ r: 5, stroke: 'hsl(var(--background))', strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

      </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-tobacco/10 text-sm font-bold text-tobacco">3</span>
          <div>
            <h2 className="font-editorial text-lg font-bold text-foreground">Relación tabaquismo ↔ ambiente</h2>
            <p className="text-sm text-muted-foreground">Comparación descriptiva con PM10, sin atribuir causalidad.</p>
          </div>
        </div>

      {/* ── Asociación observada entre fumado y PM10 ──────────────── */}
      <div className="sci-panel">
        <div className="sci-panel-header flex-col items-start gap-1">
          <h3 className="font-editorial text-base font-bold text-foreground">Asociación Observada entre Fumado y PM10</h3>
          <p className="text-xs font-instrument text-muted-foreground">
            Comparación descriptiva de concentración promedio de partículas con y sin fumado visible. No implica causalidad.
            {calidadQuery.data?.correlacion && ` — N = ${calidadQuery.data.correlacion.length} lecturas`}
          </p>
        </div>
        <div className="p-4">
          {impactoFumadoresData ? (
            <div className="flex flex-col md:flex-row gap-6 mt-4 items-center">
              <div className="flex-1 text-center md:text-left flex flex-col justify-center">
                <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2">Diferencia observada</p>
                <div className="flex items-baseline justify-center md:justify-start gap-2 mb-2">
                  <span className="text-5xl font-bold text-destructive">
                    +{impactoFumadoresData.aumentoPct}%
                  </span>
                </div>
                <p className="text-sm text-foreground/80 max-w-sm">
                  En observaciones con fumado visible, el PM10 promedio fue{' '}
                  <b className="text-destructive">{impactoFumadoresData.aumentoPct}%</b> mayor que en observaciones sin fumado visible.
                  Esta asociación descriptiva puede estar influida por clima, hora y afluencia.
                </p>
              </div>

              <div className="flex-1 h-[220px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={impactoFumadoresData.chartData} margin={{ top: 20, right: 30, left: -20, bottom: 0 }}>
                    <XAxis dataKey="escenario" tick={{ fontSize: 12, fontWeight: 500, fill: 'hsl(var(--foreground))' }} axisLine={{ stroke: 'hsl(var(--border))' }} tickLine={false} />
                    <YAxis tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                    <Bar dataKey="pm10" radius={[4, 4, 0, 0]}>
                      {impactoFumadoresData.chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                      <LabelList dataKey="pm10" position="top" fontSize={11} fontWeight={700} fill="hsl(var(--foreground))" formatter={(v: any) => `${v} µg/m³`} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <div className="h-32 flex items-center justify-center border border-dashed border-border rounded-lg mt-4">
              <EmptyState
                title="Sin datos suficientes para comparar PM10"
                description="Se requieren lecturas ambientales con y sin fumado visible dentro del filtro activo."
              />
            </div>
          )}
        </div>
      </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-tobacco/10 text-sm font-bold text-tobacco">4</span>
          <div>
            <h2 className="font-editorial text-lg font-bold text-foreground">Patrones observacionales</h2>
            <p className="text-sm text-muted-foreground">Categorías semánticas donde aparece fumado visible dentro del análisis agregado.</p>
          </div>
        </div>
        <ClusterIntelligencePanel tasasFumado={tasasFumado} isLoading={clustersQuery.isLoading} />
      </section>
      
    </div>
  )
}
