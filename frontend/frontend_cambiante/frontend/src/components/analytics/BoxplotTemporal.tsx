import { useMemo, useState } from 'react'
import { calculateQuartiles } from '../../utils/statistics/quartiles'
import { calculateConfidenceInterval } from '../../utils/statistics/confidenceInterval'
import type { TemporalGranularity } from '../../hooks/useAggregation'

export interface BoxplotTemporalProps {
  data: any[]
  granularity: TemporalGranularity
  metric: string
  comparisonMode?: boolean
  showConfidence?: boolean
  aggregation?: 'auto' | 'manual'
  height?: number
  timestampKey?: string
}

export function BoxplotTemporal({
  data,
  granularity,
  metric,
  comparisonMode = false,
  showConfidence = false,
  aggregation = 'auto',
  height = 300,
  timestampKey = 'timestamp'
}: BoxplotTemporalProps) {
  const [hovered, setHovered] = useState<string | null>(null)

  // 1. Group data by granularity and calculate stats
  const groupedData = useMemo(() => {
    // If the data is already aggregated (like from the old backend), we could handle it,
    // but the new scientific system requires raw values to calculate proper stats.
    const groups: Record<string, number[]> = {}
    
    data.forEach(item => {
      let groupKey = String(item[timestampKey] || item['hora'] || 'Unknown')
      const val = Number(item[metric])
      if (isNaN(val)) return

      if (aggregation === 'auto' && item[timestampKey]) {
        try {
          const d = new Date(item[timestampKey])
          if (!isNaN(d.getTime())) {
            if (granularity === 'hour') {
              groupKey = `${d.getHours().toString().padStart(2, '0')}h`
            } else if (granularity === 'day') {
              groupKey = d.toISOString().split('T')[0]
            } else if (granularity === 'week') {
              // ISO week approximation for grouping
              const firstDay = new Date(d.getFullYear(), 0, 1)
              const days = Math.floor((d.getTime() - firstDay.getTime()) / (24 * 60 * 60 * 1000))
              const weekNumber = Math.ceil((d.getDay() + 1 + days) / 7)
              groupKey = `W${weekNumber}-${d.getFullYear()}`
            } else if (granularity === 'month') {
              groupKey = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`
            }
          }
        } catch {
          // ignore parsing errors, use fallback key
        }
      }

      if (!groups[groupKey]) groups[groupKey] = []
      groups[groupKey].push(val)
    })

    // Calculate statistics for each group
    const result = Object.entries(groups).map(([key, values]) => {
      const stats = calculateQuartiles(values)
      const conf = calculateConfidenceInterval(values, 95)
      return {
        key,
        values,
        ...stats,
        confidence: conf,
        count: values.length
      }
    })

    // Sort by key if they look like time/numbers
    return result.sort((a, b) => a.key.localeCompare(b.key))
  }, [data, metric, granularity, aggregation, timestampKey])

  const VW = 800
  const VH = height
  const PAD = { top: 20, right: 20, bottom: 40, left: 50 }
  const plotW = VW - PAD.left - PAD.right
  const plotH = VH - PAD.top - PAD.bottom

  if (groupedData.length === 0) {
    return (
      <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        Sin datos suficientes para graficar
      </div>
    )
  }

  const allMax = Math.max(...groupedData.map(d => showConfidence ? Math.max(d.max, d.confidence.upper) : d.max))
  const allMin = Math.min(...groupedData.map(d => showConfidence ? Math.min(d.min, d.confidence.lower) : d.min), 0)
  const range = allMax - allMin || 1
  // Add a small 10% padding to maxY
  const maxY = allMax + (range * 0.1)

  const slotW = plotW / Math.max(groupedData.length, 1)
  const boxW = Math.max(10, Math.min(slotW * 0.55, 32))
  const ys = (v: number) => plotH - ((v - Math.min(allMin, 0)) / (maxY - Math.min(allMin, 0))) * plotH
  const cx = (i: number) => PAD.left + slotW * i + slotW / 2
  const yticks = [0, 0.25, 0.5, 0.75, 1].map(t => Math.round(Math.min(allMin, 0) + (maxY - Math.min(allMin, 0)) * t))

  return (
    <div className="w-full relative" style={{ height }}>
      <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ overflow: 'visible' }}>
        {/* Y-Axis lines */}
        {yticks.map(v => {
          const y = PAD.top + ys(v)
          return (
            <g key={v}>
              <line x1={PAD.left} x2={VW - PAD.right} y1={y} y2={y} stroke="hsl(var(--border))" strokeWidth={1} strokeDasharray="4,4" />
              <text x={PAD.left - 8} y={y + 4} textAnchor="end" fontSize={10} fill="hsl(var(--muted-foreground))">{v}</text>
            </g>
          )
        })}

        {/* Boxplots */}
        {groupedData.map((d, i) => {
          const x = cx(i)
          const hw = boxW / 2
          const labelY = VH - PAD.bottom + 20
          
          const yMax = PAD.top + ys(d.max)
          const yQ3  = PAD.top + ys(d.q3)
          const yMed = PAD.top + ys(d.median)
          const yQ1  = PAD.top + ys(d.q1)
          const yMin = PAD.top + ys(d.min)
          const isHov = hovered === d.key

          const boxColor = comparisonMode && i % 2 !== 0 ? 'hsl(var(--destructive))' : 'hsl(var(--primary))'

          return (
            <g key={d.key} onMouseEnter={() => setHovered(d.key)} onMouseLeave={() => setHovered(null)} style={{ cursor: 'crosshair' }}>
              {/* Interaction zone */}
              <rect x={x - hw * 2} y={PAD.top} width={hw * 4} height={plotH} fill="transparent" />
              
              {/* Confidence Band (if enabled) */}
              {showConfidence && d.count > 1 && (
                <rect 
                  x={x - hw * 1.5} 
                  y={PAD.top + ys(d.confidence.upper)} 
                  width={hw * 3} 
                  height={Math.max(1, (PAD.top + ys(d.confidence.lower)) - (PAD.top + ys(d.confidence.upper)))}
                  fill={boxColor} fillOpacity={0.1} rx={4}
                />
              )}

              {/* Top whisker */}
              <line x1={x} x2={x} y1={yMax} y2={yQ3} stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} />
              <line x1={x - hw * 0.5} x2={x + hw * 0.5} y1={yMax} y2={yMax} stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} />
              
              {/* IQR Box */}
              <rect 
                x={x - hw} y={yQ3} 
                width={boxW} height={Math.max(yQ1 - yQ3, 1)}
                fill={boxColor}
                fillOpacity={isHov ? 0.4 : 0.2}
                stroke={boxColor} strokeWidth={1.5} rx={2}
              />
              
              {/* Median */}
              <line x1={x - hw} x2={x + hw} y1={yMed} y2={yMed} stroke="hsl(var(--environment))" strokeWidth={2.5} />
              
              {/* Bottom whisker */}
              <line x1={x} x2={x} y1={yQ1} y2={yMin} stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} />
              <line x1={x - hw * 0.5} x2={x + hw * 0.5} y1={yMin} y2={yMin} stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} />
              
              {/* Outliers */}
              {d.outliers.map((outVal, idx) => (
                <circle key={idx} cx={x} cy={PAD.top + ys(outVal)} r={2} fill="hsl(var(--destructive))" fillOpacity={0.6} />
              ))}

              <text x={x} y={labelY} textAnchor="middle" fontSize={10} fill={isHov ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))"} fontWeight={isHov ? 600 : 400}>
                {d.key}
              </text>
            </g>
          )
        })}
      </svg>

      {/* Tooltip Científico HTML Overlay */}
      {hovered != null && (() => {
        const d = groupedData.find(g => g.key === hovered)
        if (!d) return null
        const idx = groupedData.findIndex(g => g.key === hovered)
        const tipX = Math.min(Math.max(cx(idx), PAD.left), VW - 260)
        
        return (
          <div 
            className="absolute pointer-events-none bg-card border border-border shadow-2xl rounded-xl p-4 z-50 animate-fade-in text-xs"
            style={{
              left: `${(tipX / VW) * 100}%`,
              top: PAD.top,
              maxWidth: 'min(250px, calc(100vw - 32px))',
              width: 'max-content',
            }}
          >
            <div className="flex justify-between items-end border-b border-border pb-2 mb-3">
              <span className="font-bold text-sm">{d.key}</span>
              <span className="text-xs text-muted-foreground font-mono">N = {d.count} observaciones</span>
            </div>
            
            <div className="space-y-3">
              {/* Mediana Interpretation */}
              <div>
                <div className="flex justify-between font-mono text-sm mb-0.5">
                  <span className="text-primary font-bold">Mediana</span>
                  <span className="font-bold">{d.median.toFixed(1)}</span>
                </div>
                <p className="text-xs text-muted-foreground leading-tight">
                  Frecuencia típica o comportamiento central esperado.
                </p>
              </div>

              {/* IQR Interpretation */}
              <div>
                <div className="flex justify-between font-mono text-xs mb-0.5">
                  <span className="text-muted-foreground">Rango IQR (Q1-Q3)</span>
                  <span>{d.q1.toFixed(1)} - {d.q3.toFixed(1)}</span>
                </div>
                <p className="text-xs text-muted-foreground leading-tight">
                  Rango de variabilidad normal. El 50% de las observaciones caen aquí.
                </p>
              </div>

              {/* Whiskers Interpretation */}
              <div>
                <div className="flex justify-between font-mono text-xs mb-0.5">
                  <span className="text-muted-foreground">Límites (Whiskers)</span>
                  <span>{d.min.toFixed(1)} - {d.max.toFixed(1)}</span>
                </div>
                <p className="text-xs text-muted-foreground leading-tight">
                  Límites de comportamiento esperado antes de considerarse anómalo.
                </p>
              </div>

              {/* Confidence Band Interpretation */}
              {showConfidence && (
                <div className="pt-2 border-t border-border/50">
                  <div className="flex justify-between font-mono text-[10px] mb-0.5">
                    <span className="text-primary/70 font-semibold uppercase">95% Confianza</span>
                    <span>{d.confidence.lower.toFixed(1)} a {d.confidence.upper.toFixed(1)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-tight">
                    Margen de error de la media poblacional. Si dos bandas no se cruzan, la diferencia es estadísticamente significativa.
                  </p>
                </div>
              )}

              {/* Outliers Interpretation */}
              {d.outliers.length > 0 && (
                <div className="pt-2 border-t border-border/50">
                  <div className="flex justify-between font-mono text-xs text-destructive mb-0.5">
                    <span className="font-bold">Outliers (Anómalos)</span>
                    <span>{d.outliers.length} observaciones</span>
                  </div>
                  <p className="text-[10px] text-destructive/80 leading-tight">
                    Eventos extremos fuera del patrón conductual normal esperado.
                  </p>
                </div>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
