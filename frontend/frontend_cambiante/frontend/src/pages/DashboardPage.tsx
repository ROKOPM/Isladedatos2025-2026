import { useMemo, useState, useEffect } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, LabelList,
  PieChart, Pie,
} from 'recharts'
import {
  Cigarette, Clock, AlertTriangle, Wind, Brain,
  TrendingUp, TrendingDown, Minus, Users, Activity, Loader2, CalendarRange, Database,
} from 'lucide-react'
import { useKpis, useEventosHora, useHeatmap, useTopActividades } from '@/hooks/queries'
import { BoxplotTemporal } from '@/components/analytics/BoxplotTemporal'
import { DataWarningToast, ToastContainer } from '@/components/ui/data-warning-toast'
import { getHeatColor, SCI_COLORS } from '@/scientific/ScientificColorRegistry'
import { QueryError } from '@/components/ui/query-error'
import { EmptyState } from '@/components/ui/empty-state'
import type { IntervaloValue, TopActividad, GlobalFilters } from '@/types'

const COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
]

interface Props {
  intervalo: IntervaloValue
  filters?: GlobalFilters
}


function DeltaIcon({ delta }: { delta: number | null }) {
  if (delta == null) return <Minus className="w-3.5 h-3.5 text-muted-foreground" />
  if (delta > 0) return <TrendingUp className="w-3.5 h-3.5 text-destructive" />
  if (delta < 0) return <TrendingDown className="w-3.5 h-3.5 text-accent" />
  return <Minus className="w-3.5 h-3.5 text-muted-foreground" />
}


function formatHoraCDMX(horaStr: string | null): string {
  if (!horaStr) return '—'
  const h = parseInt(horaStr)
  if (isNaN(h)) return horaStr
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12} ${period}`
}

export function DashboardPage({ intervalo, filters }: Props) {
  const kpisQuery = useKpis(intervalo, filters)
  const eventosQuery = useEventosHora(intervalo, filters)
  const heatmapQuery = useHeatmap(intervalo, filters)
  const topActQuery = useTopActividades(intervalo, filters)

  const kpis = kpisQuery.data
  const eventosHora = eventosQuery.data ?? []
  const heatmap = heatmapQuery.data ?? []
  const topAct = topActQuery.data ?? []

  const [cdmxTime, setCdmxTime] = useState('')
  useEffect(() => {
    const update = () => {
      const now = new Date()
      const fmt = new Intl.DateTimeFormat('es-MX', {
        timeZone: 'America/Mexico_City',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
      setCdmxTime(fmt.format(now))
    }
    update()
    const id = setInterval(update, 60000)
    return () => clearInterval(id)
  }, [])

  const eventosHoraFiltrado = useMemo(() => {
    return eventosHora.filter(e => e.total > 0)
  }, [eventosHora])

  const eventosHoraPromedio = useMemo(() => {
    const map = new Map<string, { total: number; fumadores: number; count: number }>()
    eventosHora.forEach(e => {
      if (e.total <= 0) return
      const prev = map.get(e.hora) ?? { total: 0, fumadores: 0, count: 0 }
      map.set(e.hora, {
        total: prev.total + Number(e.total),
        fumadores: prev.fumadores + Number(e.fumadores),
        count: prev.count + 1,
      })
    })
    return Array.from(map.entries())
      .map(([hora, v]) => ({ hora, total: Math.round(v.total / v.count), fumadores: Math.round(v.fumadores / v.count) }))
      .sort((a, b) => a.hora.localeCompare(b.hora))
  }, [eventosHora])

  const numDias = useMemo(() => {
    const fechas = new Set<string>()
    eventosHora.forEach(e => { const f = (e as any).fecha; if (f) fechas.add(f) })
    return fechas.size
  }, [eventosHora])

  const activeHeatmapHours = useMemo(() => {
    const hasData = new Set<number>()
    heatmap.forEach((r) => r.horas.forEach((c) => { if (c.valor > 0) hasData.add(c.hora) }))
    const sorted = Array.from(hasData).sort((a, b) => a - b)
    return sorted.length > 0 ? sorted : Array.from({ length: 24 }, (_, i) => i)
  }, [heatmap])

  const heatmapMax = useMemo(() => {
    let max = 0
    heatmap.forEach((r) => r.horas.forEach((c) => { if (c.valor > max) max = c.valor }))
    return max
  }, [heatmap])

  const peakHour = useMemo(() => {
    if (!eventosHoraPromedio.length) return null
    return eventosHoraPromedio.reduce((a, b) => (b.total > a.total ? b : a))
  }, [eventosHoraPromedio])

  const insight = useMemo(() => {
    if (!kpis) return null
    const parts: string[] = []
    if (kpis.tasa_fumado_delta != null && Math.abs(kpis.tasa_fumado_delta) > 0.3) {
      const dir = kpis.tasa_fumado_delta > 0 ? 'aumentó' : 'disminuyó'
      parts.push(`Las señales visibles de fumado ${dir} ${Math.abs(kpis.tasa_fumado_delta).toFixed(1)} pp frente al período anterior`)
    }
    if (peakHour) parts.push(`pico de actividad a las ${peakHour.hora}:00h`)
    if (kpis.pm10_promedio != null && kpis.pm10_promedio > 75)
      parts.push(`PM10 sobre límite NOM-025 (${kpis.pm10_promedio.toFixed(0)} µg/m³)`)
    if (kpis.eventos_riesgo != null && kpis.eventos_riesgo > 0)
      parts.push(`${kpis.eventos_riesgo} evento${kpis.eventos_riesgo !== 1 ? 's' : ''} de riesgo crítico detectados`)
    return parts.length ? parts.join(' · ') : null
  }, [kpis, peakHour])

  const kpiCards = useMemo(() => [
    {
      title: 'Incidencia de Tabaquismo',
      value: kpis?.tasa_fumado != null ? `${kpis.tasa_fumado.toFixed(1)}%` : '—',
      delta: kpis?.tasa_fumado_delta ?? null,
      icon: Cigarette,
      accent: true,
      extra: `N = ${kpis?.total_registros?.toLocaleString('es-MX') ?? 0} observaciones`,
    },
    {
      title: 'Hora Pico Promedio',
      value: formatHoraCDMX(kpis?.hora_pico ?? null),
      delta: null,
      icon: Clock,
      extra: kpis?.hora_pico_n != null
        ? `N = ${kpis?.total_registros?.toLocaleString('es-MX') ?? 0} observaciones · ~${kpis.hora_pico_n.toLocaleString('es-MX')} observaciones/día`
        : `N = ${kpis?.total_registros?.toLocaleString('es-MX') ?? 0} observaciones`,
    },
    {
      title: 'Eventos de Alto Riesgo',
      value: kpis?.eventos_riesgo?.toLocaleString('es-MX') ?? '—',
      delta: null,
      icon: AlertTriangle,
      extra: `N = ${kpis?.total_registros?.toLocaleString('es-MX') ?? 0} observaciones`,
    },
    {
      title: 'PM10 Promedio',
      value: kpis?.pm10_promedio != null ? `${kpis.pm10_promedio} µg/m³` : '—',
      delta: null,
      icon: Wind,
    },
    {
      title: 'Patrones Conductuales',
      value: kpis?.patrones_activos?.toLocaleString('es-MX') ?? '—',
      delta: null,
      icon: Brain,
      extra: `N = ${kpis?.total_registros?.toLocaleString('es-MX') ?? 0} observaciones`,
    },
  ], [kpis])

  const fmtFecha = (f: string | null | undefined) => {
    if (!f) return null
    const [y, m, d] = f.split('-')
    return `${d}/${m}/${y}`
  }

  return (
    <div className="space-y-5">
      {/* ── Contexto del período ───────────────────────────────────── */}
      {kpis && (
        <div className="sci-panel">
          <div className="flex flex-wrap items-center gap-3 text-xs font-instrument text-muted-foreground px-3 py-2">
            <span className="flex items-center gap-1.5">
              <CalendarRange className="w-3.5 h-3.5 shrink-0" />
              {kpis.fecha_desde && kpis.fecha_hasta
                ? kpis.fecha_desde === kpis.fecha_hasta
                  ? fmtFecha(kpis.fecha_desde)
                  : `${fmtFecha(kpis.fecha_desde)} — ${fmtFecha(kpis.fecha_hasta)}`
                : 'Sin datos'}
            </span>
            {kpis.total_registros != null && kpis.total_registros > 0 && (
              <>
                <span className="opacity-30">│</span>
                <span className="flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 shrink-0" />
                  N = {kpis.total_registros.toLocaleString('es-MX')} observaciones
                </span>
                <span className="opacity-30">│</span>
                <span>Agregación: Periodo Completo</span>
                <span className="opacity-30">│</span>
                <span className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  CDMX: {cdmxTime}
                </span>
                {filters?.smokingMode && (
                  <>
                    <span className="opacity-30">│</span>
                    <span className="text-tobacco font-bold">MODO TABAQUISMO ACTIVO</span>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Contextual toasts (top-right, non-invasive) ──────────────── */}
      <ToastContainer>
        {kpis && (kpis.total_registros ?? 0) > 0 && (kpis.total_registros ?? 0) < 100 && (
          <DataWarningToast
            id="dash-sample-small-v2"
            title="Muestra reducida"
            body={`N = ${kpis.total_registros} observaciones: las métricas pueden no ser representativas del comportamiento real. Amplía el período de análisis.`}
            variant="warning"
            autoHideMs={false}
            allowPermanentDismiss={false}
          />
        )}
        {filters?.smokingMode && (
          <DataWarningToast
            id="dash-smoking-mode-v2"
            title="Modo tabaquismo activo"
            body="Todos los datos están filtrados exclusivamente a eventos con fumado detectado. Los indicadores generales no son comparables con modo normal."
            variant="warning"
            autoHideMs={12000}
            allowPermanentDismiss={false}
          />
        )}
        {insight && !kpisQuery.isLoading && (
          <DataWarningToast
            id="dash-insight"
            title="Lectura observacional"
            body={insight}
            variant="insight"
            autoHideMs={15000}
            allowPermanentDismiss={false}
          />
        )}
      </ToastContainer>

      <section className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">1</span>
          <div>
            <h2 className="font-editorial text-lg font-bold text-foreground">Resumen general</h2>
            <p className="text-sm text-muted-foreground">Vista ejecutiva del periodo activo y de las observaciones agregadas.</p>
          </div>
        </div>

      {/* ── KPI Cards ──────────────────────────────────────────────── */}
      {kpisQuery.isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="sci-panel p-4 space-y-3 animate-enter" style={{ animationDelay: `${i * 0.05}s` }}>
              <div className="flex items-center justify-between">
                <div className="skeleton w-5 h-5 rounded-md" />
                <div className="skeleton w-12 h-4 rounded-full" />
              </div>
              <div className="skeleton w-20 h-7 rounded" />
              <div className="skeleton w-full h-2.5 rounded" />
            </div>
          ))}
        </div>
      ) : (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {kpiCards.map((kpi, i) => (
          <div key={kpi.title} className="group relative animate-enter" style={{ animationDelay: `${i * 0.05}s` }}>
            <div
              className={`relative overflow-hidden transition-all duration-200 h-full cursor-default border rounded-[var(--radius)] ${
                kpi.accent
                  ? 'text-primary-foreground border-primary shadow-md'
                  : 'sci-panel hover:border-primary/20 hover:shadow-sm'
              }`}
              style={{
                animationDelay: `${i * 80}ms`,
                ...(kpi.accent ? { backgroundColor: 'hsl(var(--primary))' } : {}),
              }}
            >
              {kpi.accent && (
                <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
              )}
              <div className="p-4 flex flex-col h-full justify-between gap-2">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <kpi.icon className={`w-4 h-4 ${kpi.accent ? 'opacity-80' : 'text-muted-foreground'}`} />
                    {kpi.delta != null && (
                      <div className="flex items-center gap-1 bg-background/5 px-1.5 py-0.5 rounded-full">
                        <DeltaIcon delta={kpi.delta} />
                        <span className={`text-xs font-mono font-bold ${kpi.delta < 0 ? 'text-accent' : 'text-destructive'}`}>
                          {Math.abs(kpi.delta).toFixed(1)}pp
                        </span>
                      </div>
                    )}
                  </div>
                  <p className="text-3xl font-bold tracking-tight">{kpi.value}</p>
                  {(kpi as any).extra && (
                    <p className={`text-xs font-mono mt-1 ${kpi.accent ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{(kpi as any).extra}</p>
                  )}
                </div>
                <div className="space-y-1">
                  <p className={`text-xs font-mono ${kpi.accent ? 'opacity-80' : 'text-muted-foreground'} uppercase tracking-wider leading-snug`}>
                    {kpi.title}
                  </p>
                  {(kpi as any).inlineNote && (
                    <p className={`text-[10px] leading-tight ${kpi.accent ? 'opacity-60' : 'text-muted-foreground/70'}`}>
                      {(kpi as any).inlineNote}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      )}
      </section>

      <section className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">2</span>
          <div>
            <h2 className="font-editorial text-lg font-bold text-foreground">Actividad global</h2>
            <p className="text-sm text-muted-foreground">Distribución general de presencia y actividad por hora y día.</p>
          </div>
        </div>

      {/* ── Distribución horaria ────────────────────────────────────── */}
      <div className="sci-panel animate-enter stagger-2">
        <div className="sci-panel-header flex-col items-start gap-1">
          <h3 className="font-editorial text-base font-bold flex items-center gap-2 text-foreground">
            <Users className="w-4 h-4 text-primary" />
            Actividad global por hora
          </h3>
          <p className="text-xs font-instrument text-muted-foreground">
            Observaciones agregadas por hora
            {numDias > 0 && ` — Promedio/día · ${numDias} días`}
            {peakHour && ` — Pico: ${peakHour.hora} (~${peakHour.total} observaciones/día)`}
          </p>
        </div>
        <div className="p-4">
          {eventosQuery.isError ? (
            <QueryError onRetry={() => eventosQuery.refetch()} />
          ) : eventosQuery.isLoading ? (
            <div className="h-[220px] p-2">
              <div className="skeleton w-full h-full" />
            </div>
          ) : (
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={eventosHoraPromedio} margin={{ top: 20, right: 10, left: 0, bottom: 0 }}>
                  <XAxis
                    dataKey="hora"
                    tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={{ stroke: 'hsl(var(--border))' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Bar dataKey="total" radius={[3, 3, 0, 0]}>
                    {eventosHoraPromedio.map((entry, idx) => (
                      <Cell
                        key={idx}
                        fill={
                          peakHour && entry.hora === peakHour.hora
                            ? 'hsl(var(--chart-2))'
                            : 'hsl(var(--primary))'
                        }
                        fillOpacity={peakHour && entry.hora === peakHour.hora ? 1 : 0.6}
                      />
                    ))}
                    <LabelList
                      dataKey="total"
                      position="top"
                      content={({ x, y, width, value, index }) => {
                        const entry = eventosHoraPromedio[index!]
                        const isPeak = peakHour && entry.hora === peakHour.hora
                        const cx = Number(x) + Number(width) / 2
                        const cy = Number(y)
                        return (
                          <g>
                            <text x={cx} y={cy} textAnchor="middle" fontSize={10} fontWeight={600} fill="hsl(var(--muted-foreground))">
                              {value}
                            </text>
                            {isPeak && (
                              <text x={cx} y={cy - 10} textAnchor="middle" fontSize={9} fontWeight={800} fill="hsl(var(--chart-2))">
                                PICO
                              </text>
                            )}
                          </g>
                        )
                      }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* ── Mapa Térmico (ancho completo) ──────────────────────────── */}
      <div className="sci-panel animate-enter stagger-3">
        <div className="sci-panel-header flex-col items-start gap-1">
          <h3 className="font-editorial text-base font-bold text-foreground">
            Mapa de intensidad por día y hora
          </h3>
          <p className="text-xs font-instrument text-muted-foreground">
            Intensidad observacional agregada por franja temporal.
          </p>
        </div>
        <div className="p-4">
          {heatmapQuery.isError ? (
            <QueryError onRetry={() => heatmapQuery.refetch()} />
          ) : heatmapQuery.isLoading ? (
            <div className="p-2 space-y-1.5 h-[200px]">
              {[...Array(7)].map((_, i) => (
                <div key={i} className="skeleton h-6 w-full" style={{ opacity: 1 - i * 0.08 }} />
              ))}
            </div>
          ) : (
            <>
              <div className="w-full">
                <div className="flex w-full mb-2">
                  <div className="w-12 shrink-0" />
                  <div className="flex-1 flex">
                    {activeHeatmapHours.map((h) => (
                      <div key={h} className="flex-1 text-center text-xs font-mono text-muted-foreground">
                        {h.toString().padStart(2, '0')}h
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-1">
                  {heatmap.map((row) => (
                    <div key={row.dia} className="flex w-full items-center">
                      <div className="w-12 shrink-0 text-xs font-medium text-muted-foreground text-right pr-2">
                        {row.dia}
                      </div>
                      <div className="flex-1 flex gap-0.5">
                        {row.horas.filter(c => activeHeatmapHours.includes(c.hora)).map((cell) => (
                          <div
                            key={cell.hora}
                            className="flex-1 h-9 rounded-[3px] transition-all duration-200 hover:brightness-110 cursor-pointer"
                            style={{ backgroundColor: getHeatColor(cell.valor, heatmapMax) }}
                            title={`${row.dia} ${cell.hora}:00 — ${cell.valor} personas`}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/50">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-instrument text-muted-foreground">Baja</span>
                  {[SCI_COLORS.heatmap.none, SCI_COLORS.heatmap.low, SCI_COLORS.heatmap.medium, SCI_COLORS.heatmap.peak, SCI_COLORS.heatmap.max].map(
                    (c, i) => <div key={i} className="w-6 h-3.5 rounded-[3px]" style={{ backgroundColor: c }} />,
                  )}
                  <span className="text-xs font-instrument text-muted-foreground">Alta</span>
                </div>
                <div className="text-xs font-editorial italic text-muted-foreground">
                  Cada celda representa N total de observaciones en esa franja
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      </section>

      {/* ── Alertas activas ───────────────────────────────────────── */}
      {kpis && (() => {
        const alertas: { msg: string }[] = []
        if ((kpis.tasa_fumado ?? 0) >= 20)
          alertas.push({ msg: `Señales visibles de fumado: tasa de ${kpis.tasa_fumado?.toFixed(1)}% supera umbral de 20%` })
        if ((kpis.pm10_promedio ?? 0) >= 75)
          alertas.push({ msg: `PM10: ${kpis.pm10_promedio} µg/m³ supera umbral NOM-025 de 75 µg/m³` })
        return alertas.length > 0 ? (
          <div className="space-y-2">
            {alertas.map((a, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/30">
                <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
                  <span className="text-sm text-foreground"><b>Condición relevante</b> · {a.msg}</span>
                </div>
            ))}
          </div>
        ) : null
      })()}

      <section className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">3</span>
          <div>
            <h2 className="font-editorial text-lg font-bold text-foreground">Comportamientos principales</h2>
            <p className="text-sm text-muted-foreground">Actividades dominantes y variabilidad observada en el periodo.</p>
          </div>
        </div>

      {/* ── Distribución de Actividades + Fumadores por Hora ─────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-enter stagger-4">
        <div className="sci-panel">
          <div className="sci-panel-header flex-col items-start gap-1">
            <h3 className="font-editorial text-base font-bold flex items-center gap-2 text-foreground">
              <Activity className="w-4 h-4 text-primary" />
              Distribución de patrones conductuales
            </h3>
            <p className="text-xs font-instrument text-muted-foreground">
              Proporción relativa del total de la muestra. N = {(kpis?.total_registros ?? 0).toLocaleString('es-MX')} observaciones.
            </p>
          </div>
          <div className="p-4">
            {topActQuery.isError ? (
              <QueryError onRetry={() => topActQuery.refetch()} />
            ) : topActQuery.isLoading ? (
              <div className="p-4 space-y-3 h-[280px]">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="space-y-1.5">
                    <div className="skeleton h-3 rounded" style={{ width: `${80 - i * 10}%` }} />
                    <div className="skeleton h-1.5 rounded-full w-full" />
                  </div>
                ))}
              </div>
            ) : (
              <>
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={topAct}
                        dataKey="conteo"
                        nameKey="actividad"
                        cx="50%" cy="50%"
                        innerRadius={52} outerRadius={82}
                        strokeWidth={2}
                        stroke="hsl(var(--card))"
                        label={({ payload }) => `${(payload as TopActividad).porcentaje.toFixed(1)}%`}
                      >
                        {topAct.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 space-y-1.5">
                  {topAct.map((item, i) => (
                    <div key={i} className="flex items-baseline gap-2 text-xs">
                      <div className="w-2 h-2 rounded-full shrink-0 mt-1" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      <span className="leading-snug text-muted-foreground flex-1">{item.actividad}</span>
                      <span className="font-mono shrink-0 text-muted-foreground text-right">{item.porcentaje.toFixed(1)}%<br/><span className="text-[10px] opacity-60">{item.conteo.toLocaleString('es-MX')} observaciones</span></span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Distribución Horaria — Box Plots */}
        <div className="sci-panel">
          <div className="sci-panel-header flex-col items-start gap-1">
            <h3 className="font-editorial text-base font-bold text-foreground">
              Distribución Horaria de Eventos
            </h3>
            <p className="text-xs font-instrument text-muted-foreground">
              Mediana, Q1, Q3 por hora del día
            </p>
          </div>
          <div className="p-4">
            {eventosQuery.isError ? (
              <QueryError onRetry={() => eventosQuery.refetch()} />
            ) : eventosQuery.isLoading ? (
              <div className="h-[280px] flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="h-[280px]">
                <BoxplotTemporal 
                  data={eventosHoraFiltrado}
                  granularity="hour"
                  metric="total"
                  aggregation="manual"
                  timestampKey="hora"
                  showConfidence={true}
                  height={280}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Ranking de Actividades ────────────────────────────────── */}
      <div className="sci-panel animate-enter stagger-5">
        <div className="sci-panel-header flex-col items-start gap-1">
          <h3 className="font-editorial text-base font-bold flex items-center gap-2 text-foreground">
            <Activity className="w-4 h-4 text-primary" />
              Ranking de actividades observadas
          </h3>
          <p className="text-xs font-instrument text-muted-foreground">
            Porcentaje primero y N de observaciones por tipo de actividad.
          </p>
        </div>
        <div className="p-4">
          {topActQuery.isError ? (
            <QueryError onRetry={() => topActQuery.refetch()} />
          ) : topActQuery.isLoading ? (
            <div className="py-6 flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : topAct.length === 0 ? (
            <EmptyState
              title="Sin actividades para el filtro activo"
              description="Amplía el rango temporal o reduce filtros de ubicación/horario para ver patrones agregados."
            />
          ) : (
            <div className="space-y-2.5">
                  {topAct.map((r, i) => (
                    <div key={i} className="space-y-1">
                      <div className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="font-medium leading-snug">{r.actividad}</span>
                        <span className="font-mono shrink-0 text-muted-foreground text-right">
                          {r.porcentaje.toFixed(1)}%<br/>
                          <span className="text-[10px] opacity-60">{r.conteo.toLocaleString('es-MX')} observaciones</span>
                        </span>
                      </div>
                      <div className="h-3 bg-secondary/50 rounded overflow-hidden">
                    <div
                      className="h-full rounded transition-all"
                      style={{
                        width: `${Math.min(r.porcentaje * 2.5, 100)}%`,
                        backgroundColor: COLORS[i % COLORS.length],
                        opacity: 0.85,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">4</span>
          <div>
            <h2 className="font-editorial text-lg font-bold text-foreground">Contexto general</h2>
            <p className="text-sm text-muted-foreground">Condiciones ambientales y resumen interpretativo del periodo.</p>
          </div>
        </div>

      {/* ── Calidad del Aire + Alertas ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="sci-panel">
          <div className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs font-instrument text-muted-foreground uppercase tracking-wider mb-2">Calidad ambiental</p>
                <p className="text-3xl font-bold tracking-tight">
                  {kpis?.pm10_promedio != null ? kpis.pm10_promedio : '—'}
                  <span className="text-sm font-normal text-muted-foreground ml-1">µg/m³</span>
                </p>
              </div>
              <div className={`w-14 h-14 rounded flex items-center justify-center ${
                (kpis?.pm10_promedio ?? 0) < 54 ? 'bg-environment/10 border border-environment/20' : 'bg-destructive/10 border border-destructive/20'
              }`}>
                <Wind className={`w-7 h-7 ${
                  (kpis?.pm10_promedio ?? 0) < 54 ? 'text-environment' : 'text-destructive'
                }`} />
              </div>
            </div>
            <Badge
              variant="outline"
              className={`text-xs font-instrument rounded-sm ${
                (kpis?.pm10_promedio ?? 0) < 54
                  ? 'border-environment text-environment bg-environment/5'
                  : 'border-destructive text-destructive bg-destructive/5'
              }`}
            >
              {(kpis?.pm10_promedio ?? 0) < 54 ? '● Buena' : (kpis?.pm10_promedio ?? 0) < 154 ? '● Moderada' : '● Insalubre'}
            </Badge>
          </div>
        </div>

        <div className="sci-panel">
          <div className="p-5">
            <p className="text-xs font-instrument text-muted-foreground uppercase tracking-wider mb-3">Lectura del periodo</p>
            {kpisQuery.isLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground font-instrument text-xs">Tasa de fumado</span>
                  <span className="font-medium font-instrument">{kpis?.tasa_fumado != null ? `${kpis.tasa_fumado.toFixed(1)}%` : '—'}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground font-instrument text-xs">Hora pico</span>
                  <span className="font-medium font-instrument">{kpis?.hora_pico ?? '—'}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground font-instrument text-xs">Eventos de riesgo</span>
                  <span className={`font-medium font-instrument ${(kpis?.eventos_riesgo ?? 0) > 0 ? 'text-destructive' : ''}`}>
                    {kpis?.eventos_riesgo ?? '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground font-instrument text-xs">Dinámicas grupales</span>
                  <span className="font-medium font-instrument">{kpis?.patrones_activos ?? '—'}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      </section>
    </div>
  )
}
