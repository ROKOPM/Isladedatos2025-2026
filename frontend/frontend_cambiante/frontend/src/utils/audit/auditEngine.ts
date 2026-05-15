import { GOVERNANCE_RULES } from '../../config/governance'

export interface AuditResult {
  issueType: 'warning' | 'critical' | 'info'
  message: string
}

/**
 * Data Quality Audit Engine
 * Automatically detects gaps, low coverage, downtime, and insufficient sampling
 * to prevent false interpretations. All computations are memoizable.
 */
export const auditEngine = {

  detectLowCoverage(data: any[], expectedDays: number): AuditResult | null {
    if (!data || data.length === 0) return null
    
    // Group by day to find active days
    const activeDays = new Set(data.map(d => {
      const ts = d.hora || d.timestamp
      if (!ts) return null
      return new Date(ts).toISOString().split('T')[0]
    }).filter(Boolean))

    const activeCount = activeDays.size
    
    if (activeCount < expectedDays * 0.5) {
      return {
        issueType: 'critical',
        message: `Baja cobertura temporal: Solo ${activeCount} días tienen datos válidos en el rango seleccionado.`
      }
    } else if (activeCount < expectedDays * 0.8) {
      return {
        issueType: 'warning',
        message: `Cobertura parcial: ${activeCount} días de ${expectedDays} esperados tienen datos.`
      }
    }
    return null
  },

  detectSparseDataset(data: any[]): AuditResult | null {
    if (data.length > 0 && data.length < GOVERNANCE_RULES.MIN_SAMPLE_SIZE) {
      return {
        issueType: 'critical',
        message: `Muestra estadísticamente insuficiente (N=${data.length}). Se requieren al menos ${GOVERNANCE_RULES.MIN_SAMPLE_SIZE} observaciones para inferencia válida.`
      }
    }
    return null
  },

  detectHighOutlierDensity(outliersCount: number, totalN: number): AuditResult | null {
    if (totalN === 0) return null
    const ratio = outliersCount / totalN
    if (ratio > 0.15) { // more than 15% outliers
      return {
        issueType: 'warning',
        message: `Exceso de anomalías conductuales: El ${(ratio * 100).toFixed(1)}% de las observaciones son outliers. Revise la limpieza de sensores.`
      }
    }
    return null
  },

  runFullAudit(data: any[], expectedDays: number, outliersCount: number = 0): AuditResult[] {
    const results: AuditResult[] = []
    
    if (data.length === 0) {
      results.push({ issueType: 'critical', message: 'Dataset completamente vacío en este periodo.' })
      return results
    }

    const sparse = this.detectSparseDataset(data)
    if (sparse) results.push(sparse)

    const coverage = this.detectLowCoverage(data, expectedDays)
    if (coverage) results.push(coverage)

    const out = this.detectHighOutlierDensity(outliersCount, data.length)
    if (out) results.push(out)

    return results
  }
}
