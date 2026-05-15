import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  ResponsiveContainer, XAxis, YAxis, CartesianGrid,
  LineChart, Line, Legend,
  BarChart, Bar, Cell, LabelList,
  AreaChart, Area,
} from 'recharts'
import { TrendingUp, Loader2, Users, User, UserPlus, Clock, AlertTriangle } from 'lucide-react'
import { useTopActividades, useFirmaTemporal, useDuracionHabitos } from '@/hooks/queries'
import { BoxplotTemporal } from '@/components/analytics/BoxplotTemporal'
import { TurnoBands } from '@/components/analytics/TurnoBands'
import { useAggregation } from '@/hooks/useAggregation'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DataWarningToast, ToastContainer } from '@/components/ui/data-warning-toast'
import { EmptyState } from '@/components/ui/empty-state'
import { SCI_COLORS } from '@/scientific/ScientificColorRegistry'
import type { IntervaloValue, GlobalFilters } from '@/types'

interface Props {
  intervalo: IntervaloValue
  filters?: GlobalFilters
}

type SocialContext = 'Solitario' | 'Pareja' | 'Grupo'

const MIN_DURATION_SESSIONS = 30
const MIN_ACTIVITY_DURATION_SESSIONS = 10

const SOCIAL_CONFIG: Record<SocialContext, { icon: any; color: string; bg: string; border: string; hex: string; description: string }> = {
  Solitario: {
    icon: User,
    color: 'text-chart-1',
    bg: 'bg-chart-1/10',
    border: 'border-chart-1/30',
    hex: SCI_COLORS.chart[0],
    description: 'Observaciones con permanencia principalmente individual.',
  },
  Pareja: {
    icon: UserPlus,
    color: 'text-chart-2',
    bg: 'bg-chart-2/10',
    border: 'border-chart-2/30',
    hex: SCI_COLORS.chart[1],
    description: 'Observaciones donde predominan dos personas.',
  },
  Grupo: {
    icon: Users,
    color: 'text-chart-3',
    bg: 'bg-chart-3/10',
    border: 'border-chart-3/30',
    hex: SCI_COLORS.chart[2],
    description: 'Observaciones con tres o más personas en promedio.',
  },
}

function classifySocialContext(personasPromedio: number): SocialContext {
  if (personasPromedio <= 1.5) return 'Solitario'
  if (personasPromedio <= 2.5) return 'Pareja'
  return 'Grupo'
}

function hourFromIso(value: string): number | null {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.getHours()
}

function DurationInsufficientState({ current }: { current: number }) {
  return (
    <div className="sci-panel">
      <EmptyState
        icon={AlertTriangle}
        title="Datos insuficientes para duración"
        description="No hay suficientes sesiones para estimar permanencia de forma estable con los filtros actuales."
      />
      <div className="mx-auto mb-8 max-w-md rounded-lg border border-border bg-secondary/40 px-4 py-3 text-center text-sm text-muted-foreground">
        Amplía el periodo o reduce filtros para obtener una distribución más representativa.
        <div className="mt-1 font-medium text-foreground">
          N actual = {current.toLocaleString('es-MX')} sesiones · mínimo recomendado = {MIN_DURATION_SESSIONS}
        </div>
      </div>
    </div>
  )
}

export function ComportamientosPage({ intervalo, filters }: Props) {
  const topActQuery = useTopActividades(intervalo, filters)
  const firmaQuery = useFirmaTemporal(intervalo, filters)
  const duracionQuery = useDuracionHabitos(intervalo, filters)

  const [vistaFirma, setVistaFirma] = useState<'auto' | 'detail' | 'distribution'>('auto')
  const [selectedFirmaAct, setSelectedFirmaAct] = useState<string>('all')

  const agg = useAggregation(intervalo, filters)
  const currentVista = vistaFirma === 'auto'
    ? (agg.mode === 'boxplot' || agg.mode === 'trend' ? 'distribution' : 'detail')
    : vistaFirma

  const topAct = topActQuery.data ?? []
  const firma = firmaQuery.data ?? []
  const sesiones = duracionQuery.data?.sesiones ?? []
  const hasEnoughDurationSessions = sesiones.length >= MIN_DURATION_SESSIONS

  const totalActividades = useMemo(() => {
    return topAct.reduce((sum, item) => sum + item.conteo, 0)
  }, [topAct])

  const actividadDominante = topAct[0]

  const socialStats = useMemo(() => {
    const base: Record<SocialContext, {
      contexto: SocialContext
      sesiones: number
      duracionTotal: number
      personasTotal: number
      actividades: Map<string, number>
    }> = {
      Solitario: { contexto: 'Solitario', sesiones: 0, duracionTotal: 0, personasTotal: 0, actividades: new Map() },
      Pareja: { contexto: 'Pareja', sesiones: 0, duracionTotal: 0, personasTotal: 0, actividades: new Map() },
      Grupo: { contexto: 'Grupo', sesiones: 0, duracionTotal: 0, personasTotal: 0, actividades: new Map() },
    }
    sesiones.forEach((sesion) => {
      const contexto = classifySocialContext(sesion.personas_promedio)
      const item = base[contexto]
      item.sesiones += 1
      item.duracionTotal += Number(sesion.duracion_minutos) || 0
      item.personasTotal += Number(sesion.personas_promedio) || 0
      item.actividades.set(sesion.actividad, (item.actividades.get(sesion.actividad) ?? 0) + 1)
    })
    const total = sesiones.length
    return (Object.keys(base) as SocialContext[]).map((contexto) => {
      const item = base[contexto]
      const topActivities = Array.from(item.actividades.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([actividad, conteo]) => ({
          actividad,
          conteo,
          porcentaje: item.sesiones > 0 ? (conteo / item.sesiones) * 100 : 0,
        }))
      return {
        ...item,
        porcentaje: total > 0 ? (item.sesiones / total) * 100 : 0,
        duracionPromedio: item.sesiones > 0 ? item.duracionTotal / item.sesiones : 0,
        personasPromedio: item.sesiones > 0 ? item.personasTotal / item.sesiones : 0,
        topActivities,
        reliableTopActivities: topActivities.filter((activity) => activity.conteo >= MIN_ACTIVITY_DURATION_SESSIONS),
        lowSampleActivities: topActivities.filter((activity) => activity.conteo > 0 && activity.conteo < MIN_ACTIVITY_DURATION_SESSIONS),
      }
    })
  }, [sesiones])

  const socialDominante = useMemo(() => {
    return socialStats.reduce<typeof socialStats[number] | null>((best, item) => {
      if (!best || item.sesiones > best.sesiones) return item
      return best
    }, null)
  }, [socialStats])

  const socialTemporalData = useMemo(() => {
    const hours: Record<number, Record<string, number | string>> = {}
    Array.from({ length: 24 }).forEach((_, h) => {
      hours[h] = { hora: `${String(h).padStart(2, '0')}h`, Solitario: 0, Pareja: 0, Grupo: 0 }
    })
    sesiones.forEach((sesion) => {
      const hour = hourFromIso(sesion.inicio)
      if (hour === null) return
      const contexto = classifySocialContext(sesion.personas_promedio)
      hours[hour][contexto] = Number(hours[hour][contexto] ?? 0) + 1
    })
    return Object.values(hours).filter(row => Number(row.Solitario) + Number(row.Pareja) + Number(row.Grupo) > 0)
  }, [sesiones])

  const topSocialInsight = useMemo(() => {
    if (!hasEnoughDurationSessions) return 'la muestra de permanencia es insuficiente para comparar tipos sociales con estabilidad.'
    const withActivity = socialStats
      .map(item => ({ contexto: item.contexto, actividad: item.reliableTopActivities[0] }))
      .filter(item => item.actividad)
    if (!withActivity.length) return 'No hay sesiones suficientes para describir hábitos por tipo social.'
    return withActivity
      .map(item => `${item.contexto.toLowerCase()}: ${item.actividad.actividad}`)
      .join(' · ')
  }, [hasEnoughDurationSessions, socialStats])

  const firmaChartData = useMemo(() => {
    const targetFirma = selectedFirmaAct !== 'all'
      ? firma.filter(f => f.actividad === selectedFirmaAct)
      : firma

    const hours: Record<number, Record<string, number>> = {}
    targetFirma.forEach((row) => {
      if (!hours[row.hora]) hours[row.hora] = { hora: row.hora }
      const key = row.actividad
      if (!hours[row.hora][key]) hours[row.hora][key] = 0
      hours[row.hora][key] += row.frecuencia
    })
    return Object.values(hours).sort((a, b) => (a.hora as number) - (b.hora as number)).map(h => ({
      ...h,
      time: `${String(h.hora).padStart(2, '0')}h`
    }))
  }, [firma, selectedFirmaAct])

  const topFirmaKeys = useMemo(() => {
    const counts: Record<string, number> = {}
    firma.forEach((row) => {
      const key = row.actividad
      counts[key] = (counts[key] || 0) + row.frecuencia
    })
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(e => e[0])
  }, [firma])

  const activeFirmaAct = selectedFirmaAct === 'all' && topFirmaKeys.length > 0
    ? topFirmaKeys[0]
    : selectedFirmaAct

  const firmaBoxplotData = useMemo(() => {
    if (!activeFirmaAct) return []
    return firma.filter(f => f.actividad === activeFirmaAct).map(f => ({
      ...f,
      horaStr: `${String(f.hora).padStart(2, '0')}h`
    }))
  }, [firma, activeFirmaAct])

  return (
    <div className="space-y-5">
      <ToastContainer>
        <DataWarningToast
          id="comportamientos-methodology-v2"
          title="Contexto metodológico"
            body="Los comportamientos se leen como patrones agregados y exploratorios. La distribución temporal no implica causalidad entre hora del día y tipo de conducta."
            variant="info"
          />
        </ToastContainer>

      <section className="sci-panel bg-secondary/20">
        <div className="sci-panel-header flex-col items-start gap-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            <h2 className="font-editorial text-xl font-bold text-foreground">Comportamientos sociales</h2>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Lectura agregada de actividades observadas, su peso relativo y su distribución por hora. No describe individuos ni perfiles personales.
          </p>
        </div>
        <div className="grid gap-3 p-4 pt-0 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-background/70 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Actividad dominante</p>
            <p className="mt-2 text-2xl font-bold text-foreground">{actividadDominante ? `${actividadDominante.porcentaje.toFixed(1)}%` : '—'}</p>
            <p className="text-sm text-muted-foreground">
              {actividadDominante
                ? `${actividadDominante.actividad} · N = ${actividadDominante.conteo.toLocaleString('es-MX')} observaciones`
                : 'Sin actividad dominante para este filtro'}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-background/70 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Observaciones clasificadas</p>
            <p className="mt-2 text-2xl font-bold text-foreground">{totalActividades.toLocaleString('es-MX')}</p>
            <p className="text-sm text-muted-foreground">Distribuidas por tipo de actividad</p>
          </div>
          <div className="rounded-lg border border-border bg-background/70 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Interacción dominante</p>
            <p className="mt-2 text-2xl font-bold text-foreground">{hasEnoughDurationSessions && socialDominante ? `${socialDominante.porcentaje.toFixed(1)}%` : 'Muestra baja'}</p>
            <p className="text-sm text-muted-foreground">
              {hasEnoughDurationSessions && socialDominante ? `${socialDominante.contexto} · N = ${socialDominante.sesiones.toLocaleString('es-MX')} sesiones` : `N actual = ${sesiones.length.toLocaleString('es-MX')} sesiones`}
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">1</span>
          <div>
            <h2 className="font-editorial text-lg font-bold text-foreground">Resumen social general</h2>
            <p className="text-sm text-muted-foreground">Distribución de sesiones según permanencia solitaria, en pareja o en grupo.</p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {socialStats.map((item) => {
            const config = SOCIAL_CONFIG[item.contexto]
            const Icon = config.icon
            return (
              <div key={item.contexto} className={`sci-panel p-4 border ${config.border} ${config.bg}`}>
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${config.color}`} />
                    <h3 className="font-editorial text-base font-bold text-foreground">{item.contexto}</h3>
                  </div>
                  <span className="text-2xl font-bold text-foreground">{item.porcentaje.toFixed(1)}%</span>
                </div>
                <p className="text-sm text-muted-foreground">N = {item.sesiones.toLocaleString('es-MX')} sesiones</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{config.description}</p>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-background/70">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(item.porcentaje, 100)}%`, backgroundColor: config.hex }} />
                </div>
              </div>
            )
          })}
        </div>
        {!hasEnoughDurationSessions && sesiones.length > 0 && (
          <div className="rounded-lg border border-amber-300/40 bg-amber-50/70 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/20 dark:text-amber-100">
            La distribución social se muestra como lectura preliminar. Para comparar permanencia con mayor estabilidad se recomiendan al menos {MIN_DURATION_SESSIONS} sesiones.
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">2</span>
          <div>
            <h2 className="font-editorial text-lg font-bold text-foreground">Distribución por tipo de actividad</h2>
            <p className="text-sm text-muted-foreground">Primero se observa qué comportamientos concentran mayor proporción.</p>
          </div>
        </div>

      {/* ── 2. Ranking de Actividades ─────────────────────────────────── */}
      <div className="sci-panel">
        <div className="sci-panel-header flex-col items-start gap-1">
          <h3 className="font-editorial text-base font-bold flex items-center gap-2 text-foreground">
            <TrendingUp className="w-4 h-4 text-primary" />
            Actividades más frecuentes
          </h3>
          <p className="text-xs font-instrument text-muted-foreground">
            Porcentaje primero y N de observaciones en el periodo seleccionado.
          </p>
        </div>
        <div className="p-4">
          {topActQuery.isLoading ? (
            <div className="py-8 flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : topAct.length === 0 ? (
            <EmptyState
              title="Sin actividades para este filtro"
              description="No hay observaciones conductuales suficientes. Amplía la ventana temporal o reduce filtros de zona, cámara u horario."
            />
          ) : (
            <div className="space-y-3">
              {topAct.map((item, index) => (
                <div key={item.actividad} className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2 text-sm">
                    <div className="flex items-start gap-2 min-w-0">
                      <span className="w-5 h-5 rounded-full bg-secondary flex items-center justify-center text-xs font-mono font-medium text-muted-foreground shrink-0 mt-0.5">
                        {index + 1}
                      </span>
                      <span className="font-medium text-xs leading-snug">{item.actividad}</span>
                    </div>
                      <span className="text-xs text-muted-foreground shrink-0 text-right">
                        {item.porcentaje.toFixed(1)}%<br />
                        <span className="opacity-70">N = {item.conteo.toLocaleString('es-MX')}</span>
                      </span>
                  </div>
                  <Progress
                    value={item.porcentaje}
                    className="h-1.5"
                    style={{ '--progress-background': SCI_COLORS.clusters[index % SCI_COLORS.clusters.length] } as React.CSSProperties}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">3</span>
          <div>
            <h2 className="font-editorial text-lg font-bold text-foreground">Actividades por tipo social</h2>
            <p className="text-sm text-muted-foreground">Qué hábitos observados dominan en sesiones solitarias, en pareja y en grupo.</p>
          </div>
        </div>

        {duracionQuery.isLoading ? (
          <div className="sci-panel flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !hasEnoughDurationSessions ? (
          <DurationInsufficientState current={sesiones.length} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            {socialStats.map((item) => {
              const config = SOCIAL_CONFIG[item.contexto]
              return (
                <div key={item.contexto} className="sci-panel">
                  <div className="sci-panel-header flex-col items-start gap-1">
                    <h3 className="font-editorial text-base font-bold text-foreground">{item.contexto}</h3>
                    <p className="text-sm text-muted-foreground">N = {item.sesiones.toLocaleString('es-MX')} sesiones · permanencia media {item.duracionPromedio.toFixed(1)} min</p>
                  </div>
                  <div className="p-4">
                    {item.reliableTopActivities.length === 0 ? (
                      <div className="space-y-3">
                        <p className="py-4 text-center text-sm text-muted-foreground">Sin actividades con muestra suficiente para este tipo social.</p>
                        {item.lowSampleActivities.length > 0 && (
                          <div className="rounded-lg border border-amber-300/40 bg-amber-50/70 p-3 text-xs text-amber-900 dark:bg-amber-950/20 dark:text-amber-100">
                            <p className="font-medium">Muestra baja</p>
                            <p className="mt-1 text-amber-800/80 dark:text-amber-100/70">
                              Estas actividades no se usan para conclusiones principales.
                            </p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {item.lowSampleActivities.map((activity) => (
                                <span key={activity.actividad} className="rounded-full border border-amber-300/60 bg-background/70 px-2 py-0.5 text-muted-foreground">
                                  {activity.actividad} · N = {activity.conteo.toLocaleString('es-MX')}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {item.reliableTopActivities.map((activity) => (
                          <div key={activity.actividad} className="space-y-1.5">
                            <div className="flex items-start justify-between gap-2 text-sm">
                              <span className="font-medium leading-snug text-foreground">{activity.actividad}</span>
                              <span className="shrink-0 text-right text-xs text-muted-foreground">
                                {activity.porcentaje.toFixed(1)}%<br />
                                <span className="opacity-70">N = {activity.conteo.toLocaleString('es-MX')}</span>
                              </span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-secondary/60">
                              <div className="h-full rounded-full" style={{ width: `${Math.min(activity.porcentaje, 100)}%`, backgroundColor: config.hex }} />
                            </div>
                          </div>
                        ))}
                        {item.lowSampleActivities.length > 0 && (
                          <div className="rounded-lg border border-amber-300/40 bg-amber-50/70 p-3 text-xs text-amber-900 dark:bg-amber-950/20 dark:text-amber-100">
                            <p className="font-medium">Muestra baja</p>
                            <p className="mt-1 text-amber-800/80 dark:text-amber-100/70">
                              Estas actividades no se usan para conclusiones principales.
                            </p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {item.lowSampleActivities.map((activity) => (
                                <span key={activity.actividad} className="rounded-full border border-amber-300/60 bg-background/70 px-2 py-0.5 text-muted-foreground">
                                  {activity.actividad} · N = {activity.conteo.toLocaleString('es-MX')}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">4</span>
          <div>
            <h2 className="font-editorial text-lg font-bold text-foreground">Relación comportamiento ↔ tiempo</h2>
            <p className="text-sm text-muted-foreground">Después se revisa cómo cambian los comportamientos durante el día.</p>
          </div>
        </div>
      {/* ── Firma Temporal ───────────────────────────────────────────── */}
      <div className="sci-panel">
        <div className="sci-panel-header flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h3 className="font-editorial text-base font-bold flex items-center gap-2 text-foreground">
              <TrendingUp className="w-4 h-4 text-primary" />
              Firma Temporal de Comportamiento
            </h3>
            <p className="text-xs font-instrument text-muted-foreground mt-1">
              {currentVista === 'distribution'
                ? 'Distribución estadística y variabilidad por hora del día'
                : 'Frecuencia agregada por hora del día'}
              {firma.length > 0 && ` — N = ${firma.reduce((s, f) => s + f.frecuencia, 0).toLocaleString('es-MX')} observaciones`}
            </p>
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-1 bg-muted p-1 rounded-md">
              <Button
                variant={vistaFirma === 'auto' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setVistaFirma('auto')}
                className="h-6 text-[10px] px-2"
              >
                Automática
              </Button>
              <Button
                variant={vistaFirma === 'detail' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setVistaFirma('detail')}
                className="h-6 text-[10px] px-2"
              >
                Serie por hora
              </Button>
              <Button
                variant={vistaFirma === 'distribution' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setVistaFirma('distribution')}
                className="h-6 text-[10px] px-2"
              >
                Distribución
              </Button>
            </div>

            {(currentVista === 'distribution' || selectedFirmaAct !== 'all') && topFirmaKeys.length > 0 && (
              <Select value={activeFirmaAct} onValueChange={setSelectedFirmaAct}>
                <SelectTrigger className="h-7 w-[200px] text-xs">
                  <SelectValue placeholder="Seleccionar actividad..." />
                </SelectTrigger>
                <SelectContent>
                  {currentVista === 'detail' && (
                    <SelectItem value="all">Todas (Top 6)</SelectItem>
                  )}
                  {topFirmaKeys.map(k => (
                    <SelectItem key={k} value={k}>{k}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        <div className="p-4">
          {firmaQuery.isLoading ? (
            <div className="h-[300px] flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : topFirmaKeys.length === 0 ? (
            <div className="h-[300px] flex items-center justify-center border border-dashed border-border rounded-lg">
              <EmptyState
                title="Sin firma temporal"
                description="No hay suficientes observaciones por hora para comparar actividad agregada con el filtro actual."
              />
            </div>
          ) : (
            <div className="h-[300px]">
              {currentVista === 'distribution' ? (
                <BoxplotTemporal
                  data={firmaBoxplotData}
                  granularity="hour"
                  metric="frecuencia"
                  timestampKey="horaStr"
                  aggregation="manual"
                  showConfidence={true}
                  height={300}
                />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={firmaChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <TurnoBands x1Matutino="07h" x2Matutino="14h" x1Vespertino="14h" x2Vespertino="21h" />
                    <XAxis
                      dataKey="time"
                      tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }}
                      axisLine={{ stroke: 'hsl(var(--border))' }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }}
                      axisLine={false} tickLine={false}
                    />
                    {selectedFirmaAct === 'all' && (
                      <Legend wrapperStyle={{ fontSize: 12, paddingTop: 10 }} iconSize={8} />
                    )}
                    {(selectedFirmaAct === 'all' ? topFirmaKeys : [selectedFirmaAct]).map((key) => (
                      <Line
                        key={key}
                        type="monotone"
                        dataKey={key}
                        stroke={SCI_COLORS.clusters[topFirmaKeys.indexOf(key) % SCI_COLORS.clusters.length]}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, strokeWidth: 0 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          )}
        </div>
      </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">5</span>
          <div>
            <h2 className="font-editorial text-lg font-bold text-foreground">Ritmos sociales y permanencia</h2>
            <p className="text-sm text-muted-foreground">Horarios y duración promedio según tipo de interacción social.</p>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
          <div className="sci-panel">
            <div className="sci-panel-header flex-col items-start gap-1">
              <h3 className="font-editorial text-base font-bold text-foreground">Distribución horaria por tipo social</h3>
              <p className="text-sm text-muted-foreground">Sesiones continuas clasificadas por hora de inicio. N = {sesiones.length.toLocaleString('es-MX')} sesiones.</p>
            </div>
            <div className="p-4">
              {duracionQuery.isLoading ? (
                <div className="flex h-[260px] items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : !hasEnoughDurationSessions ? (
                <EmptyState
                  icon={AlertTriangle}
                  title="Datos insuficientes para ritmo social"
                  description={`N actual = ${sesiones.length.toLocaleString('es-MX')} sesiones. Amplía el periodo para comparar horarios por tipo social.`}
                />
              ) : socialTemporalData.length === 0 ? (
                <EmptyState
                  title="Sin ritmo social horario"
                  description="No hay sesiones con hora válida para construir la distribución social."
                />
              ) : (
                <>
                  <div className="h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={socialTemporalData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                          {(Object.keys(SOCIAL_CONFIG) as SocialContext[]).map((ctx) => (
                            <linearGradient key={ctx} id={`socialGrad${ctx}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={SOCIAL_CONFIG[ctx].hex} stopOpacity={0.35} />
                              <stop offset="100%" stopColor={SOCIAL_CONFIG[ctx].hex} stopOpacity={0.05} />
                            </linearGradient>
                          ))}
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.3} vertical={false} />
                        <XAxis dataKey="hora" tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }} axisLine={{ stroke: 'hsl(var(--border))' }} tickLine={false} />
                        <YAxis tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} allowDecimals={false} />
                        {(Object.keys(SOCIAL_CONFIG) as SocialContext[]).map((ctx) => (
                          <Area
                            key={ctx}
                            type="monotone"
                            dataKey={ctx}
                            stackId="1"
                            stroke={SOCIAL_CONFIG[ctx].hex}
                            fill={`url(#socialGrad${ctx})`}
                            strokeWidth={2}
                            dot={false}
                            activeDot={{ r: 4, strokeWidth: 0 }}
                          />
                        ))}
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-border pt-3">
                    {(Object.keys(SOCIAL_CONFIG) as SocialContext[]).map((ctx) => (
                      <div key={ctx} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <div className="h-3 w-3 rounded-sm" style={{ backgroundColor: SOCIAL_CONFIG[ctx].hex }} />
                        <span>{ctx}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="sci-panel">
            <div className="sci-panel-header flex-col items-start gap-1">
              <h3 className="flex items-center gap-2 font-editorial text-base font-bold text-foreground">
                <Clock className="h-4 w-4 text-primary" />
                Permanencia por tipo social
              </h3>
              <p className="text-sm text-muted-foreground">Duración promedio de sesiones continuas.</p>
            </div>
            <div className="p-4">
              {duracionQuery.isLoading ? (
                <div className="flex h-[260px] items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : !hasEnoughDurationSessions ? (
                <EmptyState
                  icon={AlertTriangle}
                  title="Datos insuficientes para permanencia"
                  description={`N actual = ${sesiones.length.toLocaleString('es-MX')} sesiones. Se recomiendan al menos ${MIN_DURATION_SESSIONS} sesiones para comparar duración.`}
                />
              ) : (
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={socialStats} margin={{ top: 20, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.3} vertical={false} />
                      <XAxis dataKey="contexto" tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }} axisLine={{ stroke: 'hsl(var(--border))' }} tickLine={false} />
                      <YAxis tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} unit=" min" />
                      <Bar dataKey="duracionPromedio" radius={[4, 4, 0, 0]} maxBarSize={72}>
                        {socialStats.map((item) => (
                          <Cell key={item.contexto} fill={SOCIAL_CONFIG[item.contexto].hex} fillOpacity={0.85} />
                        ))}
                        <LabelList dataKey="duracionPromedio" position="top" fontSize={11} fontWeight={700} fill="hsl(var(--muted-foreground))" formatter={(v: any) => `${Number(v).toFixed(1)} min`} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="sci-panel p-4">
        <h2 className="font-editorial text-lg font-bold text-foreground">Hallazgos observacionales</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          La lectura social más visible es: {topSocialInsight}. Estos patrones describen comportamiento agregado observado y no implican perfilado individual ni causalidad.
        </p>
      </section>

    </div>
  )
}
