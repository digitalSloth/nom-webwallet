import { encode } from 'uqr'

/** A black-on-white PNG of the QR code for `text`: `scale` px per module, `margin` modules around it. */
export function qrPng(text: string, scale = 8, margin = 4): Promise<Blob> {
  const { size, data } = encode(text, { border: 0 })
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = (size + 2 * margin) * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Canvas is not available'))
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#000'
  data.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) ctx.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale)
    })
  })
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))),
      'image/png'
    )
  })
}

export function qrFileName(address: string): string {
  return `nom-${address.slice(0, 8)}.png`
}
