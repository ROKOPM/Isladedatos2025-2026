export interface ScientificSnapshot {
  id: string
  createdAt: string
  name: string
  description?: string

  filters: {
    dateRange: [string, string]
    hourRange: [string, string]
    campus?: string
    camera?: string
  }

  aggregationMode: 'auto' | 'manual'
  visualizationMode: string
  comparison?: {
    enabled: boolean
    periodA: [string, string]
    periodB: [string, string]
  }

  sampleSize: number
  academicContext: string
  activeMetrics: string[]

  inferenceMetadata: {
    engineVersion: string
    statisticalMethod: string
    isSignificant: boolean
    effectSize: number | null
  }
}
