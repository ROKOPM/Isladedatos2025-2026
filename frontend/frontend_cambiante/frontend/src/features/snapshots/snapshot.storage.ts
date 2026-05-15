import type { ScientificSnapshot } from './snapshot.types'

const STORAGE_KEY = 'isla_scientific_snapshots_v1'

export const snapshotStorage = {
  save(snapshot: Omit<ScientificSnapshot, 'id' | 'createdAt'>): ScientificSnapshot {
    const snapshots = this.getAll()
    const newSnapshot: ScientificSnapshot = {
      ...snapshot,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString()
    }
    
    snapshots.unshift(newSnapshot)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots.slice(0, 50))) // Keep last 50
    return newSnapshot
  },

  getAll(): ScientificSnapshot[] {
    try {
      const data = localStorage.getItem(STORAGE_KEY)
      return data ? JSON.parse(data) : []
    } catch {
      return []
    }
  },

  getById(id: string): ScientificSnapshot | undefined {
    return this.getAll().find(s => s.id === id)
  },

  delete(id: string): void {
    const snapshots = this.getAll().filter(s => s.id !== id)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots))
  },

  exportToJSON(id: string): void {
    const snapshot = this.getById(id)
    if (!snapshot) return

    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `isla_snapshot_${snapshot.createdAt.split('T')[0]}_${snapshot.id.substring(0,6)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }
}
