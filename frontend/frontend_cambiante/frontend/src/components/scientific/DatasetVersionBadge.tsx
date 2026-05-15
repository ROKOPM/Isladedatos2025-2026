export interface DatasetVersionBadgeProps {
  version: string
  pipelineVersion?: string
  inferenceVersion?: string
}

/**
 * DatasetVersionBadge
 * Small persistent badge that pins every visualization to an immutable dataset version.
 */
export function DatasetVersionBadge({
  version,
  pipelineVersion: _pipelineVersion = '1.0',
  inferenceVersion: _inferenceVersion = '1.0'
}: DatasetVersionBadgeProps) {
  return (
    <div className="inline-flex items-center gap-2 bg-secondary/40 border border-border/50 rounded-md px-2.5 py-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
        Dataset <span className="text-foreground font-medium">{version}</span>
      </span>
    </div>
  )
}
