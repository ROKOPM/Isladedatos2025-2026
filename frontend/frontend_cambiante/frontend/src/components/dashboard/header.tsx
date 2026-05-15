import { RefreshCcw, Bell } from 'lucide-react'
import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { MobileNav } from './mobile-nav'
import { ModeToggle } from '@/components/theme-toggle'
import { AlertsPanel, useAlertsManager } from './alerts-panel'
import { PdfReportButton, CsvDownloadButton } from './pdf-report-button'
import type { IntervaloValue, GlobalFilters } from '@/types'

interface HeaderProps {
  title: string
  description: string
  intervalo: IntervaloValue
  onIntervaloChange: (v: IntervaloValue) => void
  filters?: GlobalFilters
  onFiltersChange?: (filters: GlobalFilters) => void
  onRefresh?: () => void
}

export function Header({ title, description, intervalo, onIntervaloChange, filters, onFiltersChange, onRefresh }: HeaderProps) {
  const [localTime, setLocalTime] = useState('--:--')
  const [alertsOpen, setAlertsOpen] = useState(false)
  const { alerts, loading, unreadCount, markRead, markAllRead } = useAlertsManager()

  useEffect(() => {
    const updateTime = () => {
      const now = new Date()
      setLocalTime(now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Mexico_City' }))
    }
    updateTime()
    const interval = setInterval(updateTime, 30000)
    return () => clearInterval(interval)
  }, [])

  return (
    <>
      <AlertsPanel
        open={alertsOpen}
        onClose={() => setAlertsOpen(false)}
        alerts={alerts}
        loading={loading}
        onMarkRead={markRead}
        onMarkAllRead={markAllRead}
      />

      <header className="space-y-0">
        {/* ── Scientific Session Bar ─────────────────────────── */}
        <div className="sci-panel mb-4">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border/60">
            {/* LEFT — Mobile nav */}
            <div className="flex items-center gap-3">
              <MobileNav
                filters={filters} onFiltersChange={onFiltersChange}
                intervalo={intervalo} onIntervaloChange={onIntervaloChange}
              />
            </div>

            {/* RIGHT — Session tools */}
            <div className="flex items-center gap-3 font-instrument text-xs text-muted-foreground">
              <span className="hidden md:inline">Hora local: <span className="text-foreground">{localTime}</span></span>
              <span className="hidden md:inline opacity-30">│</span>
              <div className="flex items-center gap-1.5">
                <Button variant="ghost" size="icon-sm" onClick={onRefresh} className="h-7 w-7 hover:bg-secondary" aria-label="Actualizar datos del dashboard">
                  <RefreshCcw className="w-3 h-3" aria-hidden="true" />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => setAlertsOpen(o => !o)} className="relative h-7 w-7 hover:bg-secondary" aria-label="Abrir alertas del sistema">
                  <Bell className="w-3 h-3" aria-hidden="true" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[12px] h-3 bg-destructive rounded-full flex items-center justify-center text-[8px] text-destructive-foreground font-bold px-0.5">{unreadCount}</span>
                  )}
                </Button>
                <ModeToggle />
              </div>
            </div>
          </div>

        </div>

        {/* ── Page Title (Editorial) ────────────────────────── */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-editorial font-bold text-foreground mb-1">{title}</h1>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CsvDownloadButton filters={filters} intervalo={intervalo} />
            <PdfReportButton filters={filters} intervalo={intervalo} />
          </div>
        </div>
      </header>
    </>
  )
}
