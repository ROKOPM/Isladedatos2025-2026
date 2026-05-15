import { useMemo } from 'react'
import type { ComparativeGroup } from '../../utils/statistics/comparative'

export interface ComparisonSummaryProps {
  comparativeData: ComparativeGroup[]
  labelA?: string
  labelB?: string
}

export function ComparisonSummary({
  comparativeData,
  labelA = 'Periodo A',
  labelB = 'Periodo B'
}: ComparisonSummaryProps) {
  
  const semanticSummaries = useMemo(() => {
    if (!comparativeData || comparativeData.length === 0) return []

    const summaries: { text: string; type: 'info' | 'warning' | 'success' | 'danger' }[] = []

    // 1. Significant differences overall
    const significantCount = comparativeData.filter(d => d.isSignificantlyDifferent).length
    const sigPct = significantCount / comparativeData.length
    
    if (sigPct > 0.5) {
      summaries.push({
        text: `Existe una diferencia conductual generalizada. El ${Math.round(sigPct * 100)}% de los intervalos temporales muestran diferencias estadísticamente significativas entre ${labelA} y ${labelB}.`,
        type: 'warning'
      })
    } else if (significantCount > 0) {
      summaries.push({
        text: `Comportamiento mayormente estable, pero se detectaron diferencias significativas en ${significantCount} franjas temporales.`,
        type: 'info'
      })
    } else {
      summaries.push({
        text: `No hay evidencia estadística de diferencias significativas en las medias conductuales entre ${labelA} y ${labelB}.`,
        type: 'success'
      })
    }

    // 2. Outlier density comparison
    let totalOutliersA = 0
    let totalOutliersB = 0
    comparativeData.forEach(d => {
      totalOutliersA += d.outliersA.length
      totalOutliersB += d.outliersB.length
    })

    if (totalOutliersB > totalOutliersA * 1.5 && totalOutliersA > 0) {
      const ratio = (totalOutliersB / totalOutliersA).toFixed(1)
      summaries.push({
        text: `Anomalías conductuales críticas: ${labelB} contiene ${ratio}x más eventos extremos (outliers) que ${labelA}. El comportamiento es más inestable.`,
        type: 'danger'
      })
    } else if (totalOutliersA > totalOutliersB * 1.5 && totalOutliersB > 0) {
      const ratio = (totalOutliersA / totalOutliersB).toFixed(1)
      summaries.push({
        text: `Anomalías conductuales críticas: ${labelA} contuvo ${ratio}x más eventos extremos (outliers) que ${labelB}.`,
        type: 'info'
      })
    }

    // 3. Variance and Behavioral Stability
    let varA = 0, varB = 0, validVars = 0
    comparativeData.forEach(d => {
      if (d.varianceA != null && d.varianceB != null) {
        varA += d.varianceA
        varB += d.varianceB
        validVars++
      }
    })

    if (validVars > 0) {
      const meanVarA = varA / validVars
      const meanVarB = varB / validVars
      if (meanVarB > meanVarA * 1.3) {
        summaries.push({
          text: `La variabilidad (dispersión) de las observaciones aumentó notablemente en ${labelB}. Esto indica menor estabilidad en los patrones de ocupación o actividad.`,
          type: 'warning'
        })
      } else if (meanVarA > meanVarB * 1.3) {
        summaries.push({
          text: `La variabilidad disminuyó en ${labelB}. Las observaciones aparecen más concentradas que en ${labelA}.`,
          type: 'success'
        })
      }
    }

    return summaries
  }, [comparativeData, labelA, labelB])

  if (semanticSummaries.length === 0) return null

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3 shadow-sm animate-fade-in">
      <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>
        Interpretación Científica Comparativa
      </h3>
      <ul className="space-y-2">
        {semanticSummaries.map((s, i) => (
          <li key={i} className="text-xs flex items-start gap-2 leading-relaxed">
            <span className={`mt-0.5 w-2 h-2 shrink-0 rounded-full ${
              s.type === 'danger' ? 'bg-destructive' :
              s.type === 'warning' ? 'bg-amber-500' :
              s.type === 'success' ? 'bg-green-500' :
              'bg-blue-500'
            }`} />
            <span className={s.type === 'danger' ? 'text-destructive/90 font-medium' : 'text-muted-foreground'}>
              {s.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
