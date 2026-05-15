import { ReferenceArea } from 'recharts'

interface Props {
  yAxisId?: string
  /** X-axis values for turno bands. Use strings if XAxis is categorical (e.g. "07:00", "07h"), numbers if numeric. */
  x1Matutino?: number | string
  x2Matutino?: number | string
  x1Vespertino?: number | string
  x2Vespertino?: number | string
}

export function TurnoBands({
  yAxisId = "0",
  x1Matutino = 7,
  x2Matutino = 14,
  x1Vespertino = 14,
  x2Vespertino = 21,
}: Props) {
  return (
    <>
      {/* Turno Matutino */}
      <ReferenceArea
        yAxisId={yAxisId}
        x1={x1Matutino}
        x2={x2Matutino}
        fill="hsl(var(--environment))"
        fillOpacity={0.07}
        ifOverflow="hidden"
        label={{ value: 'Matutino', position: 'insideTopLeft', fontSize: 13, fill: 'hsl(var(--environment))', opacity: 0.6 }}
      />
      {/* Turno Vespertino */}
      <ReferenceArea
        yAxisId={yAxisId}
        x1={x1Vespertino}
        x2={x2Vespertino}
        fill="hsl(var(--academic))"
        fillOpacity={0.07}
        ifOverflow="hidden"
        label={{ value: 'Vespertino', position: 'insideTopLeft', fontSize: 13, fill: 'hsl(var(--academic))', opacity: 0.6 }}
      />
    </>
  )
}
