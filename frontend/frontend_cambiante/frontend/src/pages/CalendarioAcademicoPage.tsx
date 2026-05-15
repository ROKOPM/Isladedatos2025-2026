import { useState, useMemo } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Calendar, BookOpen, FlaskConical, Loader2, AlertTriangle } from 'lucide-react'
import { useCalendario } from '@/hooks/queries'
import type { IntervaloValue, GlobalFilters } from '@/types'

interface Props {
  intervalo: IntervaloValue
  filters?: GlobalFilters
  onFiltersChange?: (f: GlobalFilters) => void
  onIntervaloChange?: (v: IntervaloValue) => void
}

const TIPO_PERIODO_COLORS: Record<string, string> = {
  clases:        'bg-accent/80 text-accent-foreground',
  vacaciones:    'bg-primary/60 text-primary-foreground',
  examenes:      'bg-destructive/60 text-destructive-foreground',
  asueto:        'bg-yellow-500/80 text-yellow-950',
  intersemestral:'bg-muted text-muted-foreground',
  default:       'bg-secondary text-secondary-foreground',
}

const TIPO_LABELS: Record<string, string> = {
  clases:        'Clases',
  vacaciones:    'Vacaciones',
  examenes:      'Exámenes',
  asueto:        'Asueto',
  intersemestral:'Intersemestral',
}

export function CalendarioAcademicoPage({ intervalo: _intervalo, filters: _filters, onFiltersChange: _onFiltersChange, onIntervaloChange: _onIntervaloChange }: Props) {
  const [calAnio, setCalAnio] = useState<number>(new Date().getFullYear())
  const [calMes, setCalMes] = useState<number>(new Date().getMonth() + 1)

  const { data: calendario = [], isLoading, isError, refetch } = useCalendario(calAnio, calMes)

  // Compute stats from real calendar data
  const stats = useMemo(() => {
    const counts: Record<string, number> = {}
    calendario.forEach((d) => {
      counts[d.tipo_periodo] = (counts[d.tipo_periodo] || 0) + 1
    })
    const tipoMasFrecuente = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
    return { counts, tipoMasFrecuente }
  }, [calendario])

  return (
    <div className="space-y-5">
      {/* ── Contexto metodológico ────────────────────────────────────── */}
      <div className="sci-panel bg-secondary/20">
        <div className="p-4 flex items-start gap-4">
          <div className="w-10 h-10 rounded bg-academic/10 flex items-center justify-center shrink-0 border border-academic/20">
            <Calendar className="w-5 h-5 text-academic" />
          </div>
          <div>
            <h2 className="text-sm font-editorial font-bold text-foreground">Contexto Académico IPN — Calendario Escolar</h2>
            <p className="text-xs font-instrument text-muted-foreground mt-1 mb-2">
              Correlación entre el calendario académico del IPN y los patrones conductuales observados.
              Los períodos de exámenes, vacaciones y clases regulares modulan los patrones de afluencia y tabaquismo.
            </p>
            <div className="flex flex-wrap gap-2">
              <span className="gov-badge gov-badge-ok">Correlacional (No Causal)</span>
              <span className="gov-badge border-border bg-background">Fuente: IPN ESCOM 2024–2025</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Stats cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="sci-panel p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded bg-primary/10 flex items-center justify-center shrink-0 border border-primary/20">
            <BookOpen className="w-6 h-6 text-primary" />
          </div>
          <div>
            <p className="text-xs font-instrument text-muted-foreground uppercase tracking-wider mb-1">Días de clase en el mes</p>
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mt-1" />
            ) : (
              <>
                <p className="text-2xl font-bold">{stats.counts['clases'] ?? 0} <span className="text-sm font-normal text-muted-foreground">días</span></p>
                <p className="text-xs font-instrument text-muted-foreground">
                  {stats.counts['examenes'] ? `+ ${stats.counts['examenes']} de exámenes` : 'Sin períodos de examen'}
                </p>
              </>
            )}
          </div>
        </div>

        <div className="sci-panel p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded bg-academic/10 flex items-center justify-center shrink-0 border border-academic/20">
            <FlaskConical className="w-6 h-6 text-academic" />
          </div>
          <div>
            <p className="text-xs font-instrument text-muted-foreground uppercase tracking-wider mb-1">Período predominante</p>
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mt-1" />
            ) : (
              <>
                <p className="text-xl font-bold">
                  {stats.tipoMasFrecuente
                    ? (TIPO_LABELS[stats.tipoMasFrecuente[0]] ?? stats.tipoMasFrecuente[0])
                    : 'Sin datos'}
                </p>
                <p className="text-xs font-instrument text-muted-foreground">
                  {stats.tipoMasFrecuente ? `${stats.tipoMasFrecuente[1]} días en el mes` : ''}
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Calendar grid ────────────────────────────────────────────── */}
      <div className="sci-panel">
        <div className="sci-panel-header flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="font-editorial text-base font-bold flex items-center gap-2 text-foreground">
              <Calendar className="w-4 h-4 text-primary" />
              Calendario Escolar IPN
            </h3>
            <p className="text-xs font-instrument text-muted-foreground mt-0.5">Días coloreados por período académico</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={calAnio.toString()} onValueChange={(v) => setCalAnio(Number(v))}>
              <SelectTrigger className="w-[90px] h-8 text-xs font-mono bg-secondary border-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[2023, 2024, 2025, 2026, 2027].map(y => (
                  <SelectItem key={y} value={y.toString()} className="text-xs font-mono">{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={calMes.toString()} onValueChange={(v) => setCalMes(Number(v))}>
              <SelectTrigger className="w-[110px] h-8 text-xs font-mono bg-secondary border-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'].map((m, i) => (
                  <SelectItem key={i + 1} value={(i + 1).toString()} className="text-xs font-mono">{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="p-4">
          {isError ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
              <AlertTriangle className="w-5 h-5" />
              <p className="text-xs font-mono">Error al cargar el calendario</p>
              <button onClick={() => refetch()} className="text-xs underline hover:text-foreground">Reintentar</button>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-7 gap-1 text-center">
                {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(d => (
                  <div key={d} className="text-xs font-instrument text-muted-foreground uppercase py-2">{d}</div>
                ))}
                {(() => {
                  const firstDay = new Date(calAnio, calMes - 1, 1).getDay()
                  const offset = firstDay === 0 ? 6 : firstDay - 1
                  const daysInMonth = new Date(calAnio, calMes, 0).getDate()
                  const cells = []

                  for (let i = 0; i < offset; i++) {
                    cells.push(
                      <div key={`empty-${i}`} className="h-16 md:h-20 bg-secondary/30 border border-border/20 rounded opacity-30" />
                    )
                  }

                  for (let d = 1; d <= daysInMonth; d++) {
                    const dateStr = `${calAnio}-${calMes.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`
                    const dayData = calendario.find(c => c.fecha === dateStr)
                    const colorClass = dayData
                      ? (TIPO_PERIODO_COLORS[dayData.tipo_periodo] || TIPO_PERIODO_COLORS.default)
                      : 'bg-secondary/20 border border-border/30'

                    cells.push(
                      <div
                        key={d}
                        className={`h-16 md:h-20 rounded p-1.5 md:p-2 flex flex-col justify-between ${colorClass} transition-transform hover:scale-105 cursor-pointer`}
                        title={dayData?.nombre_periodo}
                      >
                        <div className="flex justify-between items-start">
                          <span className="text-xs md:text-sm font-mono font-bold opacity-90">{d}</span>
                        </div>
                        {dayData && (
                          <div className="text-[9px] md:text-[10px] uppercase font-instrument font-bold tracking-tighter truncate opacity-80 leading-tight hidden md:block">
                            {dayData.tipo_periodo}
                          </div>
                        )}
                      </div>
                    )
                  }

                  return cells
                })()}
              </div>

              <div className="flex flex-wrap gap-3 items-center justify-center pt-4 border-t border-border/50">
                {Object.entries(TIPO_PERIODO_COLORS)
                  .filter(([k]) => k !== 'default')
                  .map(([tipo, color]) => (
                    <div key={tipo} className="flex items-center gap-1.5">
                      <div className={`w-4 h-4 rounded ${color}`} />
                      <span className="text-[10px] font-instrument uppercase text-muted-foreground tracking-wider">
                        {TIPO_LABELS[tipo] ?? tipo}
                      </span>
                    </div>
                  ))}
              </div>
              <p className="fig-caption text-center">
                <span className="fig-number">Fig. Cal-1</span> — Distribución de períodos académicos IPN ESCOM.
                Los patrones de fumado y afluencia varían significativamente entre períodos de clases regulares y exámenes.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
