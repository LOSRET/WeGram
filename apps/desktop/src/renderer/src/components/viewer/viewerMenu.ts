/** One clickable row of the viewer's "…" menu; `null` is a separator. */
export interface ViewerMenuEntry {
  label: string
  run: () => void
}

export interface ViewerMenuActions {
  copy: () => void
  save: () => void
  locate: () => void
  open: () => void
}

/**
 * The "…" menu of the viewer, as data.
 *
 * The client hides what a video cannot do: there is no bitmap to copy and
 * nothing to print, so a video only keeps 另存为. Keeping this table out of the
 * JSX is also what makes it testable.
 */
export function buildViewerMenu({
  video,
  actions,
  showNotice,
}: {
  video: boolean
  actions: ViewerMenuActions
  showNotice: (text: string) => void
}): Array<ViewerMenuEntry | null> {
  const notWired = (): void => showNotice('还没有接入')
  const entries: Array<ViewerMenuEntry | null> = video
    ? [{ label: '另存为…', run: actions.save }]
    : [
        { label: '复制', run: actions.copy },
        { label: '另存为…', run: actions.save },
        null,
        { label: '打印', run: notWired },
      ]
  entries.push(
    { label: '转发…', run: notWired },
    { label: '收藏', run: notWired },
    null,
    { label: '定位到聊天位置', run: actions.locate },
    { label: '使用系统默认方式打开', run: actions.open },
  )
  return entries
}
