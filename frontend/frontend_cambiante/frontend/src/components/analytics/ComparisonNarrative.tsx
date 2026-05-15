import { useMemo } from 'react'
import { SemanticRegistry } from '../../scientific/semanticRegistry'
import type { AcademicContext } from '../../utils/context/academicTimeline'
import type { InferenceResult } from '../../utils/statistics/inference'

export interface ComparisonNarrativeProps {
  inference: InferenceResult
  contextA: AcademicContext
  contextB: AcademicContext
  varianceDelta: number // ratio (varianceB / varianceA)
  outliersA: number
  outliersB: number
}

/**
 * Comparative Scientific Narratives
 * Generates deterministic, rule-based scientific explanations.
 * NO generative AI is used here to maintain strict reproducibility and auditability.
 */
export function ComparisonNarrative({
  inference,
  contextA,
  contextB,
  varianceDelta,
  outliersA,
  outliersB
}: ComparisonNarrativeProps) {
  
  const narrative = useMemo(() => {
    const blocks: string[] = []

    // 1. Context Transition
    const ctxTransition = contextA === contextB 
      ? `Durante condiciones ambientales constantes ('${contextA}'):`
      : `En la transición de '${contextA}' hacia '${contextB}':`
    blocks.push(ctxTransition)

    // 2. Statistical Evidence & Effect Size
    if (!inference.isSignificant) {
      blocks.push(`La muestra no presenta evidencia estadística suficiente (p ≥ 0.05) para afirmar una divergencia poblacional. El comportamiento se mantuvo analíticamente estable.`)
    } else {
      const effectAbs = Math.abs(inference.effectSize || 0)
      let effectText = 'marginal'
      if (effectAbs > 0.47) effectText = 'masivo'
      else if (effectAbs > 0.33) effectText = 'moderado'
      else if (effectAbs > 0.15) effectText = 'ligero'

      blocks.push(`Se detectó una divergencia conductual estadísticamente significativa con un tamaño de efecto ${effectText} (|delta| = ${effectAbs.toFixed(2)}).`)
    }

    // 3. Behavioral Dispersion (Variance)
    if (varianceDelta > 1.4) {
      blocks.push(`Se observó un incremento notable (+${Math.round((varianceDelta-1)*100)}%) en la dispersión conductual, indicando una pérdida de estabilidad en los patrones de ocupación temporal.`)
    } else if (varianceDelta < 0.7) {
      blocks.push(`La dispersión conductual se redujo, lo que sugiere observaciones poblacionales más concentradas en el segundo periodo.`)
    }

    // 4. Anomaly Concentration
    if (outliersB > outliersA * 1.5 && outliersB > 5) {
      blocks.push(`La concentración de eventos anómalos (outliers) se multiplicó en el periodo objetivo, señalando picos conductuales atípicos.`)
    }

    return blocks
  }, [inference, contextA, contextB, varianceDelta, outliersA, outliersB])

  return (
    <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 shadow-sm text-xs text-foreground/90 leading-relaxed font-sans">
      <div className="flex items-center gap-2 mb-2 pb-2 border-b border-border/50">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
        <h4 className="font-bold text-primary tracking-wide">Síntesis Analítica Determinística</h4>
      </div>
      
      <p className="mb-3 space-y-1">
        {narrative.map((text, idx) => (
          <span key={idx} className="block">{text}</span>
        ))}
      </p>

      <p className="text-xs text-muted-foreground font-mono mt-3 pt-2 border-t border-border/30">
        * {SemanticRegistry.governance.causality}
      </p>
    </div>
  )
}
