import { useMemo } from 'react'
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, ResponsiveContainer, LabelList,
  AreaChart, Area, CartesianGrid,
} from 'recharts'
import { Loader2, Users, User, UserPlus, TrendingUp, Clock } from 'lucide-react'
import { useContextoSocial, useDuracionHabitos } from '@/hooks/queries'
import { SCI_COLORS } from '@/scientific/ScientificColorRegistry'
import { QueryError } from '@/components/ui/query-error'
import { EmptyState } from '@/components/ui/empty-state'
import type { IntervaloValue, GlobalFilters } from '@/types'

interface Props {
  intervalo: IntervaloValue
  filters?: GlobalFilters
}

const CONTEXTO_CONFIG: Record<string, { icon: any; color: string; bg: string; border: string; hex: string; label: string }> = {
  'Solo':   { icon: User,    color: 'text-chart-1',     bg: 'bg-chart-1/10',     border: 'border-chart-1/30',     hex: SCI_COLORS.chart[0],  label: 'Solo (1 persona)' },
  'Pareja': { icon: UserPlus, color: 'text-chart-2',    bg: 'bg-chart-2/10',      border: 'border-chart-2/30',      hex: SCI_COLORS.chart[1],  label: 'Pareja (2 personas)' },
  'Grupo':  { icon: Users,   color: 'text-chart-3',     bg: 'bg-chart-3/10',      border: 'border-chart-3/30',      hex: SCI_COLORS.chart[2],  label: 'Grupo (3+ personas)' },
}

export function ContextoSocial({ intervalo, filters }: Props) {
  const { data, isLoading, isError, refetch } = useContextoSocial(intervalo, filters)

  const totalObs = data?.total_observaciones ?? 0
  const totalFumado = data?.total_fumado ?? 0
  const porContexto = data?.por_contexto ?? []
  const porHora = data?.por_hora ?? []

  const maxTasa = useMemo(() => {
    if (!porContexto.length) return 1
    return Math.max(...porContexto.map(i => i.tasa_fumado), 1)
  }, [porContexto])

  if (isLoading) {
    return (
      <div className="sci-panel">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="sci-panel">
        <QueryError
          onRetry={() => refetch()}
          message="No se pudo cargar el contexto social"
          detail="El módulo necesita observaciones agregadas por tamaño de grupo. Reintenta o reduce filtros."
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">

      {/* ── Panel principal ────────────────────────────────────────── */}
      <div className="sci-panel">
        <div className="sci-panel-header flex-col items-start gap-1.5">
          <h3 className="font-editorial text-base font-bold flex items-center gap-2 text-foreground">
            <Users className="w-4 h-4 text-tobacco" />
            Contexto Social al Fumar
          </h3>
          <p className="text-xs font-instrument text-muted-foreground">
            Distribución de eventos de fumado según número de personas presentes (1=Solo, 2=Pareja, 3+=Grupo)
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <span className="text-[11px] font-mono text-muted-foreground">
              N = {totalObs.toLocaleString('es-MX')} observaciones · {totalFumado.toLocaleString('es-MX')} eventos con fumado
            </span>
          </div>
        </div>

        <div className="p-4 space-y-5">
          {totalFumado === 0 ? (
            <EmptyState
              title="Sin eventos de fumado en el periodo"
              description="No hay observaciones con fumado visible para describir contexto social con el filtro activo."
            />
          ) : (
            <>
              {/* ── Tarjetas de contexto ──────────────────────────────── */}
              <div className="grid grid-cols-3 gap-3">
                {porContexto.map((item) => {
                  const config = CONTEXTO_CONFIG[item.contexto as keyof typeof CONTEXTO_CONFIG] || CONTEXTO_CONFIG['Solo']
                  const Icon = config.icon
                  return (
                    <div key={item.contexto} className={`sci-panel p-3 border ${config.border} ${config.bg}`}>
                      <div className="flex items-center gap-2 mb-2">
                        <Icon className={`w-4 h-4 ${config.color}`} />
                        <span className="text-xs font-instrument font-medium">{item.contexto}</span>
                      </div>
                      <p className="text-xl font-bold">{item.eventos}</p>
                      <p className="text-xs font-mono text-muted-foreground mt-1">
                        {item.porcentaje.toFixed(1)}% · Tasa fumado: {item.tasa_fumado.toFixed(1)}% · N total: {item.total_contexto}
                      </p>
                    </div>
                  )
                })}
              </div>

              {/* ── Barra proporcional ────────────────────────────────── */}
              <div className="space-y-1.5">
                <p className="text-xs font-instrument text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <TrendingUp className="w-3 h-3" />
                  Distribución proporcional
                </p>
                <div className="flex h-6 rounded overflow-hidden border border-border/50">
                  {porContexto.map((item) => {
                    const config = CONTEXTO_CONFIG[item.contexto as keyof typeof CONTEXTO_CONFIG]
                    return (
                      <div
                        key={item.contexto}
                        style={{ width: `${item.porcentaje}%`, backgroundColor: config?.hex }}
                        className="opacity-70 transition-all hover:opacity-100"
                        title={`${item.contexto}: ${item.eventos} eventos (${item.porcentaje.toFixed(1)}%)`}
                      />
                    )
                  })}
                </div>
                <div className="flex items-center gap-4 text-[10px] font-instrument">
                  {porContexto.map((item) => {
                    const config = CONTEXTO_CONFIG[item.contexto as keyof typeof CONTEXTO_CONFIG]
                    return (
                      <div key={item.contexto} className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: config?.hex }} />
                        <span className="text-muted-foreground">{item.contexto}: {item.porcentaje.toFixed(1)}%</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ═════════════════════════════════════════════════════════════
          NUEVAS GRÁFICAS — solo si hay datos
         ═════════════════════════════════════════════════════════════ */}
      {totalFumado > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* ── 1. DONUT — Distribución proporcional ─────────────────── */}
          <div className="sci-panel">
            <div className="sci-panel-header flex-col items-start gap-1">
              <h3 className="font-editorial text-base font-bold text-foreground">Distribución de Eventos de Fumado</h3>
              <p className="text-xs font-instrument text-muted-foreground">
                Proporción de {totalFumado.toLocaleString('es-MX')} eventos agrupados por contexto social
              </p>
            </div>
            <div className="p-4">
              <div className="flex flex-col sm:flex-row items-center gap-6">
                <div className="h-[200px] w-[200px] shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={porContexto}
                        dataKey="eventos"
                        nameKey="contexto"
                        cx="50%" cy="50%"
                        innerRadius={52} outerRadius={82}
                        strokeWidth={2} stroke="hsl(var(--card))"
                        label={({ payload }) => `${payload.porcentaje.toFixed(1)}%`}
                      >
                        {porContexto.map((item) => {
                          const config = CONTEXTO_CONFIG[item.contexto as keyof typeof CONTEXTO_CONFIG]
                          return <Cell key={item.contexto} fill={config?.hex ?? 'hsl(var(--primary))'} />
                        })}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 space-y-2 min-w-0">
                  {porContexto.map((item) => {
                    const config = CONTEXTO_CONFIG[item.contexto as keyof typeof CONTEXTO_CONFIG]
                    return (
                      <div key={item.contexto} className="flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: config?.hex }} />
                          <span className="text-muted-foreground truncate">{config?.label ?? item.contexto}</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="font-mono shrink-0 text-muted-foreground text-right">{item.porcentaje.toFixed(1)}%<br/><span className="text-[10px] opacity-60">{item.eventos.toLocaleString('es-MX')} observaciones</span></span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* ── 2. BARRAS — Tasa de fumado por contexto ──────────────── */}
          <div className="sci-panel">
            <div className="sci-panel-header flex-col items-start gap-1">
              <h3 className="font-editorial text-base font-bold text-foreground">Tasa de Fumado por Contexto</h3>
              <p className="text-xs font-instrument text-muted-foreground">
                Incidencia relativa de fumado dentro de cada grupo social
              </p>
            </div>
            <div className="p-4">
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={porContexto.map(item => ({
                      ...item,
                      config: CONTEXTO_CONFIG[item.contexto as keyof typeof CONTEXTO_CONFIG],
                    }))}
                    margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.3} vertical={false} />
                    <XAxis
                      dataKey="contexto"
                      tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }}
                      axisLine={{ stroke: 'hsl(var(--border))' }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }}
                      axisLine={false} tickLine={false}
                      domain={[0, Math.ceil(maxTasa * 1.3)]}
                      unit="%"
                    />
                    <Bar dataKey="tasa_fumado" radius={[4, 4, 0, 0]} maxBarSize={64}>
                      {porContexto.map((item) => {
                        const config = CONTEXTO_CONFIG[item.contexto as keyof typeof CONTEXTO_CONFIG]
                        return <Cell key={item.contexto} fill={config?.hex ?? 'hsl(var(--primary))'} fillOpacity={0.85} />
                      })}
                      <LabelList dataKey="tasa_fumado" position="top" fontSize={10} fontWeight={600} fill="hsl(var(--muted-foreground))" formatter={(v: any) => `${Number(v).toFixed(1)}%`} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* ── 3. ÁREA APILADA — Evolución horaria (full width) ────── */}
          <div className="sci-panel lg:col-span-2">
            <div className="sci-panel-header flex-col items-start gap-1">
              <h3 className="font-editorial text-base font-bold text-foreground">Evolución Horaria del Contexto Social</h3>
              <p className="text-xs font-instrument text-muted-foreground">
                Eventos de fumado por hora del día, segmentados por contexto — N={totalFumado.toLocaleString('es-MX')} eventos
              </p>
            </div>
            <div className="p-4">
              {porHora.length === 0 ? (
                <div className="h-32 flex items-center justify-center border border-dashed border-border rounded-lg">
                  <p className="text-sm text-muted-foreground">Sin datos horarios para el período</p>
                </div>
              ) : (
                <>
                  <div className="h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={porHora} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                          {['Solo', 'Pareja', 'Grupo'].map(ctx => {
                            const cfg = CONTEXTO_CONFIG[ctx]
                            return (
                              <linearGradient key={ctx} id={`ctxGrad${ctx}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={cfg?.hex} stopOpacity={0.35} />
                                <stop offset="100%" stopColor={cfg?.hex} stopOpacity={0.05} />
                              </linearGradient>
                            )
                          })}
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.3} vertical={false} />
                        <XAxis
                          dataKey="hora"
                          tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }}
                          axisLine={{ stroke: 'hsl(var(--border))' }}
                          tickLine={false}
                          tickFormatter={(h: number) => `${h.toString().padStart(2, '0')}h`}
                        />
                        <YAxis
                          tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }}
                          axisLine={false} tickLine={false}
                          allowDecimals={false}
                        />
                        {['Solo', 'Pareja', 'Grupo'].map(ctx => {
                          const cfg = CONTEXTO_CONFIG[ctx]
                          return (
                            <Area
                              key={ctx}
                              type="monotone"
                              dataKey={ctx}
                              stackId="1"
                              stroke={cfg?.hex}
                              fill={`url(#ctxGrad${ctx})`}
                              strokeWidth={2}
                              dot={false}
                              activeDot={{ r: 4, strokeWidth: 0 }}
                            />
                          )
                        })}
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex items-center justify-center gap-5 mt-4 pt-3 border-t border-border/50">
                    {['Solo', 'Pareja', 'Grupo'].map(ctx => {
                      const cfg = CONTEXTO_CONFIG[ctx]
                      return (
                        <div key={ctx} className="flex items-center gap-1.5 text-xs font-instrument text-muted-foreground">
                          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: cfg?.hex }} />
                          <span>{cfg?.label ?? ctx}</span>
                        </div>
                      )
                    })}
                    <span className="text-xs font-editorial italic text-muted-foreground ml-auto">
                      Área apilada — cada franja representa el aporte de cada contexto al total por hora
                    </span>
                  </div>

                </>
              )}
            </div>
          </div>

        </div>
      )}

      {/* ── 4. DURACIÓN DEL HÁBITO POR CONTEXTO SOCIAL ───────────────── */}
      <DuracionContexto intervalo={intervalo} filters={filters} />

    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Sub-component: Duración del Hábito por Contexto Social
   ═══════════════════════════════════════════════════════════════════════════ */
function DuracionContexto({ intervalo, filters }: Props) {
  const { data, isLoading, isError, refetch } = useDuracionHabitos(intervalo, filters)

  const duracionStats = useMemo(() => {
    const sesiones = data?.sesiones ?? []
    const groups: Record<string, number[]> = { Solo: [], Pareja: [], Grupo: [] }
    sesiones.forEach(s => {
      const avg = s.personas_promedio
      if (avg <= 1.5) groups.Solo.push(s.duracion_minutos)
      else if (avg <= 2.5) groups.Pareja.push(s.duracion_minutos)
      else groups.Grupo.push(s.duracion_minutos)
    })
    return Object.entries(groups)
      .map(([key, vals]) => {
        const n = vals.length
        if (n === 0) return null
        const sum = vals.reduce((a, b) => a + b, 0)
        return {
          contexto: key,
          config: CONTEXTO_CONFIG[key],
          promedio: Math.round((sum / n) * 10) / 10,
          min: Math.round(Math.min(...vals)),
          max: Math.round(Math.max(...vals)),
          n,
        }
      })
      .filter(Boolean)
  }, [data])

  if (isLoading) {
    return (
      <div className="sci-panel">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="sci-panel">
        <QueryError
          onRetry={() => refetch()}
          message="No se pudo cargar duración de hábitos"
          detail="La consulta de sesiones no respondió. Reintenta o revisa filtros temporales."
        />
      </div>
    )
  }

  if (!duracionStats.length) {
    return (
      <div className="sci-panel">
        <EmptyState
          icon={Clock}
          title="Sin duración de hábitos"
          description="No hay sesiones con permanencia suficiente para el filtro activo."
        />
      </div>
    )
  }

  const maxPromedio = Math.max(...duracionStats.map(d => d!.promedio), 1)

  return (
    <div className="sci-panel">
      <div className="sci-panel-header flex-col items-start gap-1">
        <h3 className="font-editorial text-base font-bold flex items-center gap-2 text-foreground">
          <Clock className="w-4 h-4 text-chart-1" />
          Duración del Hábito por Contexto Social
        </h3>
        <p className="text-xs font-instrument text-muted-foreground">
          Duración promedio de sesiones continuas agrupadas por contexto — N={data!.sesiones.length} sesiones
        </p>
      </div>
      <div className="p-4">
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={duracionStats}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.3} vertical={false} />
              <XAxis
                dataKey="contexto"
                tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }}
                axisLine={{ stroke: 'hsl(var(--border))' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }}
                axisLine={false} tickLine={false}
                domain={[0, Math.ceil(maxPromedio * 1.3)]}
                unit=" min"
              />
              <Bar dataKey="promedio" radius={[4, 4, 0, 0]} maxBarSize={64}>
                {duracionStats.map(d => (
                  <Cell key={d!.contexto} fill={d!.config?.hex ?? 'hsl(var(--primary))'} fillOpacity={0.85} />
                ))}
                <LabelList dataKey="promedio" position="top" fontSize={10} fontWeight={600} fill="hsl(var(--muted-foreground))" formatter={(v: any) => `${Number(v).toFixed(1)} min`} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
