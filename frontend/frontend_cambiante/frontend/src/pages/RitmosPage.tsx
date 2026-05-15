import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, LabelList,
  Cell,
} from 'recharts'
import { Users, Timer, Activity, Clock, CalendarDays, Loader2, AlertTriangle } from 'lucide-react'
import { useHeatmap, useEventosHora, useDuracionHabitos, useFirmaTemporal } from '@/hooks/queries'
import { getHeatColor, SCI_COLORS } from '@/scientific/ScientificColorRegistry'
import { QueryError } from '@/components/ui/query-error'
import { EmptyState } from '@/components/ui/empty-state'
import type { IntervaloValue, GlobalFilters } from '@/types'

interface Props {
  intervalo: IntervaloValue
  filters?: GlobalFilters
}

const MIN_DURATION_SESSIONS = 30
const MIN_ACTIVITY_DURATION_SESSIONS = 10

function getIntervalDays(intervalo: IntervaloValue, filters?: GlobalFilters) {
  if (filters?.desde && filters?.hasta) {
    const start = new Date(filters.desde).getTime()
    const end = new Date(filters.hasta).getTime()
    if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) {
      return Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1)
    }
  }

  const parsed = Number.parseInt(String(intervalo), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15
}

export function RitmosPage({ intervalo, filters }: Props) {
  const heatmapQuery = useHeatmap(intervalo, filters)
  const eventosQuery = useEventosHora(intervalo, filters)
  const duracionQuery = useDuracionHabitos(intervalo, filters)
  const firmaQuery = useFirmaTemporal(intervalo, filters)

  const isLoading = heatmapQuery.isLoading || eventosQuery.isLoading || duracionQuery.isLoading || firmaQuery.isLoading

  const heatmap = heatmapQuery.data ?? []
  const eventosHoraRaw = eventosQuery.data ?? []
  const duracion = duracionQuery.data
  const firma = firmaQuery.data ?? []

  const eventosHoraAgrupado = useMemo(() => {
    const map = new Map<string, { hora: string, total: number }>()
    eventosHoraRaw.forEach(e => {
      if (!map.has(e.hora)) map.set(e.hora, { hora: e.hora, total: 0 })
      const curr = map.get(e.hora)!
      curr.total += Number(e.total) || 0
    })
    return Array.from(map.values()).sort((a, b) => a.hora.localeCompare(b.hora))
  }, [eventosHoraRaw])

  const eventosHoraFiltrado = useMemo(() => {
    return eventosHoraAgrupado.filter(e => e.total > 0)
  }, [eventosHoraAgrupado])

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

  const boxPlotData = useMemo(() => {
    if (!duracion) return []
    const grouped: Record<string, number[]> = {}
    duracion.sesiones.forEach((s) => {
      if (!grouped[s.actividad]) grouped[s.actividad] = []
      grouped[s.actividad].push(s.duracion_minutos)
    })
    return Object.entries(grouped).map(([act, durations]) => {
      const sorted = [...durations].sort((a, b) => a - b)
      const median = sorted[Math.floor(sorted.length / 2)] || 0
      const q1 = sorted[Math.floor(sorted.length * 0.25)] || 0
      const q3 = sorted[Math.floor(sorted.length * 0.75)] || 0
      const min = sorted[0] || 0
      const max = sorted[sorted.length - 1] || 0
      return { actividad: act, min, q1, median, q3, max, count: durations.length }
    }).sort((a, b) => b.count - a.count)
  }, [duracion])

  const reliableBoxPlotData = useMemo(() => {
    return boxPlotData.filter((item) => item.count >= MIN_ACTIVITY_DURATION_SESSIONS)
  }, [boxPlotData])

  const lowSampleBoxPlotData = useMemo(() => {
    return boxPlotData.filter((item) => item.count > 0 && item.count < MIN_ACTIVITY_DURATION_SESSIONS)
  }, [boxPlotData])

  const reliableLongestActivity = useMemo(() => {
    return reliableBoxPlotData.reduce<typeof reliableBoxPlotData[number] | null>((best, item) => {
      if (!best || item.max > best.max) return item
      return best
    }, null)
  }, [reliableBoxPlotData])

  const reliableMostFrequentActivity = reliableBoxPlotData[0] ?? null

  const durationSessionCount = duracion?.sesiones.length ?? 0
  const hasEnoughDurationSessions = durationSessionCount >= MIN_DURATION_SESSIONS
  const intervalDays = useMemo(() => getIntervalDays(intervalo, filters), [intervalo, filters])
  const durationSessionsPerDay = Math.round(durationSessionCount / Math.max(1, intervalDays))

  const stackedFirmaData = useMemo(() => {
    const hours: Record<number, Record<string, any>> = {}
    firma.forEach((row) => {
      if (!hours[row.hora]) hours[row.hora] = { hora: `${row.hora.toString().padStart(2, '0')}h` }
      const key = row.actividad
      if (!hours[row.hora][key]) hours[row.hora][key] = 0
      hours[row.hora][key] += row.frecuencia
    })
    return Object.values(hours)
  }, [firma])

  const stackedKeys = useMemo(() => {
    const keys = new Set<string>()
    firma.forEach(row => keys.add(row.actividad))
    return Array.from(keys).sort()
  }, [firma])

  const patronHeatmapData = useMemo(() => {
    const grid: Record<string, number[]> = {}
    stackedKeys.forEach(k => grid[k] = Array(24).fill(0))
    firma.forEach((row) => {
      const key = row.actividad
      if (grid[key]) grid[key][row.hora] += row.frecuencia
    })
    return Object.entries(grid).map(([key, hours]) => ({ key, hours }))
  }, [firma, stackedKeys])

  const patronHeatmapMax = useMemo(() => {
    let max = 0
    patronHeatmapData.forEach(r => r.hours.forEach(v => { if (v > max) max = v }))
    return max
  }, [patronHeatmapData])

  const activePatronHours = useMemo(() => {
    const hasData = new Set<number>()
    patronHeatmapData.forEach((r) => r.hours.forEach((v, h) => { if (v > 0) hasData.add(h) }))
    const sorted = Array.from(hasData).sort((a, b) => a - b)
    return sorted.length > 0 ? sorted : Array.from({ length: 24 }, (_, i) => i)
  }, [patronHeatmapData])

  // Actividad por Día de la Semana — derivado del heatmap (suma de valores por día)
  const actividadPorDia = useMemo(() => {
    return heatmap.map((row) => ({
      dia: row.dia,
      total: row.horas.reduce((sum, h) => sum + h.valor, 0),
    }))
  }, [heatmap])

  const peakHour = useMemo(() => {
    return eventosHoraFiltrado.reduce<{ hora: string; total: number } | null>((best, item) => {
      if (!best || item.total > best.total) return { hora: item.hora, total: item.total }
      return best
    }, null)
  }, [eventosHoraFiltrado])

  const peakDay = useMemo(() => {
    return actividadPorDia.reduce<{ dia: string; total: number } | null>((best, item) => {
      if (!best || item.total > best.total) return { dia: item.dia, total: item.total }
      return best
    }, null)
  }, [actividadPorDia])

  const firmaTotal = useMemo(() => {
    return firma.reduce((sum, item) => sum + item.frecuencia, 0)
  }, [firma])

  return (
    <div className={`space-y-6 ${isLoading ? 'opacity-80' : ''}`}>
      <section className="sci-panel bg-secondary/20">
        <div className="sci-panel-header flex-col items-start gap-2">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            <h2 className="font-editorial text-xl font-bold text-foreground">Ritmos y temporalidad</h2>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Lectura exploratoria de cuándo se concentran los patrones observados, cómo cambian durante el día y qué hábitos aparecen en cada franja temporal.
          </p>
        </div>
        <div className="grid gap-3 p-4 pt-0 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-background/70 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Hora con mayor actividad</p>
            <p className="mt-2 text-2xl font-bold text-foreground">{peakHour?.hora ?? '—'}</p>
            <p className="text-sm text-muted-foreground">N = {(peakHour?.total ?? 0).toLocaleString('es-MX')} observaciones</p>
          </div>
          <div className="rounded-lg border border-border bg-background/70 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Día más activo</p>
            <p className="mt-2 text-2xl font-bold text-foreground">{peakDay?.dia ?? '—'}</p>
            <p className="text-sm text-muted-foreground">N = {(peakDay?.total ?? 0).toLocaleString('es-MX')} observaciones</p>
          </div>
          <div className="rounded-lg border border-border bg-background/70 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sesiones con duración registrada</p>
            <p className="mt-2 text-2xl font-bold text-foreground">{(duracion?.sesiones.length ?? 0).toLocaleString('es-MX')}</p>
            <p className="text-sm text-muted-foreground">
              N = {durationSessionCount.toLocaleString('es-MX')} sesiones con inicio y fin · ~{durationSessionsPerDay.toLocaleString('es-MX')} sesiones/día
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Observa permanencia: cuánto tiempo continuó cada actividad registrada.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">1</span>
          <div>
            <h3 className="font-editorial text-lg font-bold text-foreground">Vista general temporal</h3>
            <p className="text-sm text-muted-foreground">Primero se observa la intensidad general por día y hora.</p>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <div className="sci-panel">
            <div className="sci-panel-header flex-col items-start gap-1">
              <h4 className="font-editorial text-lg font-bold text-foreground">Mapa de presencia por día y hora</h4>
              <p className="text-sm text-muted-foreground">
                Intensidad agregada de personas observadas por franja horaria.
              </p>
            </div>
            <div className="p-4">
              {heatmapQuery.isError ? (
                <QueryError onRetry={() => heatmapQuery.refetch()} />
              ) : heatmapQuery.isLoading ? (
                <div className="flex h-[220px] items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : heatmap.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">No hay observaciones suficientes para construir el mapa temporal.</p>
              ) : (
                <>
                  <div className="-mx-1 overflow-x-auto px-1 pb-1">
                    <div className="min-w-[620px]">
                      <div className="mb-2 flex">
                        <div className="w-12 shrink-0" />
                        {activeHeatmapHours.map((h) => (
                          <div key={h} className="min-w-0 flex-1 text-center text-xs text-muted-foreground">
                            {h.toString().padStart(2, '0')}
                          </div>
                        ))}
                      </div>
                      <div className="flex flex-col gap-1">
                        {heatmap.map((row) => (
                          <div key={row.dia} className="flex items-center gap-1">
                            <div className="w-12 shrink-0 pr-2 text-right text-xs font-medium text-muted-foreground">{row.dia}</div>
                            {row.horas.filter(c => activeHeatmapHours.includes(c.hora)).map((cell) => (
                              <div
                                key={cell.hora}
                                className="group relative h-8 min-w-0 flex-1 rounded-sm transition-transform duration-200 hover:z-10 hover:scale-105"
                                style={{ backgroundColor: getHeatColor(cell.valor, heatmapMax) }}
                              >
                                <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 -translate-x-1/2 opacity-0 transition-opacity group-hover:opacity-100">
                                  <div className="whitespace-nowrap rounded bg-foreground px-2 py-1 text-[11px] text-background shadow-lg">
                                    {row.dia} {cell.hora}:00 · N = {cell.valor.toLocaleString('es-MX')}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-end gap-2">
                    <span className="text-xs text-muted-foreground">Baja</span>
                    <div className="flex gap-0.5">
                      {[SCI_COLORS.heatmap.none, SCI_COLORS.heatmap.low, SCI_COLORS.heatmap.medium, SCI_COLORS.heatmap.peak, SCI_COLORS.heatmap.max].map(
                        (c, i) => <div key={i} className="h-3 w-6 rounded-sm" style={{ backgroundColor: c }} />,
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">Alta</span>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="sci-panel">
            <div className="sci-panel-header flex-col items-start gap-1">
              <h4 className="flex items-center gap-2 font-editorial text-base font-bold text-foreground">
                <CalendarDays className="h-4 w-4 text-primary" />
                Actividad por día
              </h4>
              <p className="text-sm text-muted-foreground">
                N = {actividadPorDia.reduce((s, d) => s + d.total, 0).toLocaleString('es-MX')} observaciones acumuladas.
              </p>
            </div>
            <div className="p-4">
              {heatmapQuery.isLoading ? (
                <div className="flex h-[260px] items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : actividadPorDia.length === 0 ? (
                <div className="flex h-[260px] items-center justify-center">
                  <p className="text-sm text-muted-foreground">No hay observaciones para este rango temporal.</p>
                </div>
              ) : (
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={actividadPorDia} margin={{ top: 18, right: 10, left: 0, bottom: 0 }}>
                      <XAxis dataKey="dia" tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }} axisLine={{ stroke: 'hsl(var(--border))' }} tickLine={false} />
                      <YAxis tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                      <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                        {actividadPorDia.map((_, i) => (
                          <Cell key={i} fill={SCI_COLORS.clusters[i % SCI_COLORS.clusters.length]} />
                        ))}
                        <LabelList dataKey="total" position="top" fontSize={11} fontWeight={600} fill="hsl(var(--muted-foreground))" />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">2</span>
          <div>
            <h3 className="font-editorial text-lg font-bold text-foreground">Ritmos principales</h3>
            <p className="text-sm text-muted-foreground">Después se revisa qué tipos de actividad dominan cada hora del día.</p>
          </div>
        </div>

        <div className="sci-panel">
          <div className="sci-panel-header flex-col items-start gap-1">
            <h4 className="flex items-center gap-2 font-editorial text-base font-bold text-foreground">
              <Users className="h-4 w-4 text-primary" />
              Distribución horaria por tipo de actividad
            </h4>
            <p className="text-sm text-muted-foreground">
              N = {firmaTotal.toLocaleString('es-MX')} observaciones clasificadas por hora.
            </p>
          </div>
          <div className="p-4">
            {firmaQuery.isError ? (
              <QueryError onRetry={() => firmaQuery.refetch()} />
            ) : firmaQuery.isLoading ? (
              <div className="flex h-[280px] items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : stackedKeys.length === 0 ? (
              <div className="flex h-[280px] items-center justify-center">
                <p className="text-sm text-muted-foreground">No hay observaciones temporales para los filtros actuales.</p>
              </div>
            ) : (
              <>
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stackedFirmaData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <XAxis dataKey="hora" tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }} axisLine={{ stroke: 'hsl(var(--border))' }} tickLine={false} />
                      <YAxis tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                      {stackedKeys.map((name, i) => (
                        <Bar key={name} dataKey={name} stackId="a" fill={SCI_COLORS.clusters[i % SCI_COLORS.clusters.length]} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-2 xl:grid-cols-3">
                  {(() => {
                    const totals: Record<string, number> = {}
                    firma.forEach(f => { totals[f.actividad] = (totals[f.actividad] || 0) + f.frecuencia })
                    return stackedKeys.map((name, i) => {
                      const total = totals[name] ?? 0
                      const pct = firmaTotal > 0 ? (total / firmaTotal) * 100 : 0
                      return (
                        <div key={name} className="flex items-start gap-2 rounded-md bg-secondary/30 p-2 text-xs">
                          <div className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: SCI_COLORS.clusters[i % SCI_COLORS.clusters.length] }} />
                          <div className="min-w-0">
                            <p className="font-semibold leading-snug text-foreground">{pct.toFixed(1)}%</p>
                            <p className="leading-snug text-muted-foreground">N = {total.toLocaleString('es-MX')} · {name}</p>
                          </div>
                        </div>
                      )
                    })
                  })()}
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">3</span>
          <div>
            <h3 className="font-editorial text-lg font-bold text-foreground">Relación tiempo ↔ hábitos</h3>
            <p className="text-sm text-muted-foreground">Aquí se observa qué patrones aparecen con mayor frecuencia en cada momento del día.</p>
          </div>
        </div>

        <div className="sci-panel">
          <div className="sci-panel-header flex-col items-start gap-1">
            <h4 className="flex items-center gap-2 font-editorial text-lg font-bold text-foreground">
              <Activity className="h-5 w-5 text-primary" />
              Intensidad de hábitos por hora
            </h4>
            <p className="text-sm text-muted-foreground">
              Matriz exploratoria de frecuencia por tipo de patrón y franja horaria.
            </p>
          </div>
          <div className="p-4">
            {firmaQuery.isError ? (
              <QueryError onRetry={() => firmaQuery.refetch()} />
            ) : firmaQuery.isLoading ? (
              <div className="flex h-[180px] items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (() => {
              const visibleRows = patronHeatmapData.filter(row => activePatronHours.some(h => row.hours[h] > 0))
              return visibleRows.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No hay patrones temporales para los filtros actuales.</p>
              ) : (
                <>
                  <div className="-mx-1 overflow-x-auto px-1 pb-1">
                    <div className="min-w-[620px]">
                      <div className="mb-2 flex">
                        <div className="w-10 shrink-0" />
                        {activePatronHours.map((h) => (
                          <div key={h} className="min-w-0 flex-1 text-center text-xs text-muted-foreground">
                            {h.toString().padStart(2, '0')}
                          </div>
                        ))}
                      </div>
                      <div className="flex flex-col gap-1">
                        {visibleRows.map((row, rowIdx) => (
                          <div key={row.key} className="flex items-center gap-1">
                            <div className="w-10 shrink-0 pr-2 text-right text-xs font-medium text-muted-foreground">
                              {rowIdx + 1}
                            </div>
                            {activePatronHours.map((h) => {
                              const val = row.hours[h] ?? 0
                              return (
                                <div
                                  key={h}
                                  className="group relative h-7 min-w-0 flex-1 rounded-sm transition-transform duration-200 hover:z-10 hover:scale-105"
                                  style={{ backgroundColor: getHeatColor(val, patronHeatmapMax) }}
                                >
                                  <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 -translate-x-1/2 opacity-0 transition-opacity group-hover:opacity-100">
                                    <div className="whitespace-nowrap rounded bg-foreground px-2 py-1 text-[11px] text-background shadow-lg">
                                      {row.key} · {h.toString().padStart(2, '0')}:00 · N = {val.toLocaleString('es-MX')}
                                    </div>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-2 border-t border-border pt-3 sm:grid-cols-2">
                    {visibleRows.map((row, i) => (
                      <div key={row.key} className="flex items-baseline gap-2 text-sm">
                        <span className="w-5 shrink-0 text-right text-xs font-medium text-muted-foreground">{i + 1}</span>
                        <span className="leading-snug text-foreground">{row.key}</span>
                      </div>
                    ))}
                  </div>
                </>
              )
            })()}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">4</span>
          <div>
            <h3 className="font-editorial text-lg font-bold text-foreground">Duración y permanencia</h3>
            <p className="text-sm text-muted-foreground">Finalmente se revisa cuánto duran los patrones y qué actividades concentran mayor permanencia.</p>
          </div>
        </div>

        {duracionQuery.isError ? (
          <QueryError onRetry={() => duracionQuery.refetch()} />
        ) : duracionQuery.isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !duracion || !hasEnoughDurationSessions ? (
          <div className="sci-panel">
            <EmptyState
              icon={AlertTriangle}
              title="Datos insuficientes para duración"
              description="No hay suficientes sesiones para estimar permanencia de forma estable con los filtros actuales."
            />
            <div className="mx-auto mb-8 max-w-md rounded-lg border border-border bg-secondary/40 px-4 py-3 text-center text-sm text-muted-foreground">
              Amplía el periodo o reduce filtros para obtener una distribución más representativa.
              <div className="mt-1 font-medium text-foreground">
                N actual = {durationSessionCount.toLocaleString('es-MX')} sesiones · mínimo recomendado = {MIN_DURATION_SESSIONS}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sci-panel p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Timer className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Mediana global</span>
                </div>
                <p className="text-2xl font-bold">{duracion.resumen.mediana_global?.toFixed(1) ?? '—'} <span className="text-sm font-normal text-muted-foreground">min</span></p>
              </div>
              <div className="sci-panel p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Mayor permanencia</span>
                </div>
                <p className="text-sm font-bold leading-snug">{reliableLongestActivity?.actividad ?? 'Sin muestra suficiente'}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {reliableLongestActivity ? `${reliableLongestActivity.max.toFixed(1)} min` : `N mínimo: ${MIN_ACTIVITY_DURATION_SESSIONS} sesiones`}
                </p>
              </div>
              <div className="sci-panel p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Patrón más frecuente</span>
                </div>
                <p className="text-sm font-bold leading-snug">{reliableMostFrequentActivity?.actividad ?? 'Sin muestra suficiente'}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {reliableMostFrequentActivity ? `N = ${reliableMostFrequentActivity.count.toLocaleString('es-MX')} sesiones` : `N mínimo: ${MIN_ACTIVITY_DURATION_SESSIONS} sesiones`}
                </p>
              </div>
            </div>

            <div className="sci-panel">
              <div className="sci-panel-header flex-col items-start gap-1">
                <h4 className="font-editorial text-base font-bold text-foreground">Distribución de duración por actividad</h4>
                <p className="text-sm text-muted-foreground">
                  Rango observado en minutos: mínimo, cuartiles, mediana y máximo.
                </p>
              </div>
              <div className="p-4">
                {reliableBoxPlotData.length > 0 ? (
                  <div className="space-y-4">
                    {reliableBoxPlotData.map((bp) => {
                      const range = bp.max - bp.min || 1
                      const pct = duracion.sesiones.length > 0 ? (bp.count / duracion.sesiones.length) * 100 : 0
                      return (
                        <div key={bp.actividad} className="space-y-1.5">
                          <div className="flex flex-col gap-1 text-sm sm:flex-row sm:items-start sm:justify-between">
                            <span className="font-medium leading-snug text-foreground">{bp.actividad}</span>
                            <span className="text-muted-foreground">{pct.toFixed(1)}% · N = {bp.count.toLocaleString('es-MX')} sesiones · mediana {bp.median.toFixed(1)} min</span>
                          </div>
                          <div className="relative h-7 rounded bg-secondary/50">
                            <div
                              className="absolute h-full rounded bg-primary/25"
                              style={{
                                left: `${((bp.q1 - bp.min) / range) * 100}%`,
                                width: `${((bp.q3 - bp.q1) / range) * 100}%`,
                              }}
                            />
                            <div className="absolute top-0 h-full w-0.5 rounded bg-primary" style={{ left: `${((bp.median - bp.min) / range) * 100}%` }} />
                            <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-muted-foreground/30" />
                          </div>
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>{bp.min.toFixed(0)} min</span>
                            <span>{bp.max.toFixed(0)} min</span>
                          </div>
                        </div>
                      )
                    })}
                    {lowSampleBoxPlotData.length > 0 && (
                      <div className="rounded-lg border border-amber-300/40 bg-amber-50/70 p-3 text-sm dark:bg-amber-950/20">
                        <p className="font-medium text-amber-900 dark:text-amber-200">Actividades con muestra baja</p>
                        <p className="mt-1 text-xs leading-relaxed text-amber-800/80 dark:text-amber-100/70">
                          Se omiten de la distribución principal porque no alcanzan {MIN_ACTIVITY_DURATION_SESSIONS} sesiones.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {lowSampleBoxPlotData.map((item) => (
                            <span key={item.actividad} className="rounded-full border border-amber-300/60 bg-background/70 px-2.5 py-1 text-xs text-muted-foreground">
                              {item.actividad} · Muestra baja · N = {item.count.toLocaleString('es-MX')} sesiones
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <EmptyState
                    icon={AlertTriangle}
                    title="Datos insuficientes por actividad"
                    description={`Ninguna actividad alcanza ${MIN_ACTIVITY_DURATION_SESSIONS} sesiones para estimar permanencia de forma estable.`}
                  />
                )}
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
