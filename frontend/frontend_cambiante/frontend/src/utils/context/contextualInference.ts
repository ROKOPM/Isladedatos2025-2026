import { runBehavioralHypothesisTest } from '../statistics/inference'
import type { InferenceResult } from '../statistics/inference'
import { detectBehavioralRegimeShifts } from '../statistics/regimeShift'
import type { RegimeShiftResult } from '../statistics/regimeShift'
import { annotateDatasetWithContext } from './academicTimeline'
import type { AcademicContext } from './academicTimeline'

export interface ContextualInferenceResult {
  statisticalInference: InferenceResult
  regimeShift: RegimeShiftResult
  pressureA: number
  pressureB: number
  contextA: AcademicContext
  contextB: AcademicContext
  causalHeuristicWarning: string
  contextualInterpretation: string
}

/**
 * Contextual Inference Engine
 * Converts raw statistical differences into causally-aware behavioral narratives.
 */
export function evaluateContextualInference(
  dataA: any[], 
  dataB: any[], 
  metric: string, 
  timestampKey: string = 'hora'
): ContextualInferenceResult {
  
  const annotatedA = annotateDatasetWithContext(dataA, timestampKey)
  const annotatedB = annotateDatasetWithContext(dataB, timestampKey)

  // Extract raw arrays
  const valsA = annotatedA.map(d => Number(d[metric])).filter(n => !isNaN(n))
  const valsB = annotatedB.map(d => Number(d[metric])).filter(n => !isNaN(n))

  const statResult = runBehavioralHypothesisTest(valsA, valsB)
  const regimeResult = detectBehavioralRegimeShifts(
    annotatedB.map(d => ({ key: String(d[timestampKey]), value: Number(d[metric]) }))
  )

  // Heuristic context extraction: what is the dominant context in these arrays?
  const getDominantContext = (arr: any[]): { ctx: AcademicContext, pressure: number } => {
    if (arr.length === 0) return { ctx: 'unknown', pressure: 0 }
    // Simple approach: pick the most frequent context
    const counts = arr.reduce((acc, curr) => {
      acc[curr.academicContext] = (acc[curr.academicContext] || 0) + 1
      return acc
    }, {} as Record<string, number>)
    
    const dominant = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b) as AcademicContext
    const pressure = arr.find(x => x.academicContext === dominant)?.academicPressure || 0
    return { ctx: dominant, pressure }
  }

  const domA = getDominantContext(annotatedA)
  const domB = getDominantContext(annotatedB)

  // 1. Governance against false causality
  const causalHeuristicWarning = "Advertencia de Gobernanza: La asociación entre periodos académicos y comportamiento es correlacional. Las variaciones pueden estar influenciadas por clima, densidad del campus u otros factores externos no medidos."

  // 2. Generate Contextual Interpretation
  let narrative = ""
  
  if (statResult.isSignificant) {
    if (domB.pressure > domA.pressure) {
      narrative = `El incremento en la presión académica (de '${domA.ctx}' a '${domB.ctx}') coincide temporalmente con un cambio conductual estadísticamente significativo. `
      if (regimeResult.isShiftDetected) {
        narrative += `Además, se detectó un quiebre de régimen estructural, indicando alta inestabilidad durante la zona de estrés (${domB.ctx}).`
      }
    } else if (domB.pressure < domA.pressure) {
      narrative = `La disminución de estrés académico hacia '${domB.ctx}' correlaciona con diferencias conductuales significativas, sugiriendo relajación en los patrones de concentración.`
    } else {
      narrative = `Diferencia conductual detectada bajo condiciones académicas similares ('${domA.ctx}' vs '${domB.ctx}'). Buscar variables exógenas (clima, eventos atípicos).`
    }
  } else {
    narrative = `No hay evidencia estadística para afirmar un cambio de comportamiento poblacional a pesar de la transición temporal. Los hábitos se mantuvieron estables entre '${domA.ctx}' y '${domB.ctx}'.`
  }

  return {
    statisticalInference: statResult,
    regimeShift: regimeResult,
    pressureA: domA.pressure,
    pressureB: domB.pressure,
    contextA: domA.ctx,
    contextB: domB.ctx,
    causalHeuristicWarning,
    contextualInterpretation: narrative
  }
}
