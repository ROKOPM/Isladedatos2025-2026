/**
 * Temporal Regime Shift Engine
 * Detects structural changes, rolling variance, and distribution drift over time.
 */

export interface RegimePoint {
  index: number
  key: string
  variance: number
  mean: number
}

export interface RegimeShiftResult {
  isShiftDetected: boolean
  shiftIndex: number | null
  shiftKey: string | null
  preShiftVariance: number | null
  postShiftVariance: number | null
  interpretation: string
}

/**
 * Calculates a moving variance/mean over a sliding window
 */
export function calculateRollingStats(data: {key: string, value: number}[], windowSize: number = 3): RegimePoint[] {
  if (data.length < windowSize) return []
  
  const results: RegimePoint[] = []
  
  for (let i = windowSize - 1; i < data.length; i++) {
    const window = data.slice(i - windowSize + 1, i + 1).map(d => d.value)
    const mean = window.reduce((a, b) => a + b, 0) / windowSize
    const variance = window.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (windowSize - 1 || 1)
    
    results.push({
      index: i,
      key: data[i].key,
      mean,
      variance
    })
  }
  
  return results
}

/**
 * Detects abrupt structural shifts in temporal behavioral variance.
 * Simple algorithm based on significant variance jumps.
 */
export function detectBehavioralRegimeShifts(temporalData: {key: string, value: number}[]): RegimeShiftResult {
  const minPoints = 10
  if (temporalData.length < minPoints) {
    return {
      isShiftDetected: false, shiftIndex: null, shiftKey: null,
      preShiftVariance: null, postShiftVariance: null,
      interpretation: "Datos insuficientes para detectar cambios de régimen estructural."
    }
  }

  // Calculate rolling variance (window = 4)
  const rolling = calculateRollingStats(temporalData, 4)
  
  let maxJumpRatio = 0
  let shiftIndex = -1
  
  // Find largest relative jump in variance between consecutive rolling windows
  for (let i = 1; i < rolling.length - 1; i++) {
    const pre = rolling[i - 1].variance
    const post = rolling[i].variance
    
    // Protect against zero division
    if (pre > 0.01) {
      const ratio = post / pre
      if (ratio > maxJumpRatio) {
        maxJumpRatio = ratio
        shiftIndex = rolling[i].index
      }
    }
  }

  // Heuristic: Variance increases by more than 2.5x abruptly is considered a regime shift
  const isShiftDetected = maxJumpRatio > 2.5 && shiftIndex !== -1

  let interpretation = "El comportamiento se mantiene en un régimen temporalmente estable."
  if (isShiftDetected) {
    interpretation = `Cambio de régimen estructural detectado cerca de [${temporalData[shiftIndex].key}]. La inestabilidad conductual se multiplicó drásticamente.`
  }

  return {
    isShiftDetected,
    shiftIndex: isShiftDetected ? shiftIndex : null,
    shiftKey: isShiftDetected ? temporalData[shiftIndex].key : null,
    preShiftVariance: isShiftDetected ? rolling.find(r => r.index === shiftIndex - 1)?.variance ?? null : null,
    postShiftVariance: isShiftDetected ? rolling.find(r => r.index === shiftIndex)?.variance ?? null : null,
    interpretation
  }
}
