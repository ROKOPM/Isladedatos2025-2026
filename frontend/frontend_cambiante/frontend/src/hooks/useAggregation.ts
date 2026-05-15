import { useMemo } from 'react'
import type { IntervaloValue, GlobalFilters } from '@/types'

export type TemporalGranularity = 'hour' | 'day' | 'week' | 'month'

export interface AggregationResult {
  mode: 'detail' | 'overlay' | 'boxplot' | 'trend'
  granularity: TemporalGranularity
  recommendedChart: 'line' | 'boxplot' | 'overlay' | 'trend'
}

export function useAggregation(intervalo: IntervaloValue, filters?: GlobalFilters): AggregationResult {
  return useMemo(() => {
    // If a specific date range is set via filters.desde and filters.hasta,
    // we can calculate the exact days. For now, we estimate based on the interval string
    // or date strings if available.
    let days = 15 // default
    
    if (filters?.desde && filters?.hasta) {
      const start = new Date(filters.desde).getTime()
      const end = new Date(filters.hasta).getTime()
      days = Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)))
    } else {
      switch (intervalo) {
        case '1 day': days = 1; break
        case '7 days': days = 7; break
        case '15 days': days = 15; break
        case '30 days': days = 30; break
        case '3650 days': days = 365; break // Treat "All time" as large
        default: days = 15; break
      }
    }

    if (days <= 1) {
      return {
        mode: 'detail',
        granularity: 'hour',
        recommendedChart: 'line'
      }
    } else if (days <= 7) {
      return {
        mode: 'overlay',
        granularity: 'hour',
        recommendedChart: 'overlay'
      }
    } else if (days <= 30) {
      return {
        mode: 'boxplot',
        granularity: 'hour',
        recommendedChart: 'boxplot'
      }
    } else {
      return {
        mode: 'trend',
        granularity: 'day', // For large ranges, aggregate by day or week
        recommendedChart: 'trend'
      }
    }
  }, [intervalo, filters])
}
