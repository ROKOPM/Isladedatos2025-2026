import { useState, useEffect, useCallback } from 'react'
import { snapshotStorage } from './snapshot.storage'
import type { ScientificSnapshot } from './snapshot.types'

export function useSnapshot() {
  const [snapshots, setSnapshots] = useState<ScientificSnapshot[]>([])

  const loadSnapshots = useCallback(() => {
    setSnapshots(snapshotStorage.getAll())
  }, [])

  useEffect(() => {
    loadSnapshots()
  }, [loadSnapshots])

  const saveSnapshot = useCallback((data: Omit<ScientificSnapshot, 'id' | 'createdAt'>) => {
    const newSnapshot = snapshotStorage.save(data)
    loadSnapshots()
    return newSnapshot
  }, [loadSnapshots])

  const deleteSnapshot = useCallback((id: string) => {
    snapshotStorage.delete(id)
    loadSnapshots()
  }, [loadSnapshots])

  const exportSnapshot = useCallback((id: string) => {
    snapshotStorage.exportToJSON(id)
  }, [])

  return {
    snapshots,
    saveSnapshot,
    deleteSnapshot,
    exportSnapshot
  }
}
