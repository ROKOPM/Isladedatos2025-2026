import { useMemo } from 'react'
import { Filter, Loader2, AlertTriangle, Info } from 'lucide-react'

interface ClusterData {
  etiqueta: string
  tasa: number
  total: number
  fumando: number
}

interface Props {
  tasasFumado: ClusterData[]
  isLoading: boolean
}

function getRiskLevel(tasa: number) {
  if (tasa >= 15) return { label: 'Alto', color: 'text-destructive', barColor: 'hsl(var(--tobacco))', icon: AlertTriangle }
  if (tasa >= 5)  return { label: 'Moderado', color: 'text-warning', barColor: 'hsl(var(--warning))', icon: Info }
  return { label: 'Bajo', color: 'text-success', barColor: 'hsl(var(--success))', icon: Info }
}

export function ClusterIntelligencePanel({ tasasFumado, isLoading }: Props) {
  const { data, totalObs, maxTasa } = useMemo(() => {
    const sorted = [...tasasFumado].sort((a, b) => b.tasa - a.tasa)
    const total = sorted.reduce((s, r) => s + r.total, 0)
    const max = sorted.reduce((m, r) => Math.max(m, r.tasa), 0) || 1
    return { data: sorted, totalObs: total, maxTasa: max }
  }, [tasasFumado])

  return (
    <div className="sci-panel">
      <div className="sci-panel-header flex-col items-start gap-1">
        <h3 className="font-editorial text-base font-bold flex items-center gap-2 text-foreground">
          <Filter className="w-4 h-4 text-tobacco" />
          Inteligencia de Clusters — Tasa de Fumado por Categoría
        </h3>
        <p className="text-xs font-instrument text-muted-foreground">
          Porcentaje de observaciones con fumado detectado dentro de cada categoría semántica de comportamiento.
          Rojo ≥ 15% · Naranja ≥ 5% · Verde &lt; 5%.
        </p>
      </div>
      <div className="p-4">
        {isLoading ? (
          <div className="py-6 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Sin datos para el período seleccionado</p>
        ) : (
          <div className="space-y-2">
            {/* Column headers */}
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 text-[9px] font-instrument text-muted-foreground uppercase tracking-wider pb-1 border-b border-border/50">
              <span>Categoría</span>
              <span className="text-right">% Dataset</span>
              <span className="text-right">Fumado</span>
              <span className="text-right">Riesgo</span>
            </div>

            {data.map((r, i) => {
              const risk = getRiskLevel(r.tasa)
              const pctDataset = totalObs > 0 ? ((r.total / totalObs) * 100).toFixed(1) : '—'
              const RiskIcon = risk.icon
              return (
                <div key={i} className="group">
                  <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 items-center text-xs py-1">
                    <span className="font-medium leading-snug text-foreground truncate" title={r.etiqueta}>{r.etiqueta}</span>
                    <span className="font-mono text-muted-foreground text-right shrink-0">{pctDataset}%</span>
                    <span className={`font-mono font-bold text-right shrink-0 ${risk.color}`}>
                      {r.tasa.toFixed(1)}%
                    </span>
                    <div className={`flex items-center justify-end gap-1 shrink-0 ${risk.color}`}>
                      <RiskIcon className="w-3 h-3" />
                      <span className="text-[10px] font-instrument">{risk.label}</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-secondary/50 rounded overflow-hidden mb-1">
                    <div
                      className="h-full rounded transition-all duration-500"
                      style={{
                        width: `${(r.tasa / maxTasa) * 100}%`,
                        backgroundColor: risk.barColor,
                        opacity: 0.8,
                      }}
                    />
                  </div>
                  <div className="text-[9px] font-instrument text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity pb-1">
                    {r.fumando} observaciones con fumado de {r.total} totales en esta categoría
                  </div>
                </div>
              )
            })}

            <div className="pt-3 border-t border-border flex items-start gap-2">
              <Info className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground font-instrument leading-relaxed">
                Categorías con tasa ≥ 15% (rojo) representan clústers de alto riesgo correlacional.
                "% Dataset" indica la proporción que cada categoría representa del total de observaciones (N={totalObs.toLocaleString('es-MX')}).
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
