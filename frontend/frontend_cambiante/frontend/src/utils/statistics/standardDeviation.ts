export function calculateMean(values: number[]): number {
  if (values.length === 0) return 0
  const sum = values.reduce((a, b) => a + b, 0)
  return sum / values.length
}

export function calculateStandardDeviation(values: number[], isSample: boolean = true): { mean: number, stdDev: number, variance: number } {
  if (values.length === 0) return { mean: 0, stdDev: 0, variance: 0 }
  if (values.length === 1) return { mean: values[0], stdDev: 0, variance: 0 }
  
  const mean = calculateMean(values)
  const squareDiffs = values.map(value => {
    const diff = value - mean
    return diff * diff
  })
  
  const sumSquareDiffs = squareDiffs.reduce((a, b) => a + b, 0)
  // Divide by (N-1) for sample standard deviation, N for population
  const variance = sumSquareDiffs / (values.length - (isSample ? 1 : 0))
  const stdDev = Math.sqrt(variance)
  
  return { mean, stdDev, variance }
}
