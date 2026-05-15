import { useMemo } from 'react'
import { getAcademicContextForDate } from '../../utils/context/academicTimeline'
import type { AcademicPeriod } from '../../utils/context/academicTimeline'

export interface AcademicContextOverlayProps {
  data: any[]
  timestampKey?: string
  width: number
  height: number
  cx: (idx: number) => number
}

/**
 * AcademicContextOverlay
 * Renders semantic contextual regions behind temporal behavioral charts.
 * Ex: shaded areas for 'midterms', 'vacations', etc.
 */
export function AcademicContextOverlay({
  data,
  timestampKey = 'hora',
  width: _width,
  height,
  cx
}: AcademicContextOverlayProps) {
  
  const regions = useMemo(() => {
    const blocks: { xStart: number; xEnd: number; period: AcademicPeriod }[] = []
    
    if (data.length === 0) return blocks

    let currentPeriod = getAcademicContextForDate(String(data[0][timestampKey] || ''))
    let currentStartX = cx(0)
    
    for (let i = 1; i < data.length; i++) {
      const p = getAcademicContextForDate(String(data[i][timestampKey] || ''))
      if (p.context !== currentPeriod.context) {
        // Close previous block
        const prevEndX = cx(i - 1)
        blocks.push({ xStart: currentStartX, xEnd: prevEndX + (cx(i) - cx(i-1))/2, period: currentPeriod })
        
        // Start new block
        currentPeriod = p
        currentStartX = cx(i) - (cx(i) - cx(i-1))/2
      }
    }
    
    // Close final block
    blocks.push({ xStart: currentStartX, xEnd: cx(data.length - 1) + 20, period: currentPeriod })
    
    return blocks
  }, [data, timestampKey, cx])

  const getContextColor = (context: string) => {
    switch (context) {
      case 'exams':
      case 'finals':
      case 'midterms':
      case 'partial_exams':
        return 'rgba(239, 68, 68, 0.08)' // Red-ish for high stress
      case 'projects':
        return 'rgba(245, 158, 11, 0.08)' // Amber for moderate stress
      case 'holidays':
      case 'vacation':
        return 'rgba(59, 130, 246, 0.08)' // Blue for low stress / absent
      default:
        return 'transparent'
    }
  }

  return (
    <g className="academic-context-overlay">
      {regions.map((region, idx) => {
        if (region.period.context === 'normal' || region.period.context === 'unknown') return null
        
        return (
          <g key={`ctx-${idx}`}>
            <rect
              x={region.xStart}
              y={0}
              width={Math.max(region.xEnd - region.xStart, 1)}
              height={height}
              fill={getContextColor(region.period.context)}
            />
            {/* Optional label at the top */}
            {region.xEnd - region.xStart > 50 && (
              <text
                x={region.xStart + 5}
                y={15}
                className="text-[9px] fill-muted-foreground/60 font-mono uppercase"
              >
                {region.period.context}
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
}
