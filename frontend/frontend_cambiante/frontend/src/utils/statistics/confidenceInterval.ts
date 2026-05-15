import { calculateStandardDeviation } from './standardDeviation'

// Z-scores for common confidence levels
const Z_SCORES = {
  90: 1.645,
  95: 1.960,
  99: 2.576
}

export function calculateConfidenceInterval(
  values: number[], 
  confidenceLevel: 90 | 95 | 99 = 95
) {
  if (values.length < 2) return { lower: 0, upper: 0, marginOfError: 0, mean: values[0] || 0 }
  
  const { mean, stdDev } = calculateStandardDeviation(values)
  const z = Z_SCORES[confidenceLevel]
  
  // Standard Error of the Mean = std / sqrt(n)
  const standardError = stdDev / Math.sqrt(values.length)
  const marginOfError = z * standardError
  
  return {
    mean,
    lower: mean - marginOfError,
    upper: mean + marginOfError,
    marginOfError,
    standardError
  }
}
