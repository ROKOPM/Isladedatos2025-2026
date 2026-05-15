import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { TrendingUp } from 'lucide-react'

const patternData = [
  { pattern: 'Descanso casual', count: 156, percentage: 31.2, color: 'hsl(35, 70%, 50%)' },
  { pattern: 'Pausa activa', count: 124, percentage: 24.8, color: 'hsl(145, 50%, 40%)' },
  { pattern: 'Socialización', count: 98, percentage: 19.6, color: 'hsl(270, 50%, 55%)' },
  { pattern: 'Tránsito rápido', count: 67, percentage: 13.4, color: 'hsl(210, 50%, 50%)' },
  { pattern: 'Fumador solitario', count: 32, percentage: 6.4, color: 'hsl(0, 60%, 50%)' },
  { pattern: 'Sin clasificar', count: 23, percentage: 4.6, color: 'hsl(30, 10%, 55%)' },
]

type PatternEntry = typeof patternData[0]

const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: PatternEntry }> }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload
    return (
      <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-xs">
        <p className="font-medium">{data.pattern}</p>
        <p className="text-muted-foreground font-mono">{data.count} eventos ({data.percentage}%)</p>
      </div>
    )
  }
  return null
}

export function PatternRanking() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="font-serif text-base flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            Dinámicas Grupales más frecuentes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={patternData} layout="vertical" margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <XAxis
                  type="number"
                  tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }}
                  axisLine={{ stroke: 'hsl(var(--border))' }}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="pattern"
                  width={100}
                  tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--secondary))' }} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {patternData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="font-serif text-base">Ranking Top 10</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {patternData.map((item, index) => (
              <div key={item.pattern} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-secondary flex items-center justify-center text-xs font-mono font-medium text-muted-foreground">
                      {index + 1}
                    </span>
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="font-medium">{item.pattern}</span>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">
                    {item.count} <span className="opacity-50">({item.percentage}%)</span>
                  </span>
                </div>
                <Progress
                  value={item.percentage}
                  className="h-1.5"
                  style={{ '--progress-background': item.color } as React.CSSProperties}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
