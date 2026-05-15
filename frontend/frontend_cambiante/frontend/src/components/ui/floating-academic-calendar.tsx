import { useState } from 'react'
import { CalendarDays, X } from 'lucide-react'
import { CalendarioAcademicoPage } from '@/pages/CalendarioAcademicoPage'
import type { GlobalFilters, IntervaloValue } from '@/types'

interface Props {
  filters?: GlobalFilters
  onFiltersChange?: (f: GlobalFilters) => void
  intervalo?: IntervaloValue
  onIntervaloChange?: (v: IntervaloValue) => void
}

export function FloatingAcademicCalendar({ filters, onFiltersChange, intervalo, onIntervaloChange }: Props) {
  const [open, setOpen] = useState(false)

  const hasActiveFilter = filters?.desde || filters?.hasta

  const handleClose = () => setOpen(false)

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        title="Calendario Académico IPN"
        aria-label="Abrir calendario académico"
        className="fixed bottom-24 right-6 p-3 glassmorphic text-foreground rounded-full hover:scale-110 hover:-translate-y-0.5 transition-all duration-200 z-40 shadow-lg border border-border/30"
      >
        <CalendarDays className="w-5 h-5" />
        {hasActiveFilter && (
          <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-academic rounded-full border-2 border-background" />
        )}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 bg-background/40 backdrop-blur-sm z-40"
            onClick={handleClose}
          />
          <div className="fixed top-0 right-0 h-full w-full max-w-full md:max-w-[640px] bg-card border-l border-border z-50 flex flex-col shadow-2xl animate-slide-in-right">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-academic" />
                <span className="font-editorial font-bold text-base text-foreground">Calendario Académico IPN</span>
              </div>
              <div className="flex items-center gap-2">
                {hasActiveFilter && (
                  <span className="text-[10px] font-mono text-academic bg-academic/10 border border-academic/20 px-2 py-1 rounded-full">
                    Filtro activo
                  </span>
                )}
                <button
                  onClick={handleClose}
                  aria-label="Cerrar calendario"
                  className="p-1.5 rounded-md hover:bg-secondary transition-colors"
                >
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
              <CalendarioAcademicoPage
                intervalo={intervalo || "15 days"}
                filters={filters}
                onFiltersChange={onFiltersChange}
                onIntervaloChange={onIntervaloChange}
              />
            </div>
          </div>
        </>
      )}
    </>
  )
}
