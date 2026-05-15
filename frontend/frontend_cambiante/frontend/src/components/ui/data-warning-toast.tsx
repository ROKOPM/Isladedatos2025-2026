import { useState, useEffect } from 'react'
import { X, Info, AlertTriangle, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'

/* ── Types ─────────────────────────────────────────────────────────── */
export interface DataWarningToastProps {
  /** Unique stable ID — used for localStorage "never show again" */
  id: string
  title?: string
  body: React.ReactNode
  variant?: 'info' | 'warning' | 'critical' | 'insight'
  /** ms before auto-dismiss (session-only). false = no auto-dismiss. */
  autoHideMs?: number | false
  /** Show the "No mostrar más" (permanent dismiss) option */
  allowPermanentDismiss?: boolean
}

/* ── Per-toast state hook ───────────────────────────────────────────── */
function useToastState(id: string) {
  const permKey = `idu_ntf_perm_${id}`
  const sessKey = `idu_ntf_sess_${id}`

  const [visible, setVisible] = useState(() => {
    try {
      if (localStorage.getItem(permKey)) return false
      if (sessionStorage.getItem(sessKey)) return false
    } catch {}
    return true
  })
  const [leaving, setLeaving] = useState(false)

  function hide(onDone?: () => void) {
    setLeaving(true)
    setTimeout(() => { setVisible(false); onDone?.() }, 320)
  }

  function dismissSession() {
    try { sessionStorage.setItem(sessKey, '1') } catch {}
    hide()
  }

  function dismissForever() {
    try { localStorage.setItem(permKey, '1') } catch {}
    hide()
  }

  return { visible, leaving, dismissSession, dismissForever }
}

/* ── Variant styles ─────────────────────────────────────────────────── */
const VARIANT = {
  info: {
    border: 'border-primary/25',
    icon: <Info className="w-4 h-4 text-primary shrink-0" />,
    timer: 'bg-primary/35',
  },
  warning: {
    border: 'border-amber-500/35',
    icon: <AlertTriangle className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0" />,
    timer: 'bg-amber-400/40',
  },
  critical: {
    border: 'border-destructive/40',
    icon: <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />,
    timer: 'bg-destructive/40',
  },
  insight: {
    border: 'border-success/30',
    icon: <TrendingUp className="w-4 h-4 text-success shrink-0" />,
    timer: 'bg-success/35',
  },
} as const

/* ── Individual Toast ───────────────────────────────────────────────── */
export function DataWarningToast({
  id,
  title = 'Aviso metodológico',
  body,
  variant = 'info',
  autoHideMs = 10000,
  allowPermanentDismiss = true,
}: DataWarningToastProps) {
  const { visible, leaving, dismissSession, dismissForever } = useToastState(id)

  useEffect(() => {
    if (!autoHideMs || !visible) return
    const t = setTimeout(dismissSession, autoHideMs as number)
    return () => clearTimeout(t)
  }, [visible]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null

  const cfg = VARIANT[variant]

  return (
    <div
      role="status"
      aria-live="polite"
      style={autoHideMs ? ({ '--toast-duration': `${autoHideMs}ms` } as React.CSSProperties) : undefined}
      className={cn(
        'w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl overflow-hidden',
        'glassmorphic shadow-xl',
        cfg.border,
        leaving ? 'animate-slide-out-right' : 'animate-slide-in-right',
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
        <div className="flex items-center gap-2.5">
          {cfg.icon}
          <span className="text-xs font-semibold font-instrument uppercase tracking-wider text-foreground">
            {title}
          </span>
        </div>
        <button
          onClick={dismissSession}
          className="p-1 rounded-md hover:bg-foreground/10 transition-colors shrink-0"
          aria-label="Cerrar notificación"
        >
          <X className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        {typeof body === 'string' ? (
          <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
        ) : (
          body
        )}
      </div>

      {/* Permanent dismiss */}
      {allowPermanentDismiss && (
        <div className="px-4 pb-3 flex justify-end">
          <button
            onClick={dismissForever}
            className="text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors font-instrument hover:underline underline-offset-2"
          >
            No mostrar más
          </button>
        </div>
      )}

      {/* Auto-dismiss progress bar */}
      {autoHideMs && (
        <div className="h-0.5 bg-border/20">
          <div className={cn('h-full toast-timer', cfg.timer)} />
        </div>
      )}
    </div>
  )
}

/* ── Toast Container (top-right, stacks vertically) ────────────────── */
export function ToastContainer({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="fixed top-4 right-4 z-[60] flex flex-col gap-2 items-end pointer-events-none"
      aria-label="Notificaciones"
    >
      <div className="pointer-events-auto flex flex-col gap-2 items-end">
        {children}
      </div>
    </div>
  )
}

/* ── Legacy compat: multi-warning shorthand ─────────────────────────── */
export interface ToastWarning {
  level: 'info' | 'warning' | 'critical'
  message: string
}
