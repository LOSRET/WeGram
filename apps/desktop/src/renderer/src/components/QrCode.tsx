import { useMemo } from 'react'

import { qrDrawing, qrMatrix } from '@renderer/lib/qr'

interface QrCodeProps {
  value: string
  /** Rendered size in px of the whole square; the quiet zone scales with it. */
  size?: number
}

/**
 * The login QR. It is deliberately not themed: a dark code on the dark sheet
 * would not scan, so the modules stay near-black on white in both themes.
 *
 * The white quiet zone is drawn *inside* this square, never borrowed from the
 * page: the sheet behind it is #fafafa (dark theme #1e1e1f), and a code whose
 * modules touch that edge is not readable by a phone camera.
 */
export function QrCode({ value, size = 136 }: QrCodeProps) {
  const drawing = useMemo(() => {
    try {
      return qrDrawing(qrMatrix(value))
    } catch {
      return null
    }
  }, [value])

  if (!drawing) {
    return (
      <div className="wx-qr wx-qr--failed" role="img" aria-label="二维码生成失败">
        二维码生成失败
      </div>
    )
  }

  return (
    <svg
      className="wx-qr"
      width={size}
      height={size}
      viewBox={`0 0 ${drawing.box} ${drawing.box}`}
      role="img"
      aria-label="登录二维码"
      shapeRendering="crispEdges"
    >
      <rect className="wx-qr__light" width={drawing.box} height={drawing.box} />
      <path className="wx-qr__dark" d={drawing.path} />
    </svg>
  )
}
