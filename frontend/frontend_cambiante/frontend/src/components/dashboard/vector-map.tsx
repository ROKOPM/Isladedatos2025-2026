import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { Filter, Info } from 'lucide-react'

function generateMockUmapData(count: number) {
  const clusters = [
    { name: 'Descanso casual' },
    { name: 'Pausa activa' },
    { name: 'Socialización' },
    { name: 'Tránsito rápido' },
    { name: 'Fumador solitario' },
    { name: 'Sin clasificar' },
  ]

  return Array.from({ length: count }, (_, i) => {
    const cluster = clusters[Math.floor(Math.random() * clusters.length)]
    const baseX = (Math.random() - 0.5) * 10 + (clusters.indexOf(cluster) - 2.5) * 2
    const baseY = (Math.random() - 0.5) * 10 + (clusters.indexOf(cluster) - 2.5) * 1.5
    return {
      id: i,
      umap_x: baseX + (Math.random() - 0.5) * 3,
      umap_y: baseY + (Math.random() - 0.5) * 3,
      etiqueta: cluster.name,
      fumando: Math.random() > 0.85,
      actividad: ['Sentado', 'De pie', 'Caminando', 'Conversando'][Math.floor(Math.random() * 4)],
      hora: Math.floor(Math.random() * 24),
      pm10: Math.floor(Math.random() * 100) + 20,
    }
  })
}

const mockData = generateMockUmapData(500)

const clusterColors: Record<string, string> = {
  'Descanso casual': 'hsl(35, 70%, 50%)',
  'Pausa activa': 'hsl(145, 50%, 40%)',
  'Socialización': 'hsl(270, 50%, 55%)',
  'Tránsito rápido': 'hsl(210, 50%, 50%)',
  'Fumador solitario': 'hsl(0, 60%, 50%)',
  'Sin clasificar': 'hsl(30, 10%, 55%)',
}

interface DataPoint {
  id: number
  umap_x: number
  umap_y: number
  etiqueta: string
  fumando: boolean
  actividad: string
  hora: number
  pm10: number
}

const CustomTooltip = ({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: DataPoint }>
}) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload
    return (
      <div className="bg-card border border-border rounded-lg p-3 shadow-xl animate-fade-in">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: clusterColors[data.etiqueta] }} />
          <span className="font-medium text-sm">{data.etiqueta}</span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono">
          <span className="text-muted-foreground">Actividad:</span>
          <span>{data.actividad}</span>
          <span className="text-muted-foreground">Fumando:</span>
          <span className={data.fumando ? 'text-destructive font-medium' : 'text-accent'}>
            {data.fumando ? 'Sí' : 'No'}
          </span>
          <span className="text-muted-foreground">Hora:</span>
          <span>{data.hora.toString().padStart(2, '0')}:00</span>
          <span className="text-muted-foreground">PM10:</span>
          <span>{data.pm10} µg/m³</span>
        </div>
      </div>
    )
  }
  return null
}

export function VectorMap() {
  const [selectedCluster, setSelectedCluster] = useState<string | null>(null)

  const filteredData = useMemo(() => {
    if (!selectedCluster) return mockData
    return mockData.filter((d) => d.etiqueta === selectedCluster)
  }, [selectedCluster])

  const clusterCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    mockData.forEach((d) => {
      counts[d.etiqueta] = (counts[d.etiqueta] || 0) + 1
    })
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count, color: clusterColors[name] }))
  }, [])

  return (
    <Card className="col-span-full lg:col-span-2 overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="font-serif text-lg">Mapa de Dinámicas de Comportamiento</CardTitle>
            <CardDescription className="text-xs font-mono mt-1">
              Cada punto representa un evento observado. La proximidad indica similitud semántica.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground">PCA 2D</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="px-4 pb-3 flex flex-wrap gap-2">
          <Button
            variant={selectedCluster === null ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSelectedCluster(null)}
            className="h-7 text-xs"
          >
            <Filter className="w-3 h-3 mr-1" />
            Todos ({mockData.length})
          </Button>
          {clusterCounts.slice(0, 5).map((cluster) => (
            <Button
              key={cluster.name}
              variant={selectedCluster === cluster.name ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedCluster(selectedCluster === cluster.name ? null : cluster.name)}
              className="h-7 text-xs gap-1.5"
            >
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: cluster.color }} />
              {cluster.name} ({cluster.count})
            </Button>
          ))}
        </div>

        <div className="h-[400px] w-full px-2">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
              <XAxis
                type="number"
                dataKey="umap_x"
                name="PCA-1"
                tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }}
                axisLine={{ stroke: 'hsl(var(--border))' }}
                tickLine={{ stroke: 'hsl(var(--border))' }}
              />
              <YAxis
                type="number"
                dataKey="umap_y"
                name="PCA-2"
                tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }}
                axisLine={{ stroke: 'hsl(var(--border))' }}
                tickLine={{ stroke: 'hsl(var(--border))' }}
              />
              <ZAxis type="number" dataKey="pm10" range={[30, 100]} />
              <Tooltip content={<CustomTooltip />} />
              <Scatter data={filteredData}>
                {filteredData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={clusterColors[entry.etiqueta]}
                    fillOpacity={entry.fumando ? 1 : 0.6}
                    stroke={entry.fumando ? 'hsl(var(--destructive))' : 'none'}
                    strokeWidth={entry.fumando ? 2 : 0}
                  />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>

        <div className="px-4 py-3 border-t border-border bg-secondary/30">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap gap-3">
              {clusterCounts.map((cluster) => (
                <div key={cluster.name} className="flex items-center gap-1.5 text-xs">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cluster.color }} />
                  <span className="text-muted-foreground">{cluster.name}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Info className="w-3.5 h-3.5" />
              <span className="font-mono">{filteredData.filter((d) => d.fumando).length} eventos con fumado</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
