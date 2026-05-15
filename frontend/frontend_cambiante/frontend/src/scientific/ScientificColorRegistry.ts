// Centralized semantic color registry for the Scientific Observatory
// All components should import colors from here instead of hardcoding hex values

export const SCI_COLORS = {
  // Semantic domain colors — use CSS variables when possible for theme support
  tobacco:     'hsl(var(--tobacco))',
  environment: 'hsl(var(--environment))',
  academic:    'hsl(var(--academic))',
  cluster:     'hsl(var(--cluster))',
  warning:     'hsl(var(--warning))',
  critical:    'hsl(var(--critical))',
  success:     'hsl(var(--success))',
  primary:     'hsl(var(--primary))',
  muted:       'hsl(var(--muted-foreground))',

  // Chart palette — ordered for maximum perceptual distinction
  chart: [
    'hsl(var(--chart-1))',   // verde científico
    'hsl(var(--chart-2))',   // ámbar
    'hsl(var(--chart-3))',   // azul académico
    'hsl(var(--chart-4))',   // púrpura cluster
    'hsl(var(--chart-5))',   // rojo tabaco
  ],

  // Cluster behavioral palette — 9 perceptually distinct colors
  clusters: [
    '#5a7a52',  // verde bosque
    '#c97b3a',  // naranja terracota
    '#4a7c85',  // azul petróleo
    '#7b6ea0',  // lavanda
    '#b84040',  // rojo oscuro
    '#a0833a',  // dorado oscuro
    '#4a6e9e',  // azul medio
    '#7a8a4a',  // verde oliva
    '#8a6a5a',  // marrón
  ],

  // Heatmap intensity scale (low → high)
  heatmap: {
    none:   'hsl(var(--secondary))',
    low:    'hsla(145, 40%, 55%, 0.5)',
    medium: 'hsl(145, 40%, 55%)',
    high:   'hsl(145, 50%, 45%)',
    peak:   'hsl(55, 60%, 50%)',
    max:    'hsl(35, 70%, 50%)',
  },

  // PM10 air quality thresholds (EPA/OMS)
  airQuality: {
    good:       'hsl(145, 50%, 45%)',    // < 54 µg/m³
    moderate:   'hsl(var(--primary))',   // 54–154
    unhealthy:  'hsl(35, 70%, 50%)',     // 154–254
    hazardous:  'hsl(var(--critical))',  // ≥ 254
  },

  // Risk level colors
  risk: {
    low:      'hsl(var(--success))',
    moderate: 'hsl(var(--warning))',
    high:     'hsl(var(--tobacco))',
    critical: 'hsl(var(--critical))',
  },
} as const

export function getHeatColor(value: number, max: number): string {
  if (value === 0 || max === 0) return SCI_COLORS.heatmap.none
  const i = value / max
  if (i < 0.2) return SCI_COLORS.heatmap.low
  if (i < 0.4) return SCI_COLORS.heatmap.medium
  if (i < 0.6) return SCI_COLORS.heatmap.high
  if (i < 0.8) return SCI_COLORS.heatmap.peak
  return SCI_COLORS.heatmap.max
}

export function getAirQualityColor(pm10: number | null): string {
  const v = pm10 ?? 0
  if (v < 54) return SCI_COLORS.airQuality.good
  if (v < 154) return SCI_COLORS.airQuality.moderate
  if (v < 254) return SCI_COLORS.airQuality.unhealthy
  return SCI_COLORS.airQuality.hazardous
}

export function getRiskColor(tasa: number): string {
  if (tasa >= 15) return SCI_COLORS.risk.high
  if (tasa >= 5)  return SCI_COLORS.risk.moderate
  return SCI_COLORS.risk.low
}
