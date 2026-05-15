export interface LineageEvent {
  step: 'crudo' | 'llava' | 'warehouse' | 'clustering' | 'inference' | 'dashboard' | 'snapshot'
  model?: string
  timestamp: string
  description: string
  contextApplied?: string
}

export interface AuditTrailPanelProps {
  datasetVersion: string
  queryHash: string
  lineage: LineageEvent[]
}

/**
 * Audit Trail Panel
 * Visually traces the data provenance from raw camera capture to final statistical inference.
 * Enhances transparency and prevents "black-box" interpretations.
 */
export function AuditTrailPanel({ datasetVersion, queryHash, lineage }: AuditTrailPanelProps) {

  return (
    <div className="bg-card border border-border rounded-xl p-4 shadow-sm font-sans text-foreground">
      <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
        <h3 className="text-sm font-bold flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 8v4l3 3"/></svg>
          Auditoría de Linaje de Datos (Data Lineage)
        </h3>
        <div className="text-xs font-mono text-muted-foreground flex gap-3">
          <span>Dataset: <span className="font-bold text-foreground">{datasetVersion}</span></span>
          <span>Hash: <span className="font-bold text-foreground">{queryHash.substring(0, 8)}</span></span>
        </div>
      </div>

      <div className="relative border-l-2 border-primary/20 ml-3 pl-4 space-y-4">
        {lineage.map((event, idx) => (
          <div key={idx} className="relative">
            {/* Timeline Dot */}
            <div className="absolute -left-[23px] top-1 w-3 h-3 bg-card border-2 border-primary rounded-full" />
            
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider opacity-80">{event.step}</span>
                <span className="text-xs font-mono text-muted-foreground">{event.timestamp}</span>
              </div>
              
              <p className="text-xs text-muted-foreground leading-relaxed">
                {event.description}
              </p>
              
              {(event.model || event.contextApplied) && (
                <div className="flex gap-2 mt-1.5">
                  {event.model && (
                    <span className="bg-secondary/50 border border-border/50 text-xs font-mono px-1.5 py-0.5 rounded text-foreground/80">
                      Engine: {event.model}
                    </span>
                  )}
                  {event.contextApplied && (
                    <span className="bg-primary/10 border border-primary/20 text-xs font-mono px-1.5 py-0.5 rounded text-primary">
                      Ctx: {event.contextApplied}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
