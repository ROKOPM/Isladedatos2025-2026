import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend,
} from 'recharts'
import { Cigarette, Users } from 'lucide-react'

const hourlyData = Array.from({ length: 10 }, (_, i) => {
  const hour = i + 7
  const isPeakHours = hour >= 12 && hour <= 14

  let baseActivity = 50
  if (isPeakHours) baseActivity += 25

  const smokers = Math.round(baseActivity * (0.1 + Math.random() * 0.15))

  return {
    hour: `${hour.toString().padStart(2, '0')}h`,
    total: Math.round(baseActivity + Math.random() * 15),
    smokers,
    'Descanso casual': Math.round(baseActivity * 0.3 * (0.8 + Math.random() * 0.4)),
    'Pausa activa': Math.round(baseActivity * 0.25 * (0.8 + Math.random() * 0.4)),
    'Socialización': Math.round(baseActivity * 0.2 * (0.8 + Math.random() * 0.4)),
    'Tránsito': Math.round(baseActivity * 0.15 * (0.8 + Math.random() * 0.4)),
    'Otro': Math.round(baseActivity * 0.1 * (0.8 + Math.random() * 0.4)),
  }
})

const clusterColors: Record<string, string> = {
  'Descanso casual': 'hsl(35, 70%, 50%)',
  'Pausa activa': 'hsl(145, 50%, 40%)',
  'Socialización': 'hsl(270, 50%, 55%)',
  'Tránsito': 'hsl(210, 50%, 50%)',
  'Otro': 'hsl(30, 10%, 55%)',
}

const CustomTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
}) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-card border border-border rounded-lg p-3 shadow-xl animate-fade-in">
        <p className="font-medium text-sm mb-2">{label}</p>
        <div className="space-y-1">
          {payload.map((entry, index) => (
            <div key={index} className="flex items-center justify-between gap-4 text-xs">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                <span className="text-muted-foreground">{entry.name}:</span>
              </div>
              <span className="font-mono font-medium">{entry.value}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }
  return null
}

export function HourlyDistribution() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="font-serif text-base flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" />
            Distribución horaria por tipo
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourlyData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <XAxis
                  dataKey="hour"
                  tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }}
                  axisLine={{ stroke: 'hsl(var(--border))' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 10 }} iconSize={8} />
                {Object.entries(clusterColors).map(([name, color]) => (
                  <Bar
                    key={name}
                    dataKey={name}
                    stackId="a"
                    fill={color}
                    radius={name === 'Otro' ? [2, 2, 0, 0] : [0, 0, 0, 0]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="font-serif text-base flex items-center gap-2">
            <Cigarette className="w-4 h-4 text-destructive" />
            Fumadores activos por hora
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={hourlyData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="smokersGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(0, 60%, 50%)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(0, 60%, 50%)" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="hour"
                  tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }}
                  axisLine={{ stroke: 'hsl(var(--border))' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }}
                  axisLine={false}
                  tickLine={false}
                  label={{
                    value: 'detecciones',
                    angle: -90,
                    position: 'insideLeft',
                    style: { fontSize: 13, fill: 'hsl(var(--muted-foreground))' },
                  }}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-xs">
                          <p className="font-medium">{label}</p>
                          <p className="text-destructive font-mono">{payload[0].value} fumadores</p>
                        </div>
                      )
                    }
                    return null
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="smokers"
                  stroke="hsl(0, 60%, 50%)"
                  strokeWidth={2}
                  fill="url(#smokersGradient)"
                  dot={{ fill: 'hsl(0, 60%, 50%)', strokeWidth: 0, r: 3 }}
                  activeDot={{ r: 5, stroke: 'hsl(var(--background))', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
