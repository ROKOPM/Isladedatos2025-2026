import { useState, useEffect, useCallback } from 'react'
import { X, Bell, AlertTriangle, AlertCircle, Info, Wind } from 'lucide-react'
import { cn } from '@/lib/utils'

export type AlertLevel = 'critical' | 'warning' | 'info'

export interface Alert {
  id: string
  level: AlertLevel
  title: string
  description: string
  timestamp: string
  campus?: string
  zona?: string
  read: boolean
}

const levelConfig: Record<AlertLevel, { icon: typeof AlertCircle; color: string; bg: string; border: string; label: string }> = {
  critical: { icon: AlertCircle, color: 'text-destructive', bg: 'bg-destructive/10', border: 'border-destructive/30', label: 'Crítica' },
  warning:  { icon: AlertTriangle, color: 'text-warning', bg: 'bg-warning/10', border: 'border-warning/30', label: 'Advertencia' },
  info:     { icon: Info, color: 'text-primary', bg: 'bg-primary/10', border: 'border-primary/30', label: 'Informativa' },
}

interface AlertsPanelProps {
  open: boolean
  onClose: () => void
  alerts: Alert[]
  loading: boolean
  onMarkRead: (id: string) => void
  onMarkAllRead: () => void
}

export function AlertsPanel({ open, onClose, alerts, loading, onMarkRead, onMarkAllRead }: AlertsPanelProps) {
  const unreadCount = alerts.filter(a => !a.read).length

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 bg-black/20 backdrop-blur-[1px] z-40"
          onClick={onClose}
        />
      )}

      <aside className={cn(
        'fixed top-0 right-0 h-screen w-80 bg-card border-l border-border shadow-2xl z-50 flex flex-col transition-transform duration-300',
        open ? 'translate-x-0' : 'translate-x-full'
      )}
      role="dialog"
      aria-modal="true"
      aria-label="Alertas del sistema"
      >
        <div className="p-4 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-primary" />
            <h2 className="font-serif text-base font-semibold">Alertas del Sistema</h2>
            {unreadCount > 0 && (
              <span className="bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                onClick={onMarkAllRead}
                className="text-xs text-muted-foreground hover:text-foreground underline"
              >
                Marcar todas leídas
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1 rounded-md hover:bg-secondary transition-colors"
              aria-label="Cerrar alertas"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-4 py-2 border-b border-border/50 flex items-center gap-3 shrink-0">
          {Object.entries(levelConfig).map(([key, cfg]) => (
            <span key={key} className="flex items-center gap-1 text-xs text-muted-foreground">
              <cfg.icon className={cn('w-3 h-3', cfg.color)} />
              {cfg.label}
            </span>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {loading && (
            <div className="flex items-center justify-center h-32">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {!loading && alerts.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
              <Bell className="w-10 h-10 opacity-20" />
              <p className="text-sm">Sin alertas activas</p>
            </div>
          )}
          {!loading && alerts.map(alert => {
            const cfg = levelConfig[alert.level]
            const Icon = alert.level === 'critical' ? AlertCircle : alert.level === 'warning' ? AlertTriangle : Info
            return (
              <div
                key={alert.id}
                onClick={() => onMarkRead(alert.id)}
                className={cn(
                  'relative rounded-lg border p-3 cursor-pointer transition-all duration-200 hover:shadow-md group',
                  cfg.bg, cfg.border,
                  alert.read ? 'opacity-60' : 'opacity-100'
                )}
              >
                {!alert.read && (
                  <span className="absolute top-3 right-3 w-2 h-2 bg-destructive rounded-full animate-pulse" />
                )}
                <div className="flex items-start gap-2.5">
                  <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', cfg.color)} />
                  <div className="flex-1 min-w-0">
                    <p className={cn('text-xs font-semibold leading-tight mb-1', cfg.color)}>
                      {alert.title}
                    </p>
                    <p className="text-[11px] text-foreground/80 leading-relaxed mb-2">
                      {alert.description}
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      {alert.zona && (
                        <span className="inline-flex items-center gap-1 text-xs font-mono text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                          <Wind className="w-2.5 h-2.5" />
                          {alert.zona}
                        </span>
                      )}
                      <span className="text-xs font-mono text-muted-foreground ml-auto">
                        {alert.timestamp}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="p-3 border-t border-border shrink-0">
          <p className="text-xs text-muted-foreground text-center font-mono">
            Actualización automática cada 5 min · Zona CDMX
          </p>
        </div>
      </aside>
    </>
  )
}

// Hook unificado para gestionar alertas
export function useAlertsManager() {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)

  const fetchAlerts = useCallback(() => {
    setLoading(true)
    fetch('/api/alertas-panel/')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setAlerts(data.map((a: any) => ({
            id: a.id,
            level: a.level as AlertLevel,
            title: a.title,
            description: a.description,
            timestamp: a.timestamp,
            campus: a.campus,
            zona: a.zona,
            read: a.read,
          })))
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchAlerts()
    const interval = setInterval(fetchAlerts, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [fetchAlerts])

  const markRead = (id: string) => {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, read: true } : a))
  }

  const markAllRead = () => {
    setAlerts(prev => prev.map(a => ({ ...a, read: true })))
  }

  const unreadCount = alerts.filter(a => !a.read).length

  return { alerts, loading, markRead, markAllRead, unreadCount, refetch: fetchAlerts }
}
