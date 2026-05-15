export interface StatisticalContextCardProps {
  statisticalMethod: string
  confidenceLevel: number
  inferenceVersion: string
  academicContext: string
}

/**
 * StatisticalContextCard
 * Displays the statistical methodology context for the current analysis.
 * Ensures every inferential result is scientifically transparent.
 */
export function StatisticalContextCard({
  statisticalMethod,
  confidenceLevel,
  inferenceVersion,
  academicContext,
}: StatisticalContextCardProps) {
  const contextLabels: Record<string, string> = {
    normal: 'Periodo regular',
    midterms: 'Segundo parcial',
    finals: 'Exámenes finales / extraordinarios',
    projects: 'Entrega de proyectos',
    partial_exams: 'Primer parcial',
    holidays: 'Vacaciones / Semana Santa',
    vacation: 'Periodo vacacional',
    high_load: 'Carga académica alta',
    unknown: 'Sin clasificar'
  }

  return (
    <div className="bg-card border border-border rounded-lg p-4 shadow-sm text-xs">
      <h4 className="font-bold text-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
        Contexto Estadístico
      </h4>

      <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 font-mono text-xs text-muted-foreground">
        <div className="flex justify-between">
          <span>Método:</span>
          <span className="text-foreground">{statisticalMethod}</span>
        </div>
        <div className="flex justify-between">
          <span>Confianza:</span>
          <span className="text-foreground">{(confidenceLevel * 100).toFixed(0)}%</span>
        </div>
        <div className="flex justify-between">
          <span>Motor:</span>
          <span className="text-foreground">v{inferenceVersion}</span>
        </div>
        <div className="flex justify-between">
          <span>Contexto:</span>
          <span className="text-foreground">{contextLabels[academicContext] || academicContext}</span>
        </div>
      </div>

    </div>
  )
}
