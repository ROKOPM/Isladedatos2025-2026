import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Loader2 } from 'lucide-react'
import { useHeatmap } from '@/hooks/queries'
import type { IntervaloValue, GlobalFilters } from '@/types'

function getHeatColor(value: number, maxValue: number): string {
  const intensity = maxValue > 0 ? value / maxValue : 0
  if (intensity < 0.2) return 'hsl(var(--secondary))'
  if (intensity < 0.4) return 'hsl(145, 40%, 55%)'
  if (intensity < 0.6) return 'hsl(145, 50%, 45%)'
  if (intensity < 0.8) return 'hsl(55, 60%, 50%)'
  return 'hsl(35, 70%, 50%)'
}

interface Props {
  intervalo: IntervaloValue
  filters?: GlobalFilters
}

export function TimeHeatmap({ intervalo, filters }: Props) {
  const { data: heatmap = [], isLoading } = useHeatmap(intervalo, filters)

  const activeHours = useMemo(() => {
    const hasData = new Set<number>()
    heatmap.forEach((r) => r.horas.forEach((c) => { if (c.valor > 0) hasData.add(c.hora) }))
    const sorted = Array.from(hasData).sort((a, b) => a - b)
    return sorted.length > 0 ? sorted : Array.from({ length: 10 }, (_, i) => i + 7)
  }, [heatmap])

  const maxValue = useMemo(() => {
    let max = 0
    heatmap.forEach((r) => r.horas.forEach((c) => { if (c.valor > max) max = c.valor }))
    return max
  }, [heatmap])

  return (
    <Card className="col-span-full">
      <CardHeader className="pb-3">
        <CardTitle className="font-serif text-lg">Mapa de Presencia: Día x Hora</CardTitle>
        <CardDescription className="text-xs font-mono">
          Suma de personas observadas por franja horaria y día de la semana.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-[180px] flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="flex mb-2">
              <div className="w-10 shrink-0" />
              <div className="flex-1 flex">
                {activeHours.map((h) => (
                  <div key={h} className="flex-1 text-center text-xs font-mono text-muted-foreground">
                    {h.toString().padStart(2, '0')}
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              {heatmap.map((dayData) => (
                <div key={dayData.dia} className="flex items-center gap-1">
                  <div className="w-10 shrink-0 text-xs font-medium text-muted-foreground text-right pr-2">
                    {dayData.dia}
                  </div>
                  <div className="flex-1 flex gap-px">
                    {dayData.horas.filter(c => activeHours.includes(c.hora)).map((hourData) => (
                      <div
                        key={hourData.hora}
                        className="flex-1 h-7 rounded-sm transition-all duration-200 hover:scale-110 hover:z-10 cursor-pointer group relative"
                        style={{ backgroundColor: getHeatColor(hourData.valor, maxValue) }}
                        title={`${dayData.dia} ${hourData.hora}:00 — ${hourData.valor} personas`}
                      >
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20">
                          <div className="bg-foreground text-background text-[10px] font-mono px-2 py-1 rounded whitespace-nowrap shadow-lg">
                            {hourData.valor} personas
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end mt-4 gap-2">
              <span className="text-xs font-mono text-muted-foreground">Baja</span>
              <div className="flex gap-0.5">
                {['hsl(var(--secondary))', 'hsl(145, 40%, 55%)', 'hsl(145, 50%, 45%)', 'hsl(55, 60%, 50%)', 'hsl(35, 70%, 50%)'].map(
                  (color, i) => (
                    <div key={i} className="w-6 h-3 rounded-sm" style={{ backgroundColor: color }} />
                  ),
                )}
              </div>
              <span className="text-xs font-mono text-muted-foreground">Alta</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
