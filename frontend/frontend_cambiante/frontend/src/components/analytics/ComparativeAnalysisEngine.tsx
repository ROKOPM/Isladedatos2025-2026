import { useState, useMemo } from 'react'
import { ComparisonOverlay } from './ComparisonOverlay'
import type { ComparisonMode } from './ComparisonOverlay'
import { ComparisonNarrative } from './ComparisonNarrative'
import { DataProvenancePanel } from './DataProvenancePanel'
import { DataQualityAudit } from './DataQualityAudit'
import { buildComparativeDataset } from '../../utils/statistics/comparative'
import { evaluateContextualInference } from '../../utils/context/contextualInference'

export interface ComparativeAnalysisEngineProps {
  dataA: any[]
  dataB: any[]
  metric: string
  timestampKey?: string
  labelA?: string
  labelB?: string
  isLoading?: boolean
}

export function ComparativeAnalysisEngine({
  dataA,
  dataB,
  metric,
  timestampKey = 'hora',
  labelA = 'Periodo A',
  labelB = 'Periodo B',
  isLoading = false
}: ComparativeAnalysisEngineProps) {
  const [mode, setMode] = useState<ComparisonMode>('distribution')

  const comparativeData = useMemo(() => {
    return buildComparativeDataset(dataA, dataB, metric, timestampKey)
  }, [dataA, dataB, metric, timestampKey])

  const contextualAnalysis = useMemo(() => {
    return evaluateContextualInference(dataA, dataB, metric, timestampKey)
  }, [dataA, dataB, metric, timestampKey])

  const inference = contextualAnalysis.statisticalInference

  if (isLoading) {
    return (
      <div className="flex flex-col space-y-4">
        <div className="h-[350px] w-full bg-secondary/30 animate-pulse rounded-xl border border-border"></div>
        <div className="h-24 w-full bg-secondary/30 animate-pulse rounded-xl border border-border"></div>
      </div>
    )
  }

  return (
    <div className="space-y-4 flex flex-col">
      {/* Governance & Rendering Controls */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h2 className="text-lg font-bold">Motor de Inferencia Comparativa</h2>
          <p className="text-xs text-muted-foreground">Validación de hipótesis y estabilidad conductual.</p>
        </div>

        {/* Mode Selector */}
        <div className="flex items-center gap-1 bg-secondary/30 p-1 rounded-lg border border-border/50 overflow-x-auto max-w-full">
          {(['distribution', 'confidence'] as ComparisonMode[]).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap ${
                mode === m
                  ? 'bg-background shadow-sm text-foreground border border-border'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {m === 'distribution' ? 'Distribución (IQR)' : 'Bandas Confianza (95%)'}
            </button>
          ))}
        </div>
      </div>

      {/* Main Overlay Chart */}
      <div className="border border-border rounded-xl bg-card p-4 relative shadow-sm">
        {/* Legend */}
        <div className="absolute top-4 right-4 flex items-center gap-4 text-[10px] font-mono z-10 bg-card/80 p-1.5 rounded-lg border border-border/50 backdrop-blur-sm">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm bg-[#3b82f6] opacity-80" />
            <span>{labelA}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm bg-[#f59e0b] opacity-80" />
            <span>{labelB}</span>
          </div>
        </div>

        <ComparisonOverlay
          dataA={dataA}
          dataB={dataB}
          metric={metric}
          timestampKey={timestampKey}
          mode={mode}
          height={300}
          labelA={labelA}
          labelB={labelB}
        />
      </div>

      {/* Formal Statistical Validation Panel */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Hypothesis Testing Summary */}
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <h3 className="text-sm font-bold text-foreground">Validación de Hipótesis Global</h3>
            <span className="text-xs font-mono text-muted-foreground uppercase">{inference.testUsed}</span>
          </div>
          
          <div className="grid grid-cols-2 gap-3 text-xs font-mono">
            <div className="bg-secondary/20 p-2 rounded border border-border/50">
              <span className="text-muted-foreground block mb-1">P-Value</span>
              <span className={`text-sm font-bold ${inference.isSignificant ? 'text-destructive' : 'text-primary'}`}>
                {inference.pValue != null ? (inference.pValue < 0.001 ? '< 0.001' : inference.pValue.toFixed(3)) : '—'}
              </span>
            </div>
            <div className="bg-secondary/20 p-2 rounded border border-border/50">
              <span className="text-muted-foreground block mb-1">Effect Size ({inference.effectSizeMetric})</span>
              <span className="text-sm font-bold">{inference.effectSize != null ? Math.abs(inference.effectSize).toFixed(2) : '—'}</span>
            </div>
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed mt-1">
            <strong className="text-foreground">Interpretación Estadística: </strong>
            {inference.interpretation}
          </p>
          
          {inference.warning && (
            <p className="text-[10px] text-amber-600 bg-amber-500/10 p-1.5 rounded">{inference.warning}</p>
          )}
        </div>

        {/* Comparison Narrative */}
        <ComparisonNarrative
          inference={inference}
          contextA={contextualAnalysis.contextA}
          contextB={contextualAnalysis.contextB}
          varianceDelta={
            (comparativeData[0]?.varianceB ?? 1) / (comparativeData[0]?.varianceA ?? 1) || 1
          }
          outliersA={comparativeData.reduce((acc, curr) => acc + curr.outliersA.length, 0)}
          outliersB={comparativeData.reduce((acc, curr) => acc + curr.outliersB.length, 0)}
        />
      </div>

      {/* Data Provenance & Audit Layer */}
      <div className="grid grid-cols-1 gap-4">
        <DataQualityAudit 
          data={dataB} 
          expectedDays={15} 
          outliersCount={comparativeData.reduce((acc, curr) => acc + curr.outliersB.length, 0)} 
        />
        <DataProvenancePanel 
          startDate="Automático"
          endDate="Automático"
          timeWindowStart="08:00"
          timeWindowEnd="20:00"
          sampleSize={dataB.length}
          statisticalMethod={inference.testUsed}
          dominantContext={contextualAnalysis.contextB}
          activeFilters={[]}
        />
      </div>

    </div>
  )
}
