import { useState } from 'react'
import { useSnapshot } from '../../features/snapshots/useSnapshot'
import type { ScientificSnapshot } from '../../features/snapshots/snapshot.types'

export interface SaveSnapshotButtonProps {
  /** Current state to freeze into the snapshot */
  currentState: Omit<ScientificSnapshot, 'id' | 'createdAt'>
}

/**
 * SaveSnapshotButton
 * Allows the researcher to freeze the current analytical state into a reproducible record.
 */
export function SaveSnapshotButton({ currentState }: SaveSnapshotButtonProps) {
  const { saveSnapshot } = useSnapshot()
  const [saved, setSaved] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const [notes, setNotes] = useState('')

  const handleSave = () => {
    const state = { ...currentState, description: notes || undefined }
    saveSnapshot(state)
    setSaved(true)
    setShowNotes(false)
    setNotes('')
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div className="relative inline-flex items-center gap-2">
      {showNotes && (
        <div className="absolute bottom-full right-0 mb-2 bg-card border border-border rounded-lg shadow-xl p-3 w-72 z-50">
          <label className="text-[10px] font-bold text-foreground uppercase tracking-wider block mb-1.5">
            Nota metodológica (opcional)
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Ej: Análisis exploratorio durante midterms 2026..."
            className="w-full h-16 text-xs bg-secondary/30 border border-border rounded p-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <div className="flex justify-end gap-2 mt-2">
            <button
              onClick={() => setShowNotes(false)}
              className="text-[10px] px-2 py-1 text-muted-foreground hover:text-foreground"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              className="text-[10px] px-3 py-1 bg-primary text-primary-foreground rounded-md font-medium hover:opacity-90"
            >
              Guardar registro
            </button>
          </div>
        </div>
      )}

      <button
        onClick={() => setShowNotes(!showNotes)}
        disabled={saved}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-all ${
          saved
            ? 'bg-green-500/10 border-green-500/30 text-green-600'
            : 'bg-card border-border text-foreground hover:bg-secondary/50'
        }`}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/></svg>
        {saved ? 'Registro guardado' : 'Guardar registro'}
      </button>
    </div>
  )
}
