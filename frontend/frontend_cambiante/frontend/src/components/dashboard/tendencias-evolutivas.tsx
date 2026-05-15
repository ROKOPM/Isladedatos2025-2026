import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts'
import { TrendingUp, TrendingDown, Minus, Loader2 } from 'lucide-react'
import { useTendencias } from '@/hooks/queries'
import { QueryError } from '@/components/ui/query-error'
import type { IntervaloValue, GlobalFilters } from '@/types'

interface Props {
  intervalo: IntervaloValue
  filters?: GlobalFilters
}

export function TendenciasEvolutivas({ intervalo, filters }: Props) {
  const [agrupacion, setAgrupacion] = useState<'mes' | 'semana' | 'dia'>('mes')
  const { data, isLoading, isError, refetch } = useTendencias(intervalo, filters, agrupacion)

  const { tendencias, resumen } = data || {}

  const chartData = useMemo(() => {
    if (!tendencias) return []
    return tendencias.map(t => ({
      periodo: t.periodo,
      'Tasa fumado': t.tasa_fumado,
      'PM10 promedio': t.pm10_promedio,
    }))
  }, [tendencias])

  const TendenciaIcon = resumen?.tendencia === 'subiendo' ? TrendingUp
    : resumen?.tendencia === 'bajando' ? TrendingDown : Minus

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  if (isError || !data) {
    return (
      <Card>
        <CardContent>
          <QueryError
            onRetry={() => refetch()}
            message="No se pudieron cargar tendencias"
            detail="La consulta temporal no respondió. Reintenta o usa una agrupación menos granular."
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="font-serif text-lg flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-primary" />
              Tendencias Evolutivas
            </CardTitle>
            <CardDescription className="text-xs font-mono">
              Evolución de la tasa de fumado y PM10 en el tiempo
            </CardDescription>
          </div>
          <div className="flex items-center gap-1">
            {['mes', 'semana', 'dia'].map((ag) => (
              <button
                key={ag}
                onClick={() => setAgrupacion(ag as any)}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                  agrupacion === ag
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-muted-foreground hover:text-foreground'
                }`}
              >
                {ag === 'mes' ? 'Mensual' : ag === 'semana' ? 'Semanal' : 'Diario'}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!tendencias || tendencias.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            Sin datos suficientes para mostrar tendencias
          </p>
        ) : (
          <>
            {/* Resumen de tendencia */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              <div className="p-3 bg-secondary/30 rounded-lg">
                <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-1">
                  Tasa inicial
                </p>
                <p className="text-xl font-bold">
                  {resumen?.tasa_inicial?.toFixed(1) ?? '—'}%
                </p>
              </div>
              <div className="p-3 bg-secondary/30 rounded-lg">
                <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-1">
                  Tasa final
                </p>
                <p className="text-xl font-bold">
                  {resumen?.tasa_final?.toFixed(1) ?? '—'}%
                </p>
              </div>
              <div className={`p-3 rounded-lg ${
                resumen?.tendencia === 'subiendo' ? 'bg-destructive/10' :
                resumen?.tendencia === 'bajando' ? 'bg-accent/10' : 'bg-secondary/30'
              }`}>
                <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-1">
                  Tendencial
                </p>
                <div className="flex items-center gap-1.5">
                  <TendenciaIcon className={`w-4 h-4 ${
                    resumen?.tendencia === 'subiendo' ? 'text-destructive' :
                    resumen?.tendencia === 'bajando' ? 'text-accent' : 'text-muted-foreground'
                  }`} />
                  <p className={`text-sm font-bold ${
                    resumen?.tendencia === 'subiendo' ? 'text-destructive' :
                    resumen?.tendencia === 'bajando' ? 'text-accent' : ''
                  }`}>
                    {resumen?.tendencia === 'subiendo' ? '↗ Subiendo' :
                     resumen?.tendencia === 'bajando' ? '↘ Bajando' : '→ Estable'}
                    {resumen?.cambio_pct ? ` (${resumen.cambio_pct > 0 ? '+' : ''}${resumen.cambio_pct}%)` : ''}
                  </p>
                </div>
              </div>
            </div>

            {/* Gráfico de tendencias */}
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <XAxis
                    dataKey="periodo"
                    tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={{ stroke: 'hsl(var(--border))' }}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={false}
                    tickLine={false}
                    label={{ value: 'Tasa fumado (%)', angle: -90, position: 'insideLeft', style: { fontSize: 10 } }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={false}
                    tickLine={false}
                    label={{ value: 'PM10 (µg/m³)', angle: 90, position: 'insideRight', style: { fontSize: 10 } }}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (active && payload?.length) {
                        return (
                          <div className="bg-card border border-border rounded-lg p-3 shadow-xl text-xs">
                            <p className="font-medium mb-2">{label}</p>
                            {payload.map((entry, i) => (
                              <p key={i} className="font-mono">
                                <span style={{ color: entry.color }}>{entry.name}:</span> {entry.value}
                                {entry.name === 'Tasa fumado' ? '%' : String(entry.name ?? '').includes('PM10') ? ' µg/m³' : ''}
                              </p>
                            ))}
                          </div>
                        )
                      }
                      return null
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 10 }} iconSize={8} />
                  <ReferenceLine yAxisId="left" y={20} stroke="hsl(var(--destructive))" strokeDasharray="5 5" strokeOpacity={0.5} />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="Tasa fumado"
                    stroke="hsl(0, 60%, 50%)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="PM10 promedio"
                    stroke="hsl(145, 50%, 40%)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
