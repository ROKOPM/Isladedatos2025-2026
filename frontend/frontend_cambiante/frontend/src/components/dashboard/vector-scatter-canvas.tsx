import { useRef, useEffect, useCallback, useState } from 'react'
import type { ClusterPoint } from '@/types'

export type ColorBy = 'cluster' | 'fumando' | 'actividad' | 'hora' | 'pm10'

interface Props {
  points: ClusterPoint[]
  colorMap: Record<string, string>
  colorBy?: ColorBy
}

interface TooltipState {
  x: number
  y: number
  point: ClusterPoint
}

interface Bounds {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

const ACT_COLORS = [
  '#e07b39','#5a9e6b','#7b6ea0','#b84040','#4a7c85',
  '#a09f3a','#4a6e9e','#8a8a4a','#a0503a','#5a7ab0',
]

function hashStr(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i) | 0
  return Math.abs(h)
}

function getPointColor(
  p: ClusterPoint,
  colorBy: ColorBy,
  colorMap: Record<string, string>,
): string {
  switch (colorBy) {
    case 'fumando':
      return p.fumando ? 'hsl(0,68%,55%)' : 'hsl(145,52%,44%)'
    case 'actividad':
      return ACT_COLORS[hashStr(p.actividad ?? '') % ACT_COLORS.length]
    case 'hora': {
      const h = ((p.hora % 24) + 24) % 24
      const hue = h < 12 ? 200 + h * 10 : 320 - h * 10
      const light = h >= 6 && h <= 18 ? 48 : 32
      return `hsl(${Math.round(hue)},65%,${light}%)`
    }
    case 'pm10': {
      const v = p.pm10 ?? 0
      if (v < 54) return `hsl(${120 - (v / 54) * 40},60%,44%)`
      if (v < 154) return `hsl(${80 - ((v - 54) / 100) * 80},60%,44%)`
      return 'hsl(0,62%,44%)'
    }
    default:
      return colorMap[p.habit_name || p.cluster_name || p.etiqueta] ?? '#888'
  }
}

function encodeIndex(i: number): [number, number, number] {
  return [(i >> 16) & 0xFF, (i >> 8) & 0xFF, i & 0xFF]
}

function decodeIndex(r: number, g: number, b: number): number {
  return ((r & 0xFF) << 16) | ((g & 0xFF) << 8) | (b & 0xFF)
}

function computeBounds(points: ClusterPoint[]): Bounds {
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity
  for (const p of points) {
    if (p.umap_x < xMin) xMin = p.umap_x
    if (p.umap_x > xMax) xMax = p.umap_x
    if (p.umap_y < yMin) yMin = p.umap_y
    if (p.umap_y > yMax) yMax = p.umap_y
  }
  const padX = (xMax - xMin) * 0.05 || 1
  const padY = (yMax - yMin) * 0.05 || 1
  return { xMin: xMin - padX, xMax: xMax + padX, yMin: yMin - padY, yMax: yMax + padY }
}

const MARGIN = { top: 20, right: 16, bottom: 32, left: 44 }
const HIT_RADIUS = 4

export function VectorScatterCanvas({
  points,
  colorMap,
  colorBy = 'cluster',
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pickerRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const projRef = useRef<Float64Array | null>(null)
  const pickerReadyRef = useRef(false)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const picker = pickerRef.current
    const container = containerRef.current
    if (!canvas || !picker || !container || points.length === 0) return

    const w = container.clientWidth
    const h = container.clientHeight
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = w + 'px'
    canvas.style.height = h + 'px'

    picker.width = w
    picker.height = h
    picker.style.width = w + 'px'
    picker.style.height = h + 'px'

    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)

    const bounds = computeBounds(points)
    const xRange = bounds.xMax - bounds.xMin || 1
    const yRange = bounds.yMax - bounds.yMin || 1
    const plotW = w - MARGIN.left - MARGIN.right
    const plotH = h - MARGIN.top - MARGIN.bottom

    const mapX = (v: number) => MARGIN.left + ((v - bounds.xMin) / xRange) * plotW
    const mapY = (v: number) => MARGIN.top + plotH - ((v - bounds.yMin) / yRange) * plotH

    ctx.clearRect(0, 0, w, h)

    ctx.strokeStyle = 'hsl(var(--border))'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(MARGIN.left, MARGIN.top)
    ctx.lineTo(MARGIN.left, MARGIN.top + plotH)
    ctx.lineTo(MARGIN.left + plotW, MARGIN.top + plotH)
    ctx.stroke()

    ctx.strokeStyle = 'hsl(var(--border))'
    ctx.globalAlpha = 0.25
    for (let i = 1; i <= 4; i++) {
      const x = MARGIN.left + (plotW / 5) * i
      const y = MARGIN.top + (plotH / 5) * i
      ctx.beginPath(); ctx.moveTo(x, MARGIN.top); ctx.lineTo(x, MARGIN.top + plotH); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(MARGIN.left, y); ctx.lineTo(MARGIN.left + plotW, y); ctx.stroke()
    }
    ctx.globalAlpha = 1

    ctx.fillStyle = 'hsl(var(--muted-foreground))'
    ctx.font = '10px Geist Mono, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    for (let i = 0; i <= 5; i++) {
      const val = bounds.xMin + (xRange / 5) * i
      ctx.fillText(val.toFixed(1), MARGIN.left + (plotW / 5) * i, MARGIN.top + plotH + 6)
    }
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    for (let i = 0; i <= 5; i++) {
      const val = bounds.yMin + (yRange / 5) * i
      ctx.fillText(val.toFixed(1), MARGIN.left - 6, MARGIN.top + (plotH / 5) * i)
    }
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillText('PCA-1', MARGIN.left + plotW / 2, h - 8)
    ctx.save()
    ctx.translate(10, MARGIN.top + plotH / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.textBaseline = 'middle'
    ctx.fillText('PCA-2', 0, 0)
    ctx.restore()

    // Build projection and draw both visible + picker canvases
    const proj = new Float64Array(points.length * 2)
    for (let i = 0; i < points.length; i++) {
      proj[i * 2]     = mapX(points[i].umap_x)
      proj[i * 2 + 1] = mapY(points[i].umap_y)
    }
    projRef.current = proj

    // Draw visible canvas
    const r = 3
    for (let i = 0; i < points.length; i++) {
      const p = points[i]
      const cx = proj[i * 2]
      const cy = proj[i * 2 + 1]
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fillStyle = getPointColor(p, colorBy, colorMap)
      ctx.globalAlpha = p.fumando ? 1 : 0.55
      ctx.fill()
      if (p.fumando && colorBy !== 'fumando') {
        ctx.strokeStyle = 'hsl(var(--destructive))'
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1

    // Draw picker canvas (offscreen, hidden) — each point a unique color encoding its index
    const pickerCtx = picker.getContext('2d')!
    pickerCtx.clearRect(0, 0, w, h)
    const pickR = HIT_RADIUS
    for (let i = 0; i < points.length; i++) {
      const cx = proj[i * 2]
      const cy = proj[i * 2 + 1]
      const [r8, g8, b8] = encodeIndex(i)
      pickerCtx.fillStyle = `rgb(${r8},${g8},${b8})`
      pickerCtx.beginPath()
      pickerCtx.arc(cx, cy, pickR, 0, Math.PI * 2)
      pickerCtx.fill()
    }
    pickerReadyRef.current = true
  }, [points, colorMap, colorBy])

  useEffect(() => {
    draw()
    const ro = new ResizeObserver(draw)
    if (containerRef.current) ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [draw])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const picker = pickerRef.current
    const canvas = canvasRef.current
    if (!picker || !canvas || !pickerReadyRef.current || points.length === 0) return

    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    // Read 1 pixel from picker canvas — O(1) regardless of point count
    const pixel = picker.getContext('2d')!.getImageData(Math.round(mx), Math.round(my), 1, 1).data
    const r = pixel[0], g = pixel[1], b = pixel[2]
    const idx = decodeIndex(r, g, b)

    if (idx >= 0 && idx < points.length) {
      const proj = projRef.current
      if (proj) {
        setTooltip({ x: proj[idx * 2], y: proj[idx * 2 + 1], point: points[idx] })
        canvas.style.cursor = 'crosshair'
        return
      }
    }
    setTooltip(null)
    canvas.style.cursor = 'default'
  }, [points])

  const handleMouseLeave = useCallback(() => setTooltip(null), [])

  const tooltipColor = tooltip
    ? getPointColor(tooltip.point, colorBy, colorMap)
    : '#888'

  const tooltipLabel = tooltip
    ? colorBy === 'cluster'
      ? (tooltip.point.habit_name || tooltip.point.cluster_name || tooltip.point.etiqueta)
      : colorBy === 'fumando'
        ? (tooltip.point.fumando ? 'Fumando' : 'No fumando')
        : colorBy === 'actividad'
          ? tooltip.point.actividad
          : colorBy === 'hora'
            ? `${tooltip.point.hora.toString().padStart(2, '0')}:00`
            : `PM10: ${tooltip.point.pm10} µg/m³`
    : ''

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      <canvas
        ref={pickerRef}
        className="absolute inset-0 pointer-events-none"
        style={{ opacity: 0 }}
      />
      {tooltip && (
        <div
          className="pointer-events-none z-10"
          style={{
            position: 'absolute',
            left: Math.min(tooltip.x + 12, (containerRef.current?.clientWidth || 600) - 220),
            top: Math.min(tooltip.y + 12, (containerRef.current?.clientHeight || 420) - 140),
          }}
        >
          <div className="bg-card border border-border rounded-lg p-3 shadow-xl animate-fade-in">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: tooltipColor }} />
              <span className="font-medium text-sm">{tooltipLabel}</span>
            </div>
            {colorBy === 'cluster' && (
              <div className="text-xs text-muted-foreground mb-2 font-mono space-y-0.5">
                <div>Cluster: {tooltip.point.cluster_name || tooltip.point.etiqueta}</div>
                {(tooltip.point.meta_habit_name || tooltip.point.meta_etiqueta) && (
                  <div>Categoría de hábito: {tooltip.point.meta_habit_name || tooltip.point.meta_etiqueta}</div>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono">
              <span className="text-muted-foreground">Actividad:</span>
              <span>{tooltip.point.actividad}</span>
              <span className="text-muted-foreground">Fumando:</span>
              <span className={tooltip.point.fumando ? 'text-destructive font-medium' : 'text-accent'}>
                {tooltip.point.fumando ? 'Sí' : 'No'}
              </span>
              <span className="text-muted-foreground">Hora:</span>
              <span>{tooltip.point.hora.toString().padStart(2, '0')}:00</span>
              <span className="text-muted-foreground">PM10:</span>
              <span>{tooltip.point.pm10} µg/m³</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
