/**
 * Academic Context Timeline Engine
 * Maps temporal datasets into formal academic contexts to enable causal-correlational inference.
 */

export type AcademicContext =
  | 'normal'
  | 'midterms'
  | 'finals'
  | 'projects'
  | 'partial_exams'
  | 'holidays'
  | 'vacation'
  | 'high_load'
  | 'administrative'
  | 'unknown'

export interface AcademicPeriod {
  start: string // YYYY-MM-DD
  end: string   // YYYY-MM-DD
  context: AcademicContext
  description: string
  pressureIndex: number // 0.0 to 1.0
}

// Mocked baseline calendar for IPN / typical academic semester
export const ACADEMIC_CALENDAR_2026: AcademicPeriod[] = [
  { start: '2026-02-01', end: '2026-03-15', context: 'normal', description: 'Inicio de semestre', pressureIndex: 0.2 },
  { start: '2026-03-16', end: '2026-03-30', context: 'partial_exams', description: 'Primer Parcial', pressureIndex: 0.7 },
  { start: '2026-03-31', end: '2026-04-10', context: 'holidays', description: 'Semana Santa', pressureIndex: 0.0 },
  { start: '2026-04-11', end: '2026-05-15', context: 'normal', description: 'Clases Regulares', pressureIndex: 0.4 },
  { start: '2026-05-16', end: '2026-05-30', context: 'midterms', description: 'Segundo Parcial', pressureIndex: 0.8 },
  { start: '2026-06-01', end: '2026-06-15', context: 'projects', description: 'Entrega de Proyectos', pressureIndex: 0.9 },
  { start: '2026-06-16', end: '2026-06-30', context: 'finals', description: 'Exámenes Finales / Extraordinarios', pressureIndex: 1.0 },
]

/**
 * Fast Temporal Indexing for Context Lookup
 * Memoized strategy to avoid linear scans during dataset iterations.
 */
const contextIndexCache = new Map<string, AcademicPeriod>()

export function getAcademicContextForDate(dateStr: string): AcademicPeriod {
  // Normalize string to YYYY-MM-DD
  const isoDate = dateStr.split('T')[0]
  
  if (contextIndexCache.has(isoDate)) {
    return contextIndexCache.get(isoDate)!
  }

  const d = new Date(isoDate)
  const dTime = d.getTime()
  
  // Find matching period
  for (const period of ACADEMIC_CALENDAR_2026) {
    const sTime = new Date(period.start).getTime()
    const eTime = new Date(period.end).getTime()
    if (dTime >= sTime && dTime <= eTime) {
      contextIndexCache.set(isoDate, period)
      return period
    }
  }

  const defaultPeriod: AcademicPeriod = {
    start: isoDate, end: isoDate, context: 'unknown', description: 'Fuera de calendario', pressureIndex: 0.1
  }
  contextIndexCache.set(isoDate, defaultPeriod)
  return defaultPeriod
}

/**
 * Contextual Annotation Engine
 * Injects causal metadata directly into the behavioral temporal bins
 */
export function annotateDatasetWithContext(dataset: any[], timestampKey: string = 'hora'): any[] {
  return dataset.map(item => {
    // If the timestampKey holds a valid ISO date or similar date string
    const contextMeta = getAcademicContextForDate(item[timestampKey] || new Date().toISOString())
    return {
      ...item,
      academicContext: contextMeta.context,
      academicPressure: contextMeta.pressureIndex,
      academicDesc: contextMeta.description
    }
  })
}

/**
 * Isolates two specific periods based purely on contextual labels rather than raw dates.
 */
export function isolateContextualPeriods(dataset: any[], contextA: AcademicContext, contextB: AcademicContext) {
  const annotated = annotateDatasetWithContext(dataset)
  const periodA = annotated.filter(d => d.academicContext === contextA)
  const periodB = annotated.filter(d => d.academicContext === contextB)
  return { periodA, periodB }
}
