import { useState, useCallback, useEffect } from 'react'
import { ArrowUp } from 'lucide-react'
import { Sidebar } from '@/components/dashboard/sidebar'
import { Header } from '@/components/dashboard/header'
import { DashboardPage } from '@/pages/DashboardPage'
import { ComportamientosPage } from '@/pages/ComportamientosPage'
import { ClusterLabPage } from '@/pages/ClusterLabPage'
import { RitmosPage } from '@/pages/RitmosPage'
import { CalidadAirePage } from '@/pages/CalidadAirePage'
import { TabaquismoPage } from '@/pages/TabaquismoPage'
import { ReproducibilidadPage } from '@/pages/ReproducibilidadPage'
import { FloatingAcademicCalendar } from '@/components/ui/floating-academic-calendar'
import type { IntervaloValue, GlobalFilters } from '@/types'

const PAGE_TITLES: Record<string, { title: string; description: string }> = {
  '/': {
    title: 'Observación General',
    description: 'Panel de observación conductual agregada',
  },
  '/tabaquismo': {
    title: 'Tabaquismo Observacional',
    description: 'Análisis de incidencias de fumado y factores asociados',
  },
  '/calidad-aire': {
    title: 'Calidad Ambiental',
    description: 'Monitoreo PM10 y contexto ambiental observado',
  },
  '/calidad-ambiental': {
    title: 'Calidad Ambiental',
    description: 'Monitoreo PM10 y contexto ambiental observado',
  },
  '/comportamientos': {
    title: 'Comportamientos Sociales',
    description: 'Actividades observadas y firma temporal agregada',
  },
  '/social': {
    title: 'Comportamientos Sociales',
    description: 'Actividades observadas y firma temporal agregada',
  },
  '/ritmos': {
    title: 'Ritmos y Temporalidad',
    description: 'Distribución temporal de actividad y duración de hábitos',
  },
  '/clusters': {
    title: 'Laboratorio de Hábitos',
    description: 'Exploración de hábitos observados agregados con PCA y K-Means',
  },
  '/reproducibilidad': {
    title: 'Motor de Reproducibilidad',
    description: 'Auditoría, linaje de datos, snapshots y configuración científica inmutable',
  },
}

function useLocation() {
  const [pathname, setPathname] = useState(window.location.pathname)
  useEffect(() => {
    const onNav = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', onNav)
    window.addEventListener('pushstate', onNav)
    return () => {
      window.removeEventListener('popstate', onNav)
      window.removeEventListener('pushstate', onNav)
    }
  }, [])
  return pathname
}

function parseFiltersFromURL(): GlobalFilters {
  const params = new URLSearchParams(window.location.search)
  
  const defaultHoras: string[] = []
  
  return {
    campus: params.get('campus')?.split(',').filter(Boolean) || [],
    zonas: params.get('zonas')?.split(',').filter(Boolean) || [],
    camaras: params.get('camaras')?.split(',').filter(Boolean) || [],
    dias_semana: params.get('dias_semana')?.split(',').filter(Boolean) || [],
    horas: params.get('horas')?.split(',').filter(Boolean) || defaultHoras,
    desde: params.get('desde') || undefined,
    hasta: params.get('hasta') || undefined,
    smokingMode: params.get('smokingMode') === 'true',
  }
}

function parseIntervaloFromURL(): IntervaloValue {
  const params = new URLSearchParams(window.location.search)
  const val = params.get('intervalo') as IntervaloValue | null
  return val ?? '15 days'
}

function App() {
  const [intervalo, setIntervalo] = useState<IntervaloValue>(parseIntervaloFromURL)
  const [filters, setFilters] = useState<GlobalFilters>(parseFiltersFromURL)
  const [refreshKey, setRefreshKey] = useState(0)
  const [showScrollTop, setShowScrollTop] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const pathname = useLocation()
  const pageInfo = PAGE_TITLES[pathname] || PAGE_TITLES['/']

  useEffect(() => {
    const params = new URLSearchParams()
    if (filters.campus.length) params.set('campus', filters.campus.join(','))
    if (filters.zonas.length) params.set('zonas', filters.zonas.join(','))
    if (filters.camaras.length) params.set('camaras', filters.camaras.join(','))
    if (filters.desde) params.set('desde', filters.desde)
    if (filters.hasta) params.set('hasta', filters.hasta)
    if (filters.dias_semana.length) params.set('dias_semana', filters.dias_semana.join(','))
    if (filters.horas.length) params.set('horas', filters.horas.join(','))
    if (filters.smokingMode) params.set('smokingMode', 'true')
    if (intervalo !== '15 days') params.set('intervalo', intervalo)
    const qs = params.toString()
    const newURL = qs ? `${pathname}?${qs}` : pathname
    window.history.replaceState({}, '', newURL)
  }, [filters, intervalo, pathname])

  useEffect(() => {
    const handleScroll = () => setShowScrollTop(window.scrollY > 300)
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' })

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1)
  }, [])

  return (
    <div className="flex min-h-screen bg-background overflow-x-hidden max-w-full">
      <div className={`hidden lg:block shrink-0 transition-all duration-300 ${sidebarCollapsed ? 'w-16' : 'w-64'}`}>
        <Sidebar
          filters={filters} onFiltersChange={setFilters}
          intervalo={intervalo} onIntervaloChange={setIntervalo}
          collapsed={sidebarCollapsed} onCollapsedChange={setSidebarCollapsed}
        />
      </div>

      <main className="flex-1 min-w-0 max-w-full p-3 md:p-4 lg:p-6">
        <Header
          title={pageInfo.title}
          description={pageInfo.description}
          intervalo={intervalo}
          onIntervaloChange={setIntervalo}
          filters={filters}
          onFiltersChange={setFilters}
          onRefresh={handleRefresh}
        />

        <div className="mt-5" key={refreshKey}>
          {pathname === '/' && <DashboardPage intervalo={intervalo} filters={filters} />}
          {pathname === '/tabaquismo' && <TabaquismoPage intervalo={intervalo} filters={filters} />}
          {(pathname === '/calidad-aire' || pathname === '/calidad-ambiental') && <CalidadAirePage intervalo={intervalo} filters={filters} />}
          {(pathname === '/comportamientos' || pathname === '/social') && <ComportamientosPage intervalo={intervalo} filters={filters} />}
          {pathname === '/ritmos' && <RitmosPage intervalo={intervalo} filters={filters} />}
          {pathname === '/clusters' && <ClusterLabPage intervalo={intervalo} filters={filters} />}
          {pathname === '/reproducibilidad' && <ReproducibilidadPage filters={filters} intervalo={intervalo} />}
        </div>

        {/* Floating Academic Calendar */}
        <FloatingAcademicCalendar
          filters={filters}
          onFiltersChange={setFilters}
          intervalo={intervalo}
          onIntervaloChange={setIntervalo}
        />

        {/* Scroll To Top Button */}
        {showScrollTop && (
          <button
            onClick={scrollToTop}
            className="fixed bottom-6 right-6 p-3 glassmorphic text-foreground rounded-full hover:scale-110 hover:-translate-y-0.5 transition-all duration-200 z-50 animate-fade-in"
            aria-label="Volver arriba"
          >
            <ArrowUp className="w-5 h-5" />
          </button>
        )}
      </main>
    </div>
  )
}

export default App
