import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  onRetry: () => void
  message?: string
  detail?: string
}

export function QueryError({
  onRetry,
  message = 'No se pudo cargar esta vista',
  detail = 'Revisa la conexión o intenta de nuevo. Los resultados se actualizarán cuando la consulta responda correctamente.',
}: Props) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 py-10 px-4 text-center text-muted-foreground"
    >
      <div className="w-9 h-9 rounded border border-destructive/30 bg-destructive/10 flex items-center justify-center text-destructive">
        <AlertTriangle className="w-4 h-4" aria-hidden="true" />
      </div>
      <div className="max-w-md space-y-1">
        <p className="text-sm font-medium text-foreground">{message}</p>
        <p className="text-xs leading-relaxed">{detail}</p>
      </div>
      <Button onClick={onRetry} variant="outline" size="sm" className="h-8 text-xs">
        <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
        Reintentar
      </Button>
    </div>
  )
}
