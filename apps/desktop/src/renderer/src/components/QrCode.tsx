import { useMemo } from 'react'

import { qrMatrix, qrPath } from '@renderer/lib/qr'

interface QrCodeProps {
  value: string
  /** Rendered size in px; the module grid scales to it. */
  size?: number
}

/**
 * The login QR. It is deliberately not themed: a dark code on the dark sheet
 * would not scan, so the modules stay near-black on white in both themes. The
 * page around the code is the quiet zone (four-plus modules at 136 px).
 */
export function QrCode({ value, size = 136 }: QrCodeProps) {
  const matrix = useMemo(() => {
    try {
      const next = qrMatrix(value)
      return { size: next.size, path: qrPath(next) }
    } catch {
      return null
    }
  }, [value])

  if (!matrix) {
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
      viewBox={`0 0 ${matrix.size} ${matrix.size}`}
      role="img"
      aria-label="登录二维码"
      shapeRendering="crispEdges"
    >
      <rect className="wx-qr__light" width={matrix.size} height={matrix.size} />
      <path className="wx-qr__dark" d={matrix.path} />
    </svg>
  )
}
