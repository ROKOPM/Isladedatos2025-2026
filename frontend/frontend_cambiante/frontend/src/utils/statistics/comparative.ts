import { calculateQuartiles } from './quartiles'
import { calculateConfidenceInterval } from './confidenceInterval'

export interface ComparativeGroup {
  key: string
  countA: number
  countB: number
  medianA: number | null
  medianB: number | null
  q1A: number | null
  q3A: number | null
  minA: number | null
  maxA: number | null
  q1B: number | null
  q3B: number | null
  minB: number | null
  maxB: number | null
  confA: { lower: number, upper: number, mean: number } | null
  confB: { lower: number, upper: number, mean: number } | null
  outliersA: number[]
  outliersB: number[]
  isSignificantlyDifferent: boolean
  varianceA: number | null
  varianceB: number | null
}

function computeVariance(arr: number[], mean: number): number {
  if (arr.length <= 1) return 0
  const sqDiffs = arr.map(x => Math.pow(x - mean, 2))
  return sqDiffs.reduce((a, b) => a + b, 0) / (arr.length - 1)
}

export function buildComparativeDataset(
  dataA: any[],
  dataB: any[],
  metric: string,
  timestampKey: string = 'hora'
): ComparativeGroup[] {
  // Group A
  const groupsA: Record<string, number[]> = {}
  dataA.forEach(item => {
    const key = String(item[timestampKey] || 'Unknown')
    const val = Number(item[metric])
    if (isNaN(val)) return
    if (!groupsA[key]) groupsA[key] = []
    groupsA[key].push(val)
  })

  // Group B
  const groupsB: Record<string, number[]> = {}
  dataB.forEach(item => {
    const key = String(item[timestampKey] || 'Unknown')
    const val = Number(item[metric])
    if (isNaN(val)) return
    if (!groupsB[key]) groupsB[key] = []
    groupsB[key].push(val)
  })

  // Collect all keys
  const allKeys = Array.from(new Set([...Object.keys(groupsA), ...Object.keys(groupsB)])).sort()

  const comparativeDataset = allKeys.map(key => {
    const valuesA = groupsA[key] || []
    const valuesB = groupsB[key] || []

    const statsA = valuesA.length > 0 ? calculateQuartiles(valuesA) : null
    const statsB = valuesB.length > 0 ? calculateQuartiles(valuesB) : null

    const confA = valuesA.length > 0 ? calculateConfidenceInterval(valuesA, 95) : null
    const confB = valuesB.length > 0 ? calculateConfidenceInterval(valuesB, 95) : null

    let isSignificantlyDifferent = false
    if (confA && confB) {
      // If intervals do not overlap, it is a significant difference
      isSignificantlyDifferent = confA.upper < confB.lower || confB.upper < confA.lower
    }

    return {
      key,
      countA: valuesA.length,
      countB: valuesB.length,
      medianA: statsA?.median ?? null,
      medianB: statsB?.median ?? null,
      q1A: statsA?.q1 ?? null,
      q3A: statsA?.q3 ?? null,
      minA: statsA?.min ?? null,
      maxA: statsA?.max ?? null,
      q1B: statsB?.q1 ?? null,
      q3B: statsB?.q3 ?? null,
      minB: statsB?.min ?? null,
      maxB: statsB?.max ?? null,
      confA,
      confB,
      outliersA: statsA?.outliers ?? [],
      outliersB: statsB?.outliers ?? [],
      isSignificantlyDifferent,
      varianceA: confA ? computeVariance(valuesA, confA.mean) : null,
      varianceB: confB ? computeVariance(valuesB, confB.mean) : null
    }
  })

  return comparativeDataset
}
