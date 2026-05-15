/**
 * Scientific Figure Export Engine
 * Exports SVG charts with embedded provenance metadata.
 * Every exported figure carries its dataset version, N, hash, and timestamp.
 * NO "clean" exports without methodology context.
 */

export interface FigureMetadata {
  datasetVersion: string
  queryHash: string
  sampleSize: number
  confidenceLevel: number
  academicContext: string
  generatedAt: string
}

/**
 * Exports an SVG element as a downloadable SVG file with embedded metadata.
 */
export function exportSVG(svgElement: SVGSVGElement, filename: string, metadata: FigureMetadata): void {
  const clone = svgElement.cloneNode(true) as SVGSVGElement

  // Inject provenance watermark into the SVG
  const watermark = document.createElementNS('http://www.w3.org/2000/svg', 'text')
  watermark.setAttribute('x', '10')
  watermark.setAttribute('y', String(parseInt(clone.getAttribute('height') || '300') - 8))
  watermark.setAttribute('font-size', '8')
  watermark.setAttribute('fill', '#94a3b8')
  watermark.setAttribute('font-family', 'monospace')
  watermark.textContent =
    `DS:${metadata.datasetVersion} | N=${metadata.sampleSize} | ` +
    `Hash:${metadata.queryHash.substring(0, 8)} | ` +
    `Ctx:${metadata.academicContext} | ${metadata.generatedAt}`
  clone.appendChild(watermark)

  const serializer = new XMLSerializer()
  const svgStr = serializer.serializeToString(clone)
  const blob = new Blob([svgStr], { type: 'image/svg+xml' })
  triggerDownload(blob, `${filename}.svg`)
}

/**
 * Exports an SVG element as a PNG at 300 DPI with embedded metadata watermark.
 */
export function exportPNG(svgElement: SVGSVGElement, filename: string, metadata: FigureMetadata, dpi: number = 300): void {
  const clone = svgElement.cloneNode(true) as SVGSVGElement

  // Add watermark
  const watermark = document.createElementNS('http://www.w3.org/2000/svg', 'text')
  watermark.setAttribute('x', '10')
  watermark.setAttribute('y', String(parseInt(clone.getAttribute('height') || '300') - 8))
  watermark.setAttribute('font-size', '8')
  watermark.setAttribute('fill', '#94a3b8')
  watermark.setAttribute('font-family', 'monospace')
  watermark.textContent =
    `DS:${metadata.datasetVersion} | N=${metadata.sampleSize} | ` +
    `Hash:${metadata.queryHash.substring(0, 8)} | Ctx:${metadata.academicContext}`
  clone.appendChild(watermark)

  const serializer = new XMLSerializer()
  const svgStr = serializer.serializeToString(clone)
  const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)

  const img = new Image()
  img.onload = () => {
    const scale = dpi / 96
    const canvas = document.createElement('canvas')
    canvas.width = img.width * scale
    canvas.height = img.height * scale
    const ctx = canvas.getContext('2d')!
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0)

    canvas.toBlob(blob => {
      if (blob) triggerDownload(blob, `${filename}_${dpi}dpi.png`)
      URL.revokeObjectURL(url)
    }, 'image/png')
  }
  img.src = url
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
