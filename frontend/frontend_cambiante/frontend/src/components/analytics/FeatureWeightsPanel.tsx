import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { FlaskConical, RotateCcw, AlertTriangle } from 'lucide-react'
import type { FeatureGroup, FeatureWeights } from '@/types'
import {
  DEFAULT_FEATURE_WEIGHTS,
  FEATURE_GROUP_LABELS,
  FEATURE_GROUP_DESC,
  WEIGHT_OPTIONS,
} from '@/types'

interface Props {
  onGenerate: (weights: FeatureWeights) => void
  onReset: () => void
  isLoading: boolean
  filtersChanged: boolean
  isCustom: boolean
}

export function FeatureWeightsPanel({ onGenerate, onReset, isLoading, filtersChanged, isCustom }: Props) {
  const [weights, setWeights] = useState<FeatureWeights>({ ...DEFAULT_FEATURE_WEIGHTS })

  const groups: FeatureGroup[] = ['actividad', 'postura', 'interaccion', 'riesgo', 'fumando', 'ambiental', 'turno']

  const setWeight = (group: FeatureGroup, value: number) => {
    setWeights((prev) => ({ ...prev, [group]: value }))
  }

  const allZero = groups.every((g) => weights[g] === 0)

  return (
    <div className="sci-panel h-full flex flex-col">
      <div className="sci-panel-header flex items-center gap-2 px-4 py-3 border-b border-border">
        <FlaskConical className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium">Ajustar variables</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
        <p className="text-[10px] font-instrument text-muted-foreground leading-relaxed">
          Selecciona qué grupos de variables usar y su peso relativo en el agrupamiento.
          Peso 0 = grupo desactivado.
        </p>

        {groups.map((group) => (
          <div key={group} className="space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium">{FEATURE_GROUP_LABELS[group]}</span>
                <span className="text-[10px] font-mono text-muted-foreground opacity-60 ml-1">
                  ×{weights[group]}
                </span>
              </div>
              <div className="flex gap-0.5">
                {WEIGHT_OPTIONS.map((w) => (
                  <button
                    type="button"
                    key={w}
                    onClick={() => setWeight(group, w)}
                    className={`w-6 h-5 text-[10px] font-mono rounded transition-colors ${
                      weights[group] === w
                        ? w === 0
                          ? 'bg-destructive/20 text-destructive border border-destructive/40'
                          : 'bg-primary text-primary-foreground'
                        : 'bg-secondary/50 text-muted-foreground hover:bg-secondary border border-border/50'
                    }`}
                  >
                    {w}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-[9px] text-muted-foreground/60 leading-tight">{FEATURE_GROUP_DESC[group]}</p>
          </div>
        ))}

        {allZero && (
          <div className="flex items-start gap-2 p-2 rounded bg-warning/10 border border-warning/30">
            <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" />
            <p className="text-[10px] text-warning">Todos los pesos están en 0. Activa al menos un grupo.</p>
          </div>
        )}

        {filtersChanged && (
          <div className="flex items-start gap-2 p-2 rounded bg-amber-500/10 border border-amber-500/30">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-[10px] text-amber-600 dark:text-amber-400">
              Los filtros globales cambiaron desde la última generación. Regenera para aplicar.
            </p>
          </div>
        )}
      </div>

      <div className="border-t border-border p-3 space-y-2">
        <Button
          type="button"
          onClick={() => onGenerate(weights)}
          disabled={isLoading || allZero}
          className="w-full h-8 text-xs gap-1.5"
          size="sm"
        >
          {isLoading ? (
            <span className="flex items-center gap-0.5">
              {'generando'.split('').map((ch, i) => (
                <span
                  key={i}
                  className="inline-block animate-letter-bounce text-[10px]"
                  style={{ animationDelay: `${i * 0.06}s` }}
                >
                  {ch}
                </span>
              ))}
            </span>
          ) : (
            <>
              <FlaskConical className="w-3.5 h-3.5" />
              Generar análisis
            </>
          )}
        </Button>

        {isCustom && (
          <Button
            type="button"
            onClick={onReset}
            variant="outline"
            className="w-full h-7 text-xs gap-1.5"
            size="sm"
          >
            <RotateCcw className="w-3 h-3" />
            Restaurar originales
          </Button>
        )}
      </div>
    </div>
  )
}
