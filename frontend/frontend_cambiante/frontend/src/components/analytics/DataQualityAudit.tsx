import { useMemo } from 'react'
import { auditEngine } from '../../utils/audit/auditEngine'

export interface DataQualityAuditProps {
  data: any[]
  expectedDays: number
  outliersCount?: number
}

/**
 * DataQualityAudit Component
 * Renders visual auditability warnings based on automated dataset checks.
 */
export function DataQualityAudit({ data, expectedDays, outliersCount = 0 }: DataQualityAuditProps) {
  
  const audits = useMemo(() => {
    return auditEngine.runFullAudit(data, expectedDays, outliersCount)
  }, [data, expectedDays, outliersCount])

  if (audits.length === 0) return null

  return (
    <div className="flex flex-col gap-2 my-2">
      {audits.map((a, i) => (
        <div 
          key={i} 
          className={`px-3 py-2 rounded-md border text-[11px] font-mono flex items-start gap-2 ${
            a.issueType === 'critical' ? 'bg-destructive/10 border-destructive/30 text-destructive' :
            'bg-amber-500/10 border-amber-500/30 text-amber-600'
          }`}
        >
          <span className="mt-0.5">⚠</span>
          <span className="leading-snug">{a.message}</span>
        </div>
      ))}
    </div>
  )
}
