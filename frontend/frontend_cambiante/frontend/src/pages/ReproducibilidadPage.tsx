import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Copy,
  Database,
  FileCode2,
  FileText,
  GitBranch,
  Loader2,
  LockKeyhole,
  RefreshCw,
  Route,
  Save,
  Shield,
  type LucideIcon,
} from 'lucide-react'
import { fetchSnapshots, validateSnapshot, createSnapshot, generateMethodology } from '@/api/client'
import { useSistema } from '@/hooks/queries'
import { Button } from '@/components/ui/button'
import type { GlobalFilters, IntervaloValue } from '@/types'

interface Props {
  filters: GlobalFilters
  intervalo: IntervaloValue
}

type ApiRecord = Record<string, unknown>

interface SnapshotRecord {
  uuid: string
  created_at: string
  query_hash?: string
  user_notes?: string
  filters_json?: Record<string, unknown>
  metadata_json?: Record<string, unknown>
}

interface WarningCard {
  level: 'info' | 'warning' | 'critical'
  title: string
  body: string
}

function asRecord(value: unknown): ApiRecord {
  return value && typeof value === 'object' ? value as ApiRecord : {}
}

function normalizeSnapshots(value: unknown): SnapshotRecord[] {
  return Array.isArray(value) ? value.filter(Boolean).map((item) => asRecord(item) as unknown as SnapshotRecord) : []
}

function shortId(value?: string, head = 8, tail = 4): string {
  if (!value) return 'n/d'
  if (value.length <= head + tail + 3) return value
  return `${value.slice(0, head)}...${value.slice(-tail)}`
}

function formatDate(value?: string): string {
  if (!value) return 'Sin fecha'
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Mexico_City',
  }).format(new Date(value))
}

function formatInterval(intervalo: string): string {
  return intervalo
    .replace(' days', ' días')
    .replace(' day', ' día')
    .replace(' hours', ' horas')
    .replace(' hour', ' hora')
}

function displayNote(note?: string): string {
  const clean = (note ?? '').trim()
  const normalized = clean.toLowerCase().replace(/\s+/g, '')
  const invalidNotes = new Set(['', 'sadsada', 'asdf', 'test', 'testing', 'prueba', 'lorem', 'informe'])
  if (invalidNotes.has(normalized)) return 'Sin notas registradas.'
  if (clean.length < 4) return 'Sin notas registradas.'
  return clean
}

function displayTechnicalId(value?: string): string {
  if (!value || value === 'unknown_hash') return 'No disponible'
  return value
}

function filterSummary(filters: GlobalFilters, intervalo: IntervaloValue): string[] {
  const parts = [`Periodo: ${formatInterval(intervalo)}`]
  if (filters.campus.length) parts.push(`Campus: ${filters.campus.join(', ')}`)
  if (filters.zonas.length) parts.push(`Zonas: ${filters.zonas.join(', ')}`)
  if (filters.camaras.length) parts.push(`Cámaras: ${filters.camaras.join(', ')}`)
  if (filters.dias_semana.length) parts.push(`Días: ${filters.dias_semana.join(', ')}`)
  if (filters.horas.length) parts.push(`Horas: ${filters.horas.join(', ')}`)
  if (filters.smokingMode) parts.push('Filtro de fumado activo')
  if (filters.desde || filters.hasta) parts.push(`Fechas: ${filters.desde ?? 'inicio'} a ${filters.hasta ?? 'actual'}`)
  return parts
}

function copyText(value?: string) {
  if (!value || !navigator.clipboard) return
  void navigator.clipboard.writeText(value)
}

function StepCard({
  icon: Icon,
  title,
  body,
  tone = 'neutral',
}: {
  icon: LucideIcon
  title: string
  body: string
  tone?: 'neutral' | 'ok' | 'warn'
}) {
  const toneClass = tone === 'ok'
    ? 'bg-primary/10 text-primary border-primary/20'
    : tone === 'warn'
      ? 'bg-warning/10 text-warning border-warning/30'
      : 'bg-secondary text-muted-foreground border-border'

  return (
    <div className="rounded border border-border bg-background/65 p-3">
      <div className={`w-9 h-9 rounded-full border flex items-center justify-center ${toneClass}`}>
        <Icon className="w-4 h-4" />
      </div>
      <h4 className="text-sm font-semibold text-foreground mt-3">{title}</h4>
      <p className="text-xs text-muted-foreground leading-relaxed mt-1">{body}</p>
    </div>
  )
}

export function ReproducibilidadPage({ filters, intervalo }: Props) {
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [validating, setValidating] = useState<string | null>(null)
  const [validationResult, setValidationResult] = useState<ApiRecord | null>(null)
  const [notes, setNotes] = useState('')
  const [creating, setCreating] = useState(false)
  const [createResult, setCreateResult] = useState<'ok' | 'error' | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showTechnical, setShowTechnical] = useState(false)
  const [showMethodology, setShowMethodology] = useState(false)
  const [generatingMethodology, setGeneratingMethodology] = useState(false)
  const [methodologyResult, setMethodologyResult] = useState<string | null>(null)
  const [methodologyError, setMethodologyError] = useState(false)

  const sistema = useSistema()

  const loadSnapshots = async () => {
    setLoading(true)
    try {
      const res = await fetchSnapshots()
      setSnapshots(normalizeSnapshots(asRecord(res).data))
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadSnapshots()
  }, [])

  const latestSnapshot = snapshots[0]
  const activeFilters = useMemo(() => filterSummary(filters, intervalo), [filters, intervalo])
  const allPipelinesDone = sistema.data?.capas?.every(c => c.pendientes === 0) ?? false
  const completedRecords = sistema.data?.capas?.reduce((a, c) => a + c.completados, 0) ?? 0
  const pendingRecords = sistema.data?.capas?.reduce((a, c) => a + c.pendientes, 0) ?? 0

  const warnings: WarningCard[] = [
    ...(!allPipelinesDone ? [{
      level: 'warning' as const,
      title: 'Integración de observaciones en progreso',
      body: 'El sistema continúa incorporando nuevas observaciones. Los resultados podrían cambiar ligeramente mientras termina la actualización.',
    }] : []),
    ...(snapshots.length === 0 ? [{
      level: 'info' as const,
      title: 'Sin registro reproducible',
      body: 'Guarda un registro antes de reportar resultados para que el análisis pueda verificarse después.',
    }] : []),
    ...(sistema.isError ? [{
      level: 'critical' as const,
      title: 'Estado del sistema no disponible',
      body: 'No fue posible consultar el estado de procesamiento. La validación puede quedar incompleta.',
    }] : []),
  ]

  const handleCreate = async () => {
    setCreating(true)
    setCreateResult(null)
    try {
      await createSnapshot({
        filters_json: { ...filters, intervalo },
        user_notes: notes.trim(),
        metadata_json: { captured_at: new Date().toISOString(), intervalo },
      })
      setCreateResult('ok')
      setNotes('')
      setShowCreate(false)
      await loadSnapshots()
    } catch (e) {
      console.error(e)
      setCreateResult('error')
    } finally {
      setCreating(false)
    }
  }

  const handleValidate = async (uuid: string) => {
    setValidating(uuid)
    setValidationResult(null)
    try {
      const res = await validateSnapshot(uuid)
      setValidationResult({ uuid, ...asRecord(asRecord(res).data) })
    } catch (e) {
      console.error(e)
      setValidationResult({ uuid, status: 'error' })
    } finally {
      setValidating(null)
    }
  }

  const handleGenerateMethodology = async () => {
    setGeneratingMethodology(true)
    setMethodologyError(false)
    setMethodologyResult(null)
    setShowMethodology(true)
    try {
      const res = await generateMethodology({
        filters_json: { ...filters, intervalo },
        modelo: null,
      })
      const payload = asRecord(res)
      const text =
        payload.texto ??
        payload.methodology ??
        payload.contenido ??
        (typeof res === 'string' ? res : JSON.stringify(res, null, 2))
      setMethodologyResult(String(text))
    } catch (e) {
      console.error(e)
      setMethodologyError(true)
    } finally {
      setGeneratingMethodology(false)
    }
  }

  const validationOk = validationResult?.status === 'success' && validationResult?.is_valid === true
  const validationFailed = validationResult?.status === 'error'
  const validationMismatch = Boolean(validationResult) && !validationOk && !validationFailed
  const lineageSteps = [
    ['Captura', 'Observaciones visuales registradas por cámaras en puntos de observación.'],
    ['Procesamiento visual', 'Inferencia multimodal para actividad, presencia, contexto social y señales de fumado.'],
    ['Integración ambiental', 'Cruce con mediciones ambientales y metadatos temporales.'],
    ['Análisis estadístico', 'Métricas agregadas, PCA + K-Means cuando aplica y cálculos descriptivos.'],
    ['Resultado verificable', 'Visualización, registro reproducible y validación.'],
  ]

  return (
    <div className="space-y-5 animate-fade-in pb-10">
      <div className="sci-panel bg-secondary/20">
        <div className="p-5 flex flex-col lg:flex-row lg:items-center gap-5">
          <div className="w-12 h-12 rounded bg-primary/10 flex items-center justify-center shrink-0 border border-primary/20">
            <Shield className="w-6 h-6 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-editorial font-bold text-foreground">Motor de Reproducibilidad Científica</h2>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed max-w-3xl">
              Guarda una evidencia del análisis actual y permite verificar después si el resultado puede reconstruirse con los mismos filtros.
            </p>
            <div className="flex flex-wrap gap-1.5 mt-3">
              {activeFilters.slice(0, 4).map((item) => (
                <span key={item} className="rounded border border-border bg-background/70 px-2 py-1 text-[11px] text-muted-foreground">
                  {item}
                </span>
              ))}
              {activeFilters.length > 4 && (
                <span className="rounded border border-border bg-background/70 px-2 py-1 text-[11px] text-muted-foreground">
                  +{activeFilters.length - 4} filtros
                </span>
              )}
            </div>
          </div>
          <Button onClick={() => setShowCreate(true)} className="gap-1.5 shrink-0">
            <Save className="w-4 h-4" />
            Guardar registro reproducible
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StepCard
          icon={latestSnapshot ? CheckCircle2 : LockKeyhole}
          title={latestSnapshot ? 'Evidencia guardada' : 'Sin registro guardado'}
          body={latestSnapshot ? `Último registro: ${formatDate(latestSnapshot.created_at)}.` : 'Guarda el análisis actual antes de usarlo como evidencia.'}
          tone={latestSnapshot ? 'ok' : 'warn'}
        />
        <StepCard
          icon={ClipboardCheck}
          title={validationOk ? 'Validación confirmada' : 'Validación disponible'}
          body={validationOk ? 'El resultado reconstruido coincide con el registro original.' : 'Verifica un registro para comprobar si sigue siendo válido.'}
          tone={validationOk ? 'ok' : 'neutral'}
        />
        <StepCard
          icon={GitBranch}
          title="Linaje auditable"
          body={`${completedRecords.toLocaleString('es-MX')} registros completados${pendingRecords > 0 ? `, ${pendingRecords.toLocaleString('es-MX')} pendientes` : ''}.`}
          tone={pendingRecords > 0 ? 'warn' : 'ok'}
        />
      </div>

      <div className="sci-panel">
        <div className="sci-panel-header">
          <h3 className="font-editorial text-base font-bold text-foreground">Cómo usar esta herramienta</h3>
          <p className="text-xs text-muted-foreground mt-1">Sigue estos pasos para convertir un análisis filtrado en evidencia verificable.</p>
        </div>
        <div className="p-4 grid grid-cols-1 md:grid-cols-4 gap-2">
          {[
            ['1', 'Aplica filtros', 'Define periodo, campus o zona desde los filtros globales.', null],
            ['2', 'Guarda evidencia', 'Crea un registro reproducible con los filtros actuales.', 'Guardar registro'],
            ['3', 'Verifica después', 'Usa “Verificar evidencia” para reconstruir y comparar el resultado.', null],
            ['4', 'Lee el dictamen', 'Válido significa que el resultado coincide con el registro original.', null],
          ].map(([num, title, body, action], i) => (
            <div key={title} className="relative rounded border border-border bg-background/60 p-3 min-h-[144px]">
              <div className="w-7 h-7 rounded-full bg-primary/10 text-primary border border-primary/20 flex items-center justify-center text-xs font-semibold">
                {num}
              </div>
              <p className="text-sm font-semibold text-foreground mt-3">{title}</p>
              <p className="text-xs text-muted-foreground leading-relaxed mt-1">{body}</p>
              {action && (
                <Button size="sm" className="h-8 text-xs mt-3" onClick={() => setShowCreate(true)}>
                  {action}
                </Button>
              )}
              {i < 3 && <div className="hidden md:block absolute top-7 -right-2 w-4 h-px bg-border" />}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.2fr] gap-4">
        <div className="sci-panel">
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="sci-panel-header w-full text-left flex items-center justify-between hover:bg-secondary/30 transition-colors"
            aria-expanded={showCreate}
          >
            <div className="flex items-start gap-3">
              <FileText className="w-4 h-4 text-primary mt-0.5" />
              <div>
                <h3 className="font-editorial text-base font-bold text-foreground">Registro reproducible</h3>
                <p className="text-xs text-muted-foreground">Guarda filtros y contexto para auditoría posterior.</p>
              </div>
            </div>
            {showCreate ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </button>

          <div className="p-4 space-y-3 border-t border-border">
            {latestSnapshot ? (
              <div className="rounded border border-primary/20 bg-primary/5 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Último registro</p>
                    <p className="text-sm font-semibold text-foreground mt-1">{shortId(latestSnapshot.uuid, 10, 6)}</p>
                    <p className="text-xs text-muted-foreground mt-1">{formatDate(latestSnapshot.created_at)} · CDMX</p>
                  </div>
                  <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => copyText(latestSnapshot.uuid)}>
                    <Copy className="w-3.5 h-3.5" />
                    Copiar ID
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-3 leading-relaxed">{displayNote(latestSnapshot.user_notes)}</p>
              </div>
            ) : (
              <div className="rounded border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
                Aún no hay registro para los filtros actuales. Guarda el análisis antes de usarlo como evidencia reportable.
              </div>
            )}

            {showCreate && (
              <div className="space-y-3">
                <div className="rounded border border-border bg-secondary/30 p-3">
                  <p className="text-xs font-semibold text-foreground mb-2">Se preservará este contexto</p>
                  <div className="flex flex-wrap gap-1.5">
                    {activeFilters.map((item) => (
                      <span key={item} className="rounded bg-background border border-border px-2 py-1 text-[11px] text-muted-foreground">{item}</span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <label className="sr-only" htmlFor="snapshot-notes">Notas del registro reproducible</label>
                  <input
                    id="snapshot-notes"
                    type="text"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Notas breves: informe, tesis, corte temporal..."
                    className="flex-1 text-sm bg-background border border-border rounded px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    onKeyDown={e => e.key === 'Enter' && !creating && void handleCreate()}
                    disabled={creating}
                  />
                  <Button onClick={handleCreate} disabled={creating} size="sm" className="gap-1.5">
                    {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    {creating ? 'Guardando...' : 'Guardar registro'}
                  </Button>
                </div>
              </div>
            )}

            {createResult === 'ok' && (
              <p className="text-xs text-primary flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Registro guardado correctamente.
              </p>
            )}
            {createResult === 'error' && (
              <p className="text-xs text-destructive flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                No fue posible guardar el registro.
              </p>
            )}
          </div>
        </div>

        <div className="sci-panel">
          <div className="sci-panel-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-start gap-3">
              <ClipboardCheck className="w-4 h-4 text-primary mt-0.5" />
              <div>
                <h3 className="font-editorial text-base font-bold text-foreground">Validación reproducible</h3>
                <p className="text-xs text-muted-foreground">Reconstruye un registro y verifica si el resultado coincide.</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={loadSnapshots} disabled={loading} className="h-8 text-xs gap-1.5">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Actualizar
            </Button>
          </div>

          <div className="p-4 border-t border-border">
            {loading ? (
              <div className="py-10 flex items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Cargando registros...</span>
              </div>
            ) : snapshots.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground">
                <Database className="w-8 h-8 mx-auto opacity-30 mb-2" />
                <p className="text-sm">No hay registros para validar.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {snapshots.slice(0, showHistory ? 8 : 3).map((snapshot) => (
                  <div key={snapshot.uuid} className="rounded border border-border bg-background/60 p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">{shortId(snapshot.uuid, 10, 6)}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        <Calendar className="inline w-3 h-3 mr-1" />
                        {formatDate(snapshot.created_at)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1 truncate">{displayNote(snapshot.user_notes)}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => copyText(snapshot.uuid)}>
                        <Copy className="w-3.5 h-3.5" />
                        Copiar ID
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        className="h-8 text-xs gap-1.5"
                        onClick={() => handleValidate(snapshot.uuid)}
                        disabled={validating === snapshot.uuid}
                      >
                        {validating === snapshot.uuid ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ClipboardCheck className="w-3.5 h-3.5" />}
                        {validating === snapshot.uuid ? 'Verificando...' : 'Verificar evidencia'}
                      </Button>
                    </div>
                  </div>
                ))}
                {snapshots.length > 3 && (
                  <button
                    type="button"
                    onClick={() => setShowHistory((v) => !v)}
                    className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                  >
                    {showHistory ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    {showHistory ? 'Mostrar menos' : `Ver ${snapshots.length - 3} registros más`}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {validationResult && (
        <div className={`sci-panel ${validationOk ? 'bg-primary/5 border-primary/20' : validationMismatch ? 'bg-warning/5 border-warning/25' : 'bg-destructive/5 border-destructive/25'}`}>
          <div className="p-4 flex items-start gap-3">
            {validationOk ? <CheckCircle2 className="w-5 h-5 text-primary mt-0.5" /> : <AlertTriangle className={`w-5 h-5 mt-0.5 ${validationMismatch ? 'text-warning' : 'text-destructive'}`} />}
            <div className="min-w-0">
              <h3 className="font-editorial text-base font-bold text-foreground">
                {validationOk
                  ? 'Resultado verificable'
                  : validationMismatch
                    ? 'El resultado no coincide con el registro original'
                    : 'No fue posible completar la validación'}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                {validationOk
                  ? 'Los datos reconstruidos coinciden con el registro original. La evidencia es verificable.'
                  : validationMismatch
                    ? 'La reconstrucción encontró diferencias. Revisa si cambiaron filtros, datos o configuración antes de reportar el resultado.'
                    : 'El registro solicitado no se pudo reconstruir. Verifica que exista y vuelve a intentar.'}
              </p>
              <p className="text-xs text-muted-foreground mt-2">Registro: {shortId(String(validationResult.uuid ?? ''), 10, 6)}</p>
            </div>
          </div>
        </div>
      )}

      <div className="sci-panel">
        <div className="sci-panel-header flex items-start gap-3">
          <Route className="w-4 h-4 text-primary mt-0.5" />
          <div>
            <h3 className="font-editorial text-base font-bold text-foreground">Linaje de datos</h3>
            <p className="text-xs text-muted-foreground">Procedencia metodológica desde la captura hasta el resultado verificable.</p>
          </div>
        </div>
        <div className="p-4 grid grid-cols-1 md:grid-cols-5 gap-2">
          {lineageSteps.map(([title, body], index) => (
            <div key={title} className="relative rounded border border-border bg-background/60 p-3 min-h-[132px]">
              <div className="w-7 h-7 rounded-full bg-primary/10 text-primary border border-primary/20 flex items-center justify-center text-xs font-semibold">
                {index + 1}
              </div>
              <h4 className="text-sm font-semibold text-foreground mt-3">{title}</h4>
              <p className="text-xs text-muted-foreground leading-relaxed mt-1">{body}</p>
              {index < lineageSteps.length - 1 && <div className="hidden md:block absolute top-6 -right-2 w-4 h-px bg-border" />}
            </div>
          ))}
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="sci-panel">
          <div className="sci-panel-header flex items-start gap-3">
            <Shield className="w-4 h-4 text-primary mt-0.5" />
            <div>
              <h3 className="font-editorial text-base font-bold text-foreground">Advertencias científicas</h3>
              <p className="text-xs text-muted-foreground">Condiciones que pueden afectar la interpretación o la fuerza de la evidencia.</p>
            </div>
          </div>
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
            {warnings.map((warning) => (
              <div
                key={warning.title}
                className={`rounded border p-3 ${
                  warning.level === 'critical'
                    ? 'bg-destructive/10 border-destructive/30 text-destructive'
                    : warning.level === 'warning'
                      ? 'bg-warning/10 border-warning/30 text-warning'
                      : 'bg-primary/10 border-primary/25 text-primary'
                }`}
              >
                <div className="flex items-center gap-2">
                  {warning.level === 'critical' ? <AlertTriangle className="w-4 h-4" /> : warning.level === 'warning' ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                  <h4 className="text-sm font-semibold">{warning.title}</h4>
                </div>
                <p className="text-xs leading-relaxed mt-2 opacity-90">{warning.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="sci-panel">
        <div className="sci-panel-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-3">
            <FileCode2 className="w-4 h-4 text-primary mt-0.5" />
            <div>
              <h3 className="font-editorial text-base font-bold text-foreground">Metodología reproducible</h3>
              <p className="text-xs text-muted-foreground">Texto base para informes, tesis o anexos metodológicos.</p>
            </div>
          </div>
          <Button onClick={handleGenerateMethodology} disabled={generatingMethodology} size="sm" className="gap-1.5 text-xs">
            {generatingMethodology ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileCode2 className="w-3.5 h-3.5" />}
            {generatingMethodology ? 'Generando...' : 'Generar metodología'}
          </Button>
        </div>
        <div className="p-4 border-t border-border">
          {!showMethodology ? (
            <p className="text-sm text-muted-foreground leading-relaxed">
              La metodología se construye a partir de filtros activos, configuración del análisis y estado de datos. Es un punto de partida revisable, no una afirmación causal.
            </p>
          ) : generatingMethodology ? (
            <div className="py-8 flex items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Redactando metodología...</span>
            </div>
          ) : methodologyError ? (
            <div className="rounded border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              No fue posible generar la metodología. Reintenta cuando el servicio esté disponible.
            </div>
          ) : methodologyResult ? (
            <div className="space-y-3">
              <div className="rounded border border-border bg-secondary/25 p-4 max-h-80 overflow-y-auto">
                <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{methodologyResult}</p>
              </div>
              <p className="text-xs text-muted-foreground">Revisa el texto antes de incorporarlo a un informe. El sistema describe evidencia observacional y no causal.</p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="sci-panel">
        <button
          type="button"
          onClick={() => setShowTechnical((v) => !v)}
          className="sci-panel-header w-full text-left flex items-center justify-between hover:bg-secondary/30 transition-colors"
          aria-expanded={showTechnical}
        >
          <div className="flex items-start gap-3">
            <Database className="w-4 h-4 text-muted-foreground mt-0.5" />
            <div>
              <h3 className="font-editorial text-base font-bold text-foreground">Detalles técnicos avanzados</h3>
              <p className="text-xs text-muted-foreground">Identificadores completos, configuración y estado de capas.</p>
            </div>
          </div>
          {showTechnical ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>
        {showTechnical && (
          <div className="p-4 border-t border-border space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {snapshots.slice(0, 4).map((snapshot) => (
                <div key={snapshot.uuid} className="rounded border border-border bg-background/60 p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-foreground">Registro reproducible</span>
                    <button type="button" onClick={() => copyText(snapshot.uuid)} className="text-muted-foreground hover:text-foreground">
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="font-mono text-muted-foreground break-all mt-2">{displayTechnicalId(snapshot.uuid)}</p>
                  {snapshot.query_hash && (
                    <p className="font-mono text-muted-foreground break-all mt-2">Identificador: {displayTechnicalId(snapshot.query_hash)}</p>
                  )}
                </div>
              ))}
            </div>
            {sistema.data?.capas && (
              <div className="rounded border border-border bg-background/60 p-3">
                <p className="text-xs font-semibold text-foreground mb-2">Estado de capas de procesamiento</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {sistema.data.capas.map((capa, index) => (
                    <div key={`${capa.nombre}-${index}`} className="rounded bg-secondary/40 p-2 text-xs">
                      <p className="font-semibold text-foreground">{capa.nombre}</p>
                      <p className="text-muted-foreground mt-1">
                        {capa.completados.toLocaleString('es-MX')} completados · {capa.pendientes.toLocaleString('es-MX')} pendientes
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
