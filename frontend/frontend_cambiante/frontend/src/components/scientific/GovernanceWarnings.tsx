import { Ban, TriangleAlert, Info } from 'lucide-react'

export interface GovernanceWarning {
  level: 'info' | 'warning' | 'critical'
  message: string
}

export interface GovernanceWarningsProps {
  warnings: GovernanceWarning[]
}

/**
 * GovernanceWarnings
 * Renders automated scientific governance warnings.
 * Prevents false interpretations by surfacing methodological concerns.
 */
export function GovernanceWarnings({ warnings }: GovernanceWarningsProps) {
  if (warnings.length === 0) return null

  return (
    <div className="space-y-2">
      {warnings.map((w, i) => (
        <div
          key={i}
          className={`flex items-start gap-2.5 px-3 py-2.5 rounded-md border text-xs leading-relaxed font-sans ${
            w.level === 'critical'
              ? 'bg-destructive/10 border-destructive/30 text-destructive'
              : w.level === 'warning'
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400'
              : 'bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-400'
          }`}
        >
          <span className="mt-0.5 shrink-0">
            {w.level === 'critical' ? <Ban className="w-4 h-4" /> : w.level === 'warning' ? <TriangleAlert className="w-4 h-4" /> : <Info className="w-4 h-4" />}
          </span>
          <span>{w.message}</span>
        </div>
      ))}
    </div>
  )
}

/** Helper to convert backend warning strings into typed GovernanceWarning objects */
export function parseBackendWarnings(rawWarnings: string[]): GovernanceWarning[] {
  return rawWarnings.map(msg => {
    let level: GovernanceWarning['level'] = 'info'
    if (msg.includes('insuficiente') || msg.includes('bloqueada')) level = 'critical'
    else if (msg.includes('limitada') || msg.includes('dispersa') || msg.includes('presión')) level = 'warning'
    return { level, message: msg }
  })
}
