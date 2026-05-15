export function calculateRollingAverage(values: number[], windowSize: number): number[] {
  if (values.length === 0 || windowSize <= 1) return [...values]
  
  const result: number[] = []
  
  for (let i = 0; i < values.length; i++) {
    let sum = 0
    let count = 0
    
    // Look back windowSize - 1 steps, plus current step
    for (let j = Math.max(0, i - windowSize + 1); j <= i; j++) {
      sum += values[j]
      count++
    }
    
    result.push(sum / count)
  }
  
  return result
}
