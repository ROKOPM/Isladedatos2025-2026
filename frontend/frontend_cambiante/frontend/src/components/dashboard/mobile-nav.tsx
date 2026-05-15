import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Sidebar } from './sidebar'

import type { GlobalFilters, IntervaloValue } from '@/types'

interface MobileNavProps {
  filters?: GlobalFilters
  onFiltersChange?: (filters: GlobalFilters) => void
  intervalo?: IntervaloValue
  onIntervaloChange?: (v: IntervaloValue) => void
}

export function MobileNav(props: MobileNavProps) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="lg:hidden hover:bg-secondary transition-all duration-300">
          <Menu className="w-5 h-5" />
          <span className="sr-only">Abrir menú</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="p-0 w-64">
        <SheetHeader className="sr-only">
          <SheetTitle>Menú de navegación</SheetTitle>
        </SheetHeader>
        <Sidebar {...props} />
      </SheetContent>
    </Sheet>
  )
}
