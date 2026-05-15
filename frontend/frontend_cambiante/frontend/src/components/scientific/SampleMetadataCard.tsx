export interface SampleMetadataCardProps {
  sampleSize: number
  dateRange: [string, string]
  timeWindow: [string, string]
  datasetVersion: string
  queryHash: string
  generatedAt: string
}

/**
 * SampleMetadataCard
 * Displays the exact provenance of the sample being analyzed.
 * Ensures every visualization is traceable to its source query.
 */
export function SampleMetadataCard({
  sampleSize,
  dateRange,
  timeWindow,
  datasetVersion,
  queryHash,
  generatedAt
}: SampleMetadataCardProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-4 shadow-sm font-mono text-[10px]">
      <h4 className="font-sans text-xs font-bold text-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
        Metadatos de Muestra
      </h4>

      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-muted-foreground">
        <div className="flex justify-between">
          <span>Tamaño:</span>
          <span className="text-foreground font-bold">N = {sampleSize.toLocaleString()}</span>
        </div>
        <div className="flex justify-between">
          <span>Periodo:</span>
          <span className="text-foreground">{dateRange[0]} → {dateRange[1]}</span>
        </div>
        <div className="flex justify-between">
          <span>Ventana:</span>
          <span className="text-foreground">{timeWindow[0]} → {timeWindow[1]}</span>
        </div>
        <div className="flex justify-between">
          <span>Dataset:</span>
          <span className="text-foreground">{datasetVersion}</span>
        </div>
        <div className="flex justify-between col-span-2">
          <span>Hash:</span>
          <span className="text-foreground truncate ml-2">{queryHash.substring(0, 16)}…</span>
        </div>
        <div className="flex justify-between col-span-2">
          <span>Generado:</span>
          <span className="text-foreground">{new Date(generatedAt).toLocaleString('es-MX')}</span>
        </div>
      </div>
    </div>
  )
}
