import { useState, useEffect, useMemo } from 'react'
import { LayoutDashboard, Clock, Wind, MapPin, Calendar, Cigarette, CigaretteOff, Filter, ChevronDown, ChevronRight, ChevronLeft, Building2, Camera, X, Users, Atom } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GlobalFilters, GeoOption } from '@/types'
import { fetchFiltros } from '@/api/client'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { IntervaloValue } from '@/types'

const menuItems = [
  { icon: LayoutDashboard, label: 'Observación General', href: '/' },
  { icon: Wind, label: 'Calidad Ambiental', href: '/calidad-aire' },
  { icon: Cigarette, label: 'Tabaquismo Observacional', href: '/tabaquismo' },
  { icon: Users, label: 'Comportamientos Sociales', href: '/comportamientos' },
  { icon: Clock, label: 'Ritmos y Temporalidad', href: '/ritmos' },
  { icon: Atom, label: 'Laboratorio de Hábitos', href: '/clusters' },
]

const INTERVALO_OPTIONS: { value: IntervaloValue; label: string }[] = [
  { value: '1 day', label: '24h — Detalle fino' },
  { value: '7 days', label: '7d — Semana observacional' },
  { value: '15 days', label: '15d — Ventana estándar' },
  { value: '30 days', label: '30d — Periodo mensual' },
  { value: '90 days', label: '90d — Trimestre' },
]

interface SidebarProps {
  filters?: GlobalFilters
  onFiltersChange?: (filters: GlobalFilters) => void
  intervalo?: IntervaloValue
  onIntervaloChange?: (v: IntervaloValue) => void
  collapsed?: boolean
  onCollapsedChange?: (v: boolean) => void
}

function FilterGroup({ title, icon: Icon, options, selected, onChange: _onChange }: {
  title: string, icon: any, options: {value: string, label: string}[], selected: string[], onChange: (val: string) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-center justify-between w-full text-xs font-medium text-muted-foreground hover:text-foreground py-1.5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon className="w-3.5 h-3.5" />
          <span className="uppercase tracking-wider">{title}</span>
        </div>
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
      </button>

      {open && (
        <div className="mt-1 space-y-1 pl-5 max-h-40 overflow-y-auto pr-1 custom-scrollbar">
          {options.map((opt) => {
            const isChecked = selected.includes(opt.value)
            return (
              <label key={opt.value} className="flex items-center gap-2 py-1 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => _onChange(opt.value)}
                  className="sr-only"
                />
                <div className={cn(
                  "w-3.5 h-3.5 rounded-sm border flex items-center justify-center transition-colors",
                  isChecked ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/40 group-hover:border-primary/60"
                )}>
                  {isChecked && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>}
                </div>
                <span className={cn("text-xs transition-colors", isChecked ? "text-foreground font-medium" : "text-muted-foreground group-hover:text-foreground")}>
                  {opt.label}
                </span>
              </label>
            )
          })}
          {options.length === 0 && (
            <p className="text-xs text-muted-foreground italic py-1">Sin opciones</p>
          )}
        </div>
      )}
    </div>
  )
}

export function Sidebar({ filters, onFiltersChange, intervalo, onIntervaloChange, collapsed = false, onCollapsedChange }: SidebarProps) {
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)
  const [timeMode, setTimeMode] = useState<'relativo' | 'personalizado'>(
    !!(filters?.desde || filters?.hasta) ? 'personalizado' : 'relativo'
  )
  const [geoOptions, setGeoOptions] = useState<GeoOption[]>([])
  const pathname = window.location.pathname

  useEffect(() => {
    fetchFiltros().then(res => setGeoOptions(res.geo)).catch(console.error)
  }, [])

  const availableCampus = useMemo(() => {
    return Array.from(new Set(geoOptions.map(g => g.campus))).sort().map(c => ({ value: c, label: c }))
  }, [geoOptions])

  const availableZonas = useMemo(() => {
    const filtered = filters?.campus.length ? geoOptions.filter(g => filters.campus.includes(g.campus)) : geoOptions
    return Array.from(new Set(filtered.map(g => g.zona))).sort().map(z => ({ value: z, label: z }))
  }, [geoOptions, filters?.campus])

  const availableCamaras = useMemo(() => {
    let filtered = geoOptions
    if (filters?.campus.length) filtered = filtered.filter(g => filters.campus.includes(g.campus))
    if (filters?.zonas.length) filtered = filtered.filter(g => filters.zonas.includes(g.zona))
    return Array.from(new Set(filtered.map(g => g.camara.startsWith('rtsp_cam') ? 'usb_cam' : g.camara)))
      .sort()
      .map(c => ({ value: c, label: c === 'usb_cam' ? 'USB Cam' : c }))
  }, [geoOptions, filters?.campus, filters?.zonas])

  const navigate = (path: string) => {
    window.history.pushState({}, '', path)
    window.dispatchEvent(new Event('pushstate'))
  }

  const toggleFilter = (category: keyof GlobalFilters, value: string) => {
    if (!filters || !onFiltersChange) return
    const current = filters[category]
    if (!Array.isArray(current)) return
    const updated = current.includes(value) ? current.filter(v => v !== value) : [...current, value]
    onFiltersChange({ ...filters, [category]: updated })
  }

  const clearFilters = () => {
    if (onFiltersChange) {
      onFiltersChange({ campus: [], zonas: [], camaras: [], horas: [], dias_semana: [], desde: undefined, hasta: undefined })
    }
  }

  const hasActiveFilters = filters ? (
    Object.entries(filters).some(([_k, v]) => Array.isArray(v) ? v.length > 0 : v !== undefined && v !== '' && v !== 'all')
  ) : false

  const handleDateChange = (field: 'desde' | 'hasta', value: string) => {
    if (!filters || !onFiltersChange) return
    const updated = { ...filters, [field]: value || undefined }
    if (value && onIntervaloChange && intervalo !== '3650 days') {
      onIntervaloChange('3650 days')
    }
    onFiltersChange(updated)
  }

  const handleIntervaloChange = (value: IntervaloValue) => {
    if (!onIntervaloChange || !onFiltersChange || !filters) return
    onIntervaloChange(value)
    if (value !== '3650 days' && (filters.desde || filters.hasta)) {
      onFiltersChange({ ...filters, desde: undefined, hasta: undefined })
    }
  }

  const activeChips = useMemo(() => {
    if (!filters || !onFiltersChange) return []
    const chips: { label: string; onRemove: () => void }[] = []

    if (filters.desde) chips.push({ label: `↦ ${filters.desde}`, onRemove: () => onFiltersChange({ ...filters, desde: undefined }) })
    if (filters.hasta) chips.push({ label: `↤ ${filters.hasta}`, onRemove: () => onFiltersChange({ ...filters, hasta: undefined }) })

    const mat = ['7','8','9','10','11','12','13'].sort().join(',')
    const ves = ['14','15','16','17','18','19','20'].sort().join(',')
    const h = [...filters.horas].sort().join(',')
    if (h === mat)        chips.push({ label: 'Matutino', onRemove: () => onFiltersChange({ ...filters, horas: [] }) })
    else if (h === ves)   chips.push({ label: 'Vespertino', onRemove: () => onFiltersChange({ ...filters, horas: [] }) })
    else if (filters.horas.length > 0) chips.push({ label: `${filters.horas.length}h`, onRemove: () => onFiltersChange({ ...filters, horas: [] }) })

    filters.campus.forEach(v => chips.push({ label: v, onRemove: () => onFiltersChange({ ...filters, campus: filters.campus.filter(x => x !== v) }) }))
    filters.zonas.forEach(v => chips.push({ label: v, onRemove: () => onFiltersChange({ ...filters, zonas: filters.zonas.filter(x => x !== v) }) }))
    filters.camaras.forEach(v => chips.push({ label: v === 'usb_cam' ? 'USB Cam' : v, onRemove: () => onFiltersChange({ ...filters, camaras: filters.camaras.filter(x => x !== v) }) }))
    if (filters.smokingMode) chips.push({ label: 'Solo tabaquismo', onRemove: () => onFiltersChange({ ...filters, smokingMode: false }) })

    return chips
  }, [filters, onFiltersChange])

  const handleTimeModeChange = (mode: 'relativo' | 'personalizado') => {
    setTimeMode(mode)
    if (mode === 'relativo' && intervalo === '3650 days') {
      handleIntervaloChange('7 days')
    }
  }

  useEffect(() => {
    if (filters?.desde || filters?.hasta) setTimeMode('personalizado')
  }, [filters?.desde, filters?.hasta])

  return (
    <aside className={cn(
      "fixed top-0 left-0 bg-card border-r border-border h-screen flex flex-col z-30 transition-all duration-300",
      collapsed ? "w-16" : "w-64"
    )}>
      <div className={cn("shrink-0", collapsed ? "p-2 pt-3" : "p-4")}>

        {/* Collapse toggle — full row when collapsed */}
        {collapsed && (
          <button
            type="button"
            onClick={() => onCollapsedChange?.(!collapsed)}
            title="Expandir sidebar"
            className="w-full flex justify-center p-2 mb-2 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}

        {/* Logo row */}
        <div className={cn("flex items-center mb-5", collapsed ? "justify-center" : "justify-between")}>
          <a
            href="/"
            onClick={(e) => { e.preventDefault(); navigate('/') }}
            title={collapsed ? 'IDU Dashboard' : undefined}
            className={cn("flex items-center gap-2.5 group cursor-pointer", collapsed && "justify-center")}
          >
            <div className="w-8 h-8 rounded bg-primary flex items-center justify-center shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            </div>
            {!collapsed && (
              <div>
                <span className="text-sm font-bold text-foreground tracking-tight">IDU Dashboard</span>
                <p className="text-xs text-muted-foreground font-instrument leading-tight">ESCOM · IPN · v1.0.0</p>
              </div>
            )}
          </a>
          {!collapsed && (
            <button
              type="button"
              onClick={() => onCollapsedChange?.(!collapsed)}
              title="Contraer sidebar"
              className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Nav */}
        <div>
          {!collapsed && (
            <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-widest font-instrument">Módulos Analíticos</p>
          )}
          <nav className="space-y-0.5">
            {menuItems.map((item) => {
              const isActive = pathname === item.href
              return (
                <a
                  key={item.label}
                  href={item.href}
                  onClick={(e) => { e.preventDefault(); navigate(item.href) }}
                  onMouseEnter={() => setHoveredItem(item.label)}
                  onMouseLeave={() => setHoveredItem(null)}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    'w-full flex items-center gap-2.5 py-2 rounded text-sm font-medium transition-all duration-200',
                    collapsed ? 'justify-center px-2' : 'px-2.5',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                    hoveredItem === item.label && !isActive && !collapsed && 'translate-x-0.5',
                  )}
                >
                  <item.icon className="w-3.5 h-3.5 shrink-0" />
                  {!collapsed && <span>{item.label}</span>}
                </a>
              )
            })}
          </nav>
        </div>
      </div>

      {/* ── Filters (hidden when collapsed) ───────────── */}
      {!collapsed && filters && onFiltersChange && (
        <div className="flex-1 overflow-y-auto px-4 pb-6 pt-2 border-t border-border/50 custom-scrollbar">

          <div className="flex items-center justify-between mb-3 mt-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Filter className="w-3 h-3" />
              Filtros
              {activeChips.length > 0 && (
                <span className="bg-primary text-primary-foreground text-[11px] font-bold px-1.5 py-0.5 rounded-full min-w-[16px] text-center leading-none">
                  {activeChips.length}
                </span>
              )}
            </p>
            {hasActiveFilters && (
                <button onClick={clearFilters} className="text-xs text-muted-foreground hover:text-primary font-mono transition-colors">
                Limpiar todo
              </button>
            )}
          </div>

          {/* Active filter chips */}
          {activeChips.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-3 -mx-1 px-1">
              {activeChips.map((chip, i) => (
                <button key={i} onClick={chip.onRemove} className="filter-chip">
                  {chip.label}
                  <span className="filter-chip-remove"><X className="w-2 h-2" /></span>
                </button>
              ))}
            </div>
          )}

          <div className="space-y-5">

            {/* 0. MODO DE ANÁLISIS — primero siempre */}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Atom className="w-3 h-3" />
                Modo de Análisis
              </p>
              <button
                type="button"
                onClick={() => onFiltersChange({ ...filters, smokingMode: !filters.smokingMode })}
                aria-pressed={filters.smokingMode}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 rounded border text-xs font-medium font-instrument transition-all",
                  filters.smokingMode
                    ? 'bg-tobacco/10 text-tobacco border-tobacco/30 shadow-[0_0_8px_rgba(181,71,71,0.15)]'
                    : 'bg-secondary text-muted-foreground border-border hover:text-foreground hover:border-primary/40'
                )}
              >
                {filters.smokingMode ? <Cigarette className="w-3.5 h-3.5" /> : <CigaretteOff className="w-3.5 h-3.5" />}
                <span>{filters.smokingMode ? 'TABAQUISMO: ON' : 'Filtrar tabaquismo'}</span>
              </button>
            </div>

            {/* 1. VENTANA DE ANÁLISIS */}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Calendar className="w-3 h-3" />
                Ventana de Análisis
              </p>
              {/* Mode toggle */}
              <div className="flex rounded-md border border-border overflow-hidden mb-2.5">
                <button
                  type="button"
                  onClick={() => handleTimeModeChange('relativo')}
                  className={cn(
                    "flex-1 py-1.5 text-xs font-mono transition-colors",
                    timeMode === 'relativo'
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-muted-foreground hover:text-foreground"
                  )}
                >
                  Rápido
                </button>
                <button
                  type="button"
                  onClick={() => handleTimeModeChange('personalizado')}
                  className={cn(
                    "flex-1 py-1.5 text-xs font-mono border-l border-border transition-colors",
                    timeMode === 'personalizado'
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-muted-foreground hover:text-foreground"
                  )}
                >
                  Fechas
                </button>
              </div>

              {timeMode === 'relativo' && intervalo && onIntervaloChange && (
                <Select
                  value={intervalo === '3650 days' ? '7 days' : intervalo}
                  onValueChange={handleIntervaloChange}
                >
                  <SelectTrigger className="w-full h-8 text-xs font-mono bg-card">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INTERVALO_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value} className="text-xs font-mono">
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {timeMode === 'personalizado' && (
                <div className="flex flex-col gap-2 bg-secondary/50 rounded-md p-2 border border-border">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-muted-foreground shrink-0 w-5">De:</span>
                    <input
                      aria-label="Fecha inicial"
                      type="date"
                      value={filters.desde || ''}
                      onChange={(e) => handleDateChange('desde', e.target.value)}
                      className="w-full bg-card border border-border rounded px-2 py-1.5 text-xs font-mono text-foreground focus:outline-none min-h-[36px]"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-muted-foreground shrink-0 w-5">A:</span>
                    <input
                      aria-label="Fecha final"
                      type="date"
                      value={filters.hasta || ''}
                      onChange={(e) => handleDateChange('hasta', e.target.value)}
                      className="w-full bg-card border border-border rounded px-2 py-1.5 text-xs font-mono text-foreground focus:outline-none min-h-[36px]"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 2. TURNO ACADÉMICO */}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Clock className="w-3 h-3" />
                Turno Académico
              </p>
              <div className="flex gap-1.5">
                {[
                  { label: 'Todos', value: 'todos', horas: [] as string[] },
                  { label: 'Matutino', value: 'matutino', horas: ['7','8','9','10','11','12','13'] },
                  { label: 'Vespertino', value: 'vespertino', horas: ['14','15','16','17','18','19','20'] },
                ].map(preset => {
                  const isActive = preset.value === 'todos'
                    ? filters.horas.length === 0
                    : JSON.stringify([...filters.horas].sort()) === JSON.stringify([...preset.horas].sort())
                  return (
                    <button
                      type="button"
                      key={preset.value}
                      onClick={() => onFiltersChange({ ...filters, horas: preset.horas })}
                      className={cn(
                        "flex-1 text-xs py-2 rounded border font-mono transition-colors",
                        isActive
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border bg-secondary hover:border-primary/50 text-muted-foreground"
                      )}
                    >
                      {preset.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 3. UBICACIÓN */}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <MapPin className="w-3 h-3" />
                Ubicación
              </p>
              <FilterGroup
                title="Campus"
                icon={Building2}
                options={availableCampus}
                selected={filters?.campus || []}
                onChange={(v) => toggleFilter('campus', v)}
              />
              <FilterGroup
                title="Zona"
                icon={Wind}
                options={availableZonas}
                selected={filters.zonas}
                onChange={(v) => toggleFilter('zonas', v)}
              />
              <FilterGroup
                title="Cámara"
                icon={Camera}
                options={availableCamaras}
                selected={filters.camaras}
                onChange={(v) => toggleFilter('camaras', v)}
              />
            </div>

          </div>

        </div>
      )}

      {/* Collapsed: smoking mode icon pinned at bottom */}
      {collapsed && filters && onFiltersChange && (
        <div className="mt-auto p-2 border-t border-border/50">
          <button
            type="button"
            onClick={() => onFiltersChange({ ...filters, smokingMode: !filters.smokingMode })}
            title={filters.smokingMode ? 'Modo Tabaquismo: ON' : 'Modo Tabaquismo: OFF'}
            className={cn(
              "w-full flex items-center justify-center p-2 rounded border transition-all",
              filters.smokingMode
                ? 'bg-tobacco/10 text-tobacco border-tobacco/30'
                : 'bg-secondary text-muted-foreground border-border hover:border-primary/40'
            )}
          >
            {filters.smokingMode ? <Cigarette className="w-4 h-4" /> : <CigaretteOff className="w-4 h-4" />}
          </button>
        </div>
      )}

    </aside>
  )
}
