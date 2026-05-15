import { useMemo } from 'react'
import {
  ComposedChart, Line, XAxis, YAxis, ResponsiveContainer,
  Area, ReferenceLine,
} from 'recharts'
import { Wind, AlertCircle, Loader2 } from 'lucide-react'
import { useCalidadAire } from '@/hooks/queries'
import { QueryError } from '@/components/ui/query-error'
import { EmptyState } from '@/components/ui/empty-state'
import type { IntervaloValue, GlobalFilters } from '@/types'

interface Props {
  intervalo: IntervaloValue
  filters?: GlobalFilters
}

function getQualityStyle(pm10: number | null) {
  const v = pm10 ?? 0
  if (v < 54) return { label: 'Buena', color: 'text-accent', bg: 'bg-accent/10', border: 'border-accent' }
  if (v < 154) return { label: 'Moderada', color: 'text-primary', bg: 'bg-primary/10', border: 'border-primary' }
  if (v < 254) return { label: 'Insalubre (sensibles)', color: 'text-warning', bg: 'bg-warning/10', border: 'border-warning/40' }
  return { label: 'Insalubre', color: 'text-destructive', bg: 'bg-destructive/10', border: 'border-destructive' }
}

function formatHour(iso: string): string {
  if (!iso || iso.length < 16) return iso
  return iso.substring(0, 16)
}

export function CalidadAirePage({ intervalo, filters }: Props) {
  const { data, isLoading, isError, refetch } = useCalidadAire(intervalo, filters)

  const quality = getQualityStyle(data?.actual.pm10 ?? null)

  const chartData = useMemo(() => {
    if (!data) return []
    const deduped = data.timeline.map((t) => {
      const tKey = formatHour(t.timestamp)
      return {
        ...t,
        time: tKey,
      }
    }).filter(d => d.pm10 != null && d.pm10 > 0)

    const dedupPM10 = (arr: typeof deduped): typeof deduped => {
      if (arr.length < 10) return arr
      let streakStart = 0
      const sanitized: typeof deduped = []
      for (let i = 1; i <= arr.length; i++) {
        const isLast = i === arr.length
        const prev = arr[i - 1].pm10
        if (!isLast && arr[i].pm10 === prev) continue
        const streakLen = i - streakStart
        if (streakLen >= 10 && prev !== null) {
          const prevVal = streakStart > 0 ? arr[streakStart - 1].pm10 : null
          const nextVal = !isLast ? arr[i].pm10 : null
          for (let j = streakStart; j < i; j++) {
            const t = (j - streakStart + 1) / (streakLen + 1)
            const pm10 = prevVal !== null && nextVal !== null
              ? Math.round(prevVal + (nextVal - prevVal) * t)
              : prevVal ?? nextVal ?? 0
            sanitized.push({ ...arr[j], pm10 })
          }
        } else {
          for (let j = streakStart; j < i; j++) {
            sanitized.push(arr[j])
          }
        }
        streakStart = i
      }
      return sanitized
    }

    return dedupPM10(deduped)
  }, [data])

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
        <Loader2 className="w-8 h-8 animate-spin" />
        <p className="text-sm">Cargando lecturas ambientales compatibles con los filtros...</p>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <QueryError
        onRetry={() => refetch()}
        message="No se pudieron cargar las lecturas ambientales"
        detail="El panel necesita lecturas del sensor Davis y observaciones agregadas. Reintenta o revisa la disponibilidad de datos ambientales."
      />
    )
  }

  return (
    <div className="space-y-5">
      <section className="sci-panel bg-secondary/20">
        <div className="sci-panel-header flex-col items-start gap-2">
          <div className="flex items-center gap-2">
            <Wind className="h-5 w-5 text-environment" />
            <h2 className="font-editorial text-xl font-bold text-foreground">Calidad ambiental</h2>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Lectura descriptiva del contexto ambiental observado durante el periodo activo. Las asociaciones con comportamiento agregado son exploratorias y no implican causalidad.
          </p>
        </div>
      </section>

      {/* ── Estado ambiental general ───────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="sci-panel relative overflow-hidden p-4">
          <div className={`absolute top-0 left-0 w-1 h-full ${quality.color.replace('text-', 'bg-')}`} />
          <div className="flex items-center gap-2 mb-2">
            <Wind className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">PM10 actual</span>
          </div>
          <p className="text-3xl font-bold tracking-tight">{data.actual.pm10 ?? '—'}</p>
          <p className="text-sm text-muted-foreground">µg/m³</p>
        </div>

        <div className={`sci-panel p-4 ${quality.bg}`}>
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className={`w-4 h-4 ${quality.color}`} />
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Estado ambiental</span>
          </div>
          <p className={`text-2xl font-bold tracking-tight ${quality.color}`}>{quality.label}</p>
          <p className="text-sm text-muted-foreground">Referencia ambiental</p>
        </div>
      </div>

      {/* ── Contexto y referencia ──────────────────────────────────── */}
      <div className="sci-panel bg-secondary/30 p-4">
          <div className="flex flex-col md:flex-row gap-6">
            <div className="flex-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Qué se está midiendo</p>
              <p className="text-sm text-foreground leading-relaxed">
                Partículas en suspensión de diámetro ≤ 10 µm. Provienen de polvo, tráfico, combustión y otras fuentes del entorno.
                Concentraciones altas se asocian con mayor riesgo respiratorio a nivel poblacional, sin atribuir una causa única desde este panel.
              </p>
            </div>
            <div className="flex-1 md:border-l md:border-border md:pl-6">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Límites de referencia (24 h)</p>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-accent" />
                  <span className="text-xs">&lt; 45 µg/m³ — <b className="text-accent">Buena</b> <span className="text-muted-foreground">(OMS 2021)</span></span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-primary" />
                  <span className="text-xs">45–74 µg/m³ — <b className="text-primary">Moderada</b> <span className="text-muted-foreground">(entre OMS y NOM)</span></span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-warning" />
                  <span className="text-xs">75–154 µg/m³ — <b className="text-warning">Insalubre sensibles</b> <span className="text-muted-foreground">(supera NOM-025)</span></span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-destructive" />
                  <span className="text-xs">≥ 155 µg/m³ — <b className="text-destructive">Insalubre</b></span>
                </div>
              </div>
            </div>
            <div className="md:border-l md:border-border md:pl-6">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Sensor activo</p>
              <p className="text-sm font-medium">Davis AirLink</p>
              <p className="text-xs text-muted-foreground">PM10 · Temperatura · Humedad</p>
            </div>
          </div>
      </div>

      {/* ── Distribución ambiental ──────────────────────────────────── */}
      <div className="sci-panel">
        <div className="sci-panel-header flex-col items-start gap-1">
          <h3 className="font-editorial text-base font-bold text-foreground">Evolución temporal de PM10</h3>
          <p className="text-sm text-muted-foreground">
            Línea punteada: referencia de 54 µg/m³. N = {chartData.length.toLocaleString('es-MX')} lecturas ambientales.
          </p>
        </div>
        <div className="p-4">
          {chartData.length === 0 ? (
            <div className="h-32 flex items-center justify-center border border-dashed border-border rounded-lg">
              <EmptyState
                icon={Wind}
                title="Sin lecturas ambientales para este filtro"
                description="Amplía el rango temporal o revisa la disponibilidad del sensor Davis para el periodo seleccionado."
              />
            </div>
          ) : (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="pm10Fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={{ stroke: 'hsl(var(--border))' }}
                    tickLine={false}
                    interval={4}
                  />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={false} tickLine={false}
                    label={{ value: 'PM10 (µg/m³)', angle: -90, position: 'insideLeft', style: { fontSize: 13, fill: 'hsl(var(--accent))' } }}
                  />
                  <ReferenceLine yAxisId="left" y={54} stroke="hsl(var(--accent))" strokeDasharray="5 5" strokeOpacity={0.5} />
                  <Area yAxisId="left" type="monotone" dataKey="pm10" fill="url(#pm10Fill)" stroke="hsl(var(--accent))" strokeWidth={2} />
                  <Line yAxisId="left" dataKey="pm10" stroke="transparent" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="sci-panel p-4">
        <h3 className="font-editorial text-base font-bold text-foreground">Lectura interpretativa</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Esta vista describe la variación ambiental registrada por el sensor. Los cambios temporales pueden coincidir con afluencia, clima, polvo u otras condiciones del entorno; el panel no atribuye causalidad.
        </p>
      </div>
    </div>
  )
}
