export function calculateQuartiles(values: number[]) {
  if (values.length === 0) return { min: 0, q1: 0, median: 0, q3: 0, max: 0, iqr: 0, lowerFence: 0, upperFence: 0, outliers: [] }
  
  const sorted = [...values].sort((a, b) => a - b)
  const min = sorted[0]
  const max = sorted[sorted.length - 1]

  const getPercentile = (p: number) => {
    const index = (sorted.length - 1) * p
    const lower = Math.floor(index)
    const upper = Math.ceil(index)
    const weight = index % 1
    if (lower === upper) return sorted[lower]
    return sorted[lower] * (1 - weight) + sorted[upper] * weight
  }

  const q1 = getPercentile(0.25)
  const median = getPercentile(0.5)
  const q3 = getPercentile(0.75)
  
  const iqr = q3 - q1
  const lowerFence = q1 - 1.5 * iqr
  const upperFence = q3 + 1.5 * iqr

  const outliers = sorted.filter(v => v < lowerFence || v > upperFence)

  return { min, q1, median, q3, max, iqr, lowerFence, upperFence, outliers }
}
