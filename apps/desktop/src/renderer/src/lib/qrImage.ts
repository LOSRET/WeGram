import { qrDrawing, qrMatrix } from './qr'

/**
 * Rasterises a QR code to a PNG for 复制图片 / 保存图片 / 转发给朋友.
 *
 * The SVG component is for the screen; the clipboard and the chat need pixels.
 * Drawn from the same `qrMatrix`/`qrDrawing` helpers the component uses, with the
 * quiet zone included, so the picture that leaves the app is the code that was
 * on screen. The size is generous on purpose: 1024 px scans and forwards well.
 */
export async function qrPngBase64(content: string, size = 1024): Promise<string> {
  const matrix = qrMatrix(content)
  const drawing = qrDrawing(matrix)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D canvas is unavailable')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, size, size)
  const scale = size / drawing.box
  context.fillStyle = '#000000'
  for (let row = 0; row < matrix.size; row += 1) {
    for (let column = 0; column < matrix.size; column += 1) {
      if (matrix.modules[row * matrix.size + column] !== 1) continue
      context.fillRect(
        Math.floor((column + drawing.quietZone) * scale),
        Math.floor((row + drawing.quietZone) * scale),
        Math.ceil(scale),
        Math.ceil(scale),
      )
    }
  }
  const url = canvas.toDataURL('image/png')
  return url.slice(url.indexOf(',') + 1)
}
