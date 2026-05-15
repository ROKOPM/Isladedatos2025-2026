import { useSnapshot } from '../../features/snapshots/useSnapshot'

/**
 * SnapshotHistoryPanel
 * Lists previously saved scientific snapshots with export and restore actions.
 */
export function SnapshotHistoryPanel() {
  const { snapshots, deleteSnapshot, exportSnapshot } = useSnapshot()

  if (snapshots.length === 0) {
    return (
      <div className="bg-card border border-border rounded-lg p-4 text-center">
        <p className="text-xs text-muted-foreground">Sin registros científicos guardados.</p>
        <p className="text-xs text-muted-foreground mt-1">
          Usa "Guardar registro" para preservar un estado analítico reproducible.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Historial de registros ({snapshots.length})
        </h3>
      </div>

      <ul className="divide-y divide-border max-h-80 overflow-y-auto">
        {snapshots.map(snap => (
          <li key={snap.id} className="px-4 py-3 hover:bg-secondary/20 transition-colors">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground truncate">
                  {snap.name || 'Análisis sin título'}
                </p>
                <p className="text-xs font-mono text-muted-foreground mt-0.5">
                  {new Date(snap.createdAt).toLocaleString('es-MX')} · N={snap.sampleSize.toLocaleString()}
                </p>
                {snap.description && (
                  <p className="text-xs text-muted-foreground mt-1 italic truncate">{snap.description}</p>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => exportSnapshot(snap.id)}
                  title="Exportar JSON"
                  className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-secondary/50"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </button>
                <button
                  onClick={() => deleteSnapshot(snap.id)}
                  title="Eliminar"
                  className="p-1.5 text-muted-foreground hover:text-destructive rounded-md hover:bg-destructive/10"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
