import type { LucideIcon } from 'lucide-react'
import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description: string
  className?: string
}

export function EmptyState({ icon: Icon = Info, title, description, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-4 py-10 text-center', className)}>
      <div className="w-9 h-9 rounded border border-border bg-secondary/60 flex items-center justify-center text-muted-foreground">
        <Icon className="w-4 h-4" aria-hidden="true" />
      </div>
      <div className="max-w-md space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}
