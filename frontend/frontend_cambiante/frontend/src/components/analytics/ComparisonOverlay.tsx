import { useMemo, useState } from 'react'
import { buildComparativeDataset } from '../../utils/statistics/comparative'

export type ComparisonMode = 'median' | 'distribution' | 'variance' | 'confidence' | 'outliers'

export interface ComparisonOverlayProps {
  dataA: any[]
  dataB: any[]
  metric: string
  timestampKey?: string
  mode?: ComparisonMode
  height?: number
  labelA?: string
  labelB?: string
}

export function ComparisonOverlay({
  dataA,
  dataB,
  metric,
  timestampKey = 'hora',
  mode = 'distribution',
  height = 350,
  labelA = 'Periodo A',
  labelB = 'Periodo B'
}: ComparisonOverlayProps) {
  const [hovered, setHovered] = useState<string | null>(null)

  // Memoized comparative aggregation
  const comparativeData = useMemo(() => {
    return buildComparativeDataset(dataA, dataB, metric, timestampKey)
  }, [dataA, dataB, metric, timestampKey])

  const VW = 800
  const VH = height
  const PAD = { top: 20, right: 30, bottom: 40, left: 60 }
  const plotW = VW - PAD.left - PAD.right
  const plotH = VH - PAD.top - PAD.bottom

  if (comparativeData.length === 0) {
    return (
      <div className="flex items-center justify-center text-sm text-muted-foreground bg-secondary/20 rounded-lg" style={{ height }}>
        Sin datos suficientes para comparación.
      </div>
    )
  }

  // Compute global max and min
  let globalMax = 0
  let globalMin = Infinity

  comparativeData.forEach(d => {
    if (d.maxA != null && d.maxA > globalMax) globalMax = d.maxA
    if (d.maxB != null && d.maxB > globalMax) globalMax = d.maxB
    if (d.confA?.upper != null && d.confA.upper > globalMax) globalMax = d.confA.upper
    if (d.confB?.upper != null && d.confB.upper > globalMax) globalMax = d.confB.upper

    if (d.minA != null && d.minA < globalMin) globalMin = d.minA
    if (d.minB != null && d.minB < globalMin) globalMin = d.minB
    if (d.confA?.lower != null && d.confA.lower < globalMin) globalMin = d.confA.lower
    if (d.confB?.lower != null && d.confB.lower < globalMin) globalMin = d.confB.lower
  })

  if (globalMin === Infinity) globalMin = 0
  const range = (globalMax - globalMin) || 1

  const cy = (val: number) => PAD.top + plotH - ((val - globalMin) / range) * plotH
  const cx = (idx: number) => PAD.left + (idx + 0.5) * (plotW / comparativeData.length)

  const groupWidth = (plotW / comparativeData.length) * 0.7
  const barWidth = groupWidth / 2.5

  // Color semantics
  const colorA = '#3b82f6' // Blue (Period A)
  const colorB = '#f59e0b' // Amber (Period B)

  // Generators for continuous bands
  const buildPolygon = (points: [number, number][]) => points.map(p => p.join(',')).join(' ')
  
  const bandA: [number, number][] = []
  const bandA_rev: [number, number][] = []
  const bandB: [number, number][] = []
  const bandB_rev: [number, number][] = []

  if (mode === 'confidence') {
    comparativeData.forEach((d, i) => {
      const x = cx(i)
      if (d.confA) {
        bandA.push([x, cy(d.confA.upper)])
        bandA_rev.unshift([x, cy(d.confA.lower)])
      }
      if (d.confB) {
        bandB.push([x, cy(d.confB.upper)])
        bandB_rev.unshift([x, cy(d.confB.lower)])
      }
    })
  }

  return (
    <div className="relative w-full h-full font-sans select-none">
      <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full h-full overflow-visible" preserveAspectRatio="none">
        {/* Background Grid */}
        <g className="text-muted-foreground/20">
          {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
            const y = PAD.top + plotH * pct
            const val = globalMin + range * (1 - pct)
            return (
              <g key={`grid-y-${i}`}>
                <line x1={PAD.left} y1={y} x2={VW - PAD.right} y2={y} stroke="currentColor" strokeDasharray="4 4" strokeWidth={1} />
                <text x={PAD.left - 8} y={y + 4} textAnchor="end" className="text-[10px] fill-muted-foreground font-mono">
                  {val.toFixed(1)}
                </text>
              </g>
            )
          })}
        </g>

        {/* X Axis Labels */}
        <g>
          {comparativeData.map((d, i) => (
            <text key={`label-${i}`} x={cx(i)} y={VH - 10} textAnchor="middle" className="text-[10px] fill-muted-foreground font-mono">
              {d.key}
            </text>
          ))}
        </g>

        {/* Modes Rendering */}
        {mode === 'distribution' && comparativeData.map((d, i) => {
          const x = cx(i)
          const offset = groupWidth / 4

          return (
            <g key={`dist-${i}`} onMouseEnter={() => setHovered(d.key)} onMouseLeave={() => setHovered(null)}>
              {/* Invisible interaction layer */}
              <rect x={x - groupWidth/2} y={PAD.top} width={groupWidth} height={plotH} fill="transparent" />

              {/* Boxplot A */}
              {d.q1A != null && d.q3A != null && d.medianA != null && (
                <g transform={`translate(${-offset}, 0)`}>
                  <line x1={x} y1={cy(d.maxA!)} x2={x} y2={cy(d.minA!)} stroke={colorA} strokeWidth={1} opacity={0.5} />
                  <rect x={x - barWidth/2} y={cy(d.q3A)} width={barWidth} height={cy(d.q1A) - cy(d.q3A)} fill={colorA} fillOpacity={0.3} stroke={colorA} strokeWidth={1.5} />
                  <line x1={x - barWidth/2} y1={cy(d.medianA)} x2={x + barWidth/2} y2={cy(d.medianA)} stroke={colorA} strokeWidth={2} />
                  {/* Outliers A */}
                  {d.outliersA.map((out, oi) => (
                    <circle key={`outA-${oi}`} cx={x} cy={cy(out)} r={2} fill="transparent" stroke={colorA} strokeWidth={1} opacity={0.6} />
                  ))}
                </g>
              )}

              {/* Boxplot B */}
              {d.q1B != null && d.q3B != null && d.medianB != null && (
                <g transform={`translate(${offset}, 0)`}>
                  <line x1={x} y1={cy(d.maxB!)} x2={x} y2={cy(d.minB!)} stroke={colorB} strokeWidth={1} opacity={0.5} />
                  <rect x={x - barWidth/2} y={cy(d.q3B)} width={barWidth} height={cy(d.q1B) - cy(d.q3B)} fill={colorB} fillOpacity={0.3} stroke={colorB} strokeWidth={1.5} />
                  <line x1={x - barWidth/2} y1={cy(d.medianB)} x2={x + barWidth/2} y2={cy(d.medianB)} stroke={colorB} strokeWidth={2} />
                  {/* Outliers B */}
                  {d.outliersB.map((out, oi) => (
                    <circle key={`outB-${oi}`} cx={x} cy={cy(out)} r={2} fill="transparent" stroke={colorB} strokeWidth={1} opacity={0.6} />
                  ))}
                </g>
              )}
            </g>
          )
        })}

        {mode === 'confidence' && (
          <g>
            {/* Confidence Band A */}
            {bandA.length > 0 && (
              <polygon points={buildPolygon([...bandA, ...bandA_rev])} fill={colorA} fillOpacity={0.2} />
            )}
            {/* Confidence Band B */}
            {bandB.length > 0 && (
              <polygon points={buildPolygon([...bandB, ...bandB_rev])} fill={colorB} fillOpacity={0.2} />
            )}
            
            {/* Means */}
            {comparativeData.map((d, i) => {
              const x = cx(i)
              return (
                <g key={`mean-${i}`} onMouseEnter={() => setHovered(d.key)} onMouseLeave={() => setHovered(null)}>
                  <rect x={x - groupWidth/2} y={PAD.top} width={groupWidth} height={plotH} fill="transparent" />
                  
                  {d.confA && <circle cx={x} cy={cy(d.confA.mean)} r={3} fill={colorA} />}
                  {d.confB && <circle cx={x} cy={cy(d.confB.mean)} r={3} fill={colorB} />}

                  {/* Significant difference indicator */}
                  {d.isSignificantlyDifferent && (
                    <text x={x} y={PAD.top - 5} textAnchor="middle" className="text-[12px] font-bold fill-destructive">*</text>
                  )}
                </g>
              )
            })}
          </g>
        )}

      </svg>

      {/* Semantic Tooltip */}
      {hovered != null && (() => {
        const d = comparativeData.find(g => g.key === hovered)
        if (!d) return null
        const idx = comparativeData.findIndex(g => g.key === hovered)
        const tipX = Math.min(Math.max(cx(idx), PAD.left), VW - 300)
        
        return (
          <div 
            className="absolute pointer-events-none bg-card border border-border shadow-2xl rounded-xl p-4 z-50 animate-fade-in text-xs w-[280px]"
            style={{ left: `${(tipX / VW) * 100}%`, top: PAD.top }}
          >
            <div className="flex justify-between items-end border-b border-border pb-2 mb-3">
              <span className="font-bold text-sm">{d.key}</span>
              {d.isSignificantlyDifferent && (
                <span className="text-[10px] text-destructive font-bold bg-destructive/10 px-1.5 py-0.5 rounded">Dif. Significativa</span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Panel A */}
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: colorA }} />
                  <span className="font-bold text-[10px] uppercase text-muted-foreground">{labelA}</span>
                </div>
                <div className="space-y-1 font-mono text-[10px]">
                  <div className="flex justify-between"><span className="text-muted-foreground">Med:</span> <span>{d.medianA?.toFixed(1) ?? '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">IQR:</span> <span>{d.q1A != null ? `${d.q1A.toFixed(1)} - ${d.q3A!.toFixed(1)}` : '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">N:</span> <span>{d.countA}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground text-destructive">Out:</span> <span>{d.outliersA.length}</span></div>
                </div>
              </div>

              {/* Panel B */}
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: colorB }} />
                  <span className="font-bold text-[10px] uppercase text-muted-foreground">{labelB}</span>
                </div>
                <div className="space-y-1 font-mono text-[10px]">
                  <div className="flex justify-between"><span className="text-muted-foreground">Med:</span> <span>{d.medianB?.toFixed(1) ?? '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">IQR:</span> <span>{d.q1B != null ? `${d.q1B.toFixed(1)} - ${d.q3B!.toFixed(1)}` : '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">N:</span> <span>{d.countB}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground text-destructive">Out:</span> <span>{d.outliersB.length}</span></div>
                </div>
              </div>
            </div>

            {/* Semantic Interpretation Footer */}
            <div className="pt-3 mt-3 border-t border-border/50">
              <p className="text-xs text-muted-foreground leading-tight">
                {d.isSignificantlyDifferent 
                  ? "Las bandas de confianza no se cruzan: la diferencia del comportamiento central es estadísticamente significativa."
                  : "Las bandas de confianza se solapan: no hay evidencia concluyente de diferencia en las medias."}
              </p>
            </div>
          </div>
        )
      })()}

    </div>
  )
}
