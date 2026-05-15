import { useState } from 'react'
import { FileText, Loader2, CheckCircle, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { GlobalFilters, IntervaloValue } from '@/types'

interface ReportButtonProps {
  filters?: GlobalFilters
  intervalo?: IntervaloValue
}

function buildParams(filters?: GlobalFilters, intervalo?: IntervaloValue): string {
  const params = new URLSearchParams()
  if (intervalo) params.set('intervalo', intervalo)
  if (filters?.desde) params.set('desde', filters.desde)
  if (filters?.hasta) params.set('hasta', filters.hasta)
  if (filters?.campus?.length) params.set('campus', filters.campus.join(','))
  if (filters?.zonas?.length) params.set('zonas', filters.zonas.join(','))
  if (filters?.camaras?.length) params.set('camaras', filters.camaras.join(','))
  return params.toString()
}

export function PdfReportButton({ filters, intervalo }: ReportButtonProps) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done'>('idle')

  const handleGenerate = () => {
    setStatus('loading')
    const qs = buildParams(filters, intervalo)
    const url = `/api/export-pdf/?${qs}`

    fetch(url, { method: 'GET' })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.blob()
      })
      .then(blob => {
        const blobUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = blobUrl
        a.download = `IDU_Reporte_${new Date().toISOString().slice(0, 10)}.pdf`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(blobUrl)
        setStatus('done')
        setTimeout(() => setStatus('idle'), 2500)
      })
      .catch(err => {
        console.error('PDF export error:', err)
        window.open(url, '_blank')
        setStatus('done')
        setTimeout(() => setStatus('idle'), 2500)
      })
  }

  return (
    <Button
      variant="default"
      size="sm"
      className="h-8 text-xs font-mono shadow-md gap-2"
      onClick={handleGenerate}
      disabled={status === 'loading'}
    >
      {status === 'loading' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      {status === 'done' && <CheckCircle className="w-3.5 h-3.5 text-green-400" />}
      {status === 'idle' && <FileText className="w-3.5 h-3.5" />}
      {status === 'loading' ? 'Generando...' : status === 'done' ? '¡Descargado!' : 'Reporte PDF'}
    </Button>
  )
}

export function CsvDownloadButton({ filters, intervalo }: ReportButtonProps) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done'>('idle')

  const handleDownload = () => {
    setStatus('loading')
    const qs = buildParams(filters, intervalo)
    const url = `/api/export-csv/?${qs}`

    fetch(url, { method: 'GET' })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.blob()
      })
      .then(blob => {
        const blobUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = blobUrl
        a.download = `IDU_Datos_${new Date().toISOString().slice(0, 10)}.csv`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(blobUrl)
        setStatus('done')
        setTimeout(() => setStatus('idle'), 2500)
      })
      .catch(err => {
        console.error('CSV export error:', err)
        window.open(url, '_blank')
        setStatus('done')
        setTimeout(() => setStatus('idle'), 2500)
      })
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 text-xs font-mono gap-2"
      onClick={handleDownload}
      disabled={status === 'loading'}
    >
      {status === 'loading' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      {status === 'done' && <CheckCircle className="w-3.5 h-3.5 text-green-500" />}
      {status === 'idle' && <Download className="w-3.5 h-3.5" />}
      {status === 'loading' ? 'Exportando...' : status === 'done' ? '¡Listo!' : 'Exportar CSV'}
    </Button>
  )
}
