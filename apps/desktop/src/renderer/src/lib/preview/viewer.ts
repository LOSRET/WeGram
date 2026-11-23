import type { ViewerItem } from '@wegram/protocol'

/**
 * The 图片和视频 window in the browser preview, split out of `preview/index.ts`
 * when that file reached its size budget.
 *
 * In Electron the viewer is its own window; in the preview it is a route, so the
 * "open" call only records the strip. Save / copy / reveal need a filesystem and
 * answer "not available" — the real window has its own IPC for those.
 */
export interface PreviewViewerState {
  items: ViewerItem[]
  index: number
  title?: string
}

let current: PreviewViewerState | null = null

export function openPreviewViewer(state: PreviewViewerState): void {
  current = state
}

export function previewViewerState(theme: 'light' | 'dark'): {
  items: ViewerItem[]
  index: number
  theme: 'light' | 'dark'
} {
  if (!current) throw { code: 'internal', message: '查看器还没有打开' }
  return { items: current.items, index: current.index, theme }
}

export function previewViewerUnsupported(): never {
  throw { code: 'not_implemented', message: '浏览器预览不能访问本地文件' }
}
