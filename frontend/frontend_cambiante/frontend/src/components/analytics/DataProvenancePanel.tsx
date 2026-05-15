import { SemanticRegistry } from '../../scientific/semanticRegistry'
import type { AcademicContext } from '../../utils/context/academicTimeline'

export interface DataProvenancePanelProps {
  startDate: string
  endDate: string
  timeWindowStart: string
  timeWindowEnd: string
  sampleSize: number
  statisticalMethod: string
  dominantContext: AcademicContext
  activeFilters: string[]
}

/**
 * Data Provenance Layer
 * Always displays the metadata and exact parameters used to generate the current analysis,
 * ensuring strict scientific auditability.
 */
export function DataProvenancePanel({
  startDate,
  endDate,
  timeWindowStart,
  timeWindowEnd,
  sampleSize,
  statisticalMethod,
  dominantContext,
  activeFilters
}: DataProvenancePanelProps) {
  
  return (
    <div className="bg-card border border-border rounded-lg p-4 shadow-sm w-full font-mono text-xs text-muted-foreground">
      <div className="flex items-center justify-between border-b border-border pb-2 mb-3">
        <h4 className="text-xs font-bold text-foreground font-sans uppercase tracking-wider flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          Procedencia de Datos (Data Provenance)
        </h4>
        <span className="bg-secondary px-1.5 py-0.5 rounded text-[9px]">V-1.0</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <span className="block uppercase tracking-wider opacity-70 mb-1">Periodo Evaluado</span>
          <span className="text-foreground font-medium">{startDate} → {endDate}</span>
        </div>
        
        <div>
          <span className="block uppercase tracking-wider opacity-70 mb-1">Ventana Horaria</span>
          <span className="text-foreground font-medium">{timeWindowStart} → {timeWindowEnd}</span>
        </div>
        
        <div>
          <span className="block uppercase tracking-wider opacity-70 mb-1">Muestra Activa</span>
          <span className="text-foreground font-bold">N = {sampleSize.toLocaleString()}</span> observaciones
        </div>
        
        <div>
          <span className="block uppercase tracking-wider opacity-70 mb-1">Método Estadístico</span>
          <span className="text-foreground">{statisticalMethod}</span>
        </div>
        
        <div>
          <span className="block uppercase tracking-wider opacity-70 mb-1">Contexto Dominante</span>
          <span className="text-foreground">{dominantContext}</span>
        </div>
        
        <div className="col-span-2 md:col-span-3">
          <span className="block uppercase tracking-wider opacity-70 mb-1">Filtros Espaciales</span>
          <span className="text-foreground truncate block">
            {activeFilters.length > 0 ? activeFilters.join(' | ') : 'Global (Sin Filtros Específicos)'}
          </span>
        </div>
      </div>
      
      <div className="mt-4 pt-2 border-t border-border/50 flex items-start gap-2">
        <span className="text-primary mt-0.5">ℹ</span>
        <span className="leading-relaxed opacity-80 max-w-[800px]">
          {SemanticRegistry.governance.causality}
        </span>
      </div>
    </div>
  )
}
