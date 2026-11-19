import type { ViewerState } from '@wegram/protocol'
import { useCallback, useEffect, useState } from 'react'

import { errorMessage, invoke } from '../../lib/ipc'
import { percentOf } from '../../lib/mediaBox'
import type { Point } from '../../lib/zoom'
import { Popup } from '../ContextMenu'
import { VideoCanvas } from './VideoCanvas'
import { ViewerGrid } from './ViewerGrid'
import { ViewerToolbar } from './ViewerToolbar'
import { useViewerItem } from './useViewerItem'
import { useViewerNotice } from './useViewerNotice'
import { useViewerZoom } from './useViewerZoom'
import { createViewerActions } from './viewerActions'
import { buildViewerMenu } from './viewerMenu'

const NO_ITEMS: ViewerState['items'] = []

/**
 * The standalone 图片和视频 window (design doc §9.5).
 *
 * Runs as its own window on `#viewer`: the toolbar takes the place of the title
 * strip, the photo or video is fitted into the canvas below it, and the strip it
 * pages through is handed over by the transcript through `viewer:init`.
 *
 * This component is the composition root only — each concern has its own module:
 *   `useViewerItem`   the download, its progress and its error
 *   `useViewerZoom`   fit / zoom / rotate / pan (sizes come from `lib/zoom.ts`)
 *   `viewerActions`   pin, save, copy, open, 定位到聊天位置
 *   `viewerMenu`      the "…" menu as data
 *   `ViewerToolbar` / `ViewerGrid`  the two pieces of chrome
 */
export function MediaViewer() {
  const [state, setState] = useState<ViewerState | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const [pinned, setPinned] = useState(false)
  const [grid, setGrid] = useState(false)
  const [menu, setMenu] = useState<Point | null>(null)

  const { notice, showNotice } = useViewerNotice()

  const items = state?.items ?? NO_ITEMS
  const item = items[index]
  const video = item?.kind === 'video'
  const fileId = item?.fileId ?? 0

  const { url, loadError, progress } = useViewerItem(item)
  const zoom = useViewerZoom(item, video)
  const { zoomBy, toggleActualSize, rotate } = zoom
  const actions = createViewerActions({
    fileId,
    messageId: item?.messageId,
    shine: showNotice,
    setPinned,
  })
  const menuEntries = buildViewerMenu({
    video,
    actions: {
      copy: () => void actions.copyPhoto(),
      save: () => void actions.saveCurrent(),
      locate: () => void actions.locateInChat(),
      open: () => void actions.openInSystem(),
    },
    showNotice,
  })

  /* ---------- bootstrap ---------- */

  useEffect(() => {
    void (async () => {
      try {
        const next = await invoke('viewer:init')
        setState(next)
        setIndex(next.index)
        document.documentElement.dataset['theme'] = next.theme
        // The window title would otherwise stay the HTML document's "WeGram";
        // the client calls its viewer window 图片和视频 in the task bar.
        document.title = '图片和视频'
      } catch (error) {
        setFatal(errorMessage(error))
      }
    })()
  }, [])

  /* ---------- paging ---------- */

  const go = useCallback(
    (delta: number) => {
      setIndex((current) => Math.min(Math.max(0, current + delta), Math.max(0, items.length - 1)))
    },
    [items.length],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (menu) setMenu(null)
        else if (grid) setGrid(false)
        else void invoke('viewer:close').catch(() => undefined)
        return
      }
      // The video handles Space / ← / → itself: there they seek, not page.
      if (video) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        go(-1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        go(1)
      } else if (event.key === '+' || event.key === '=') {
        zoomBy(1)
      } else if (event.key === '-') {
        zoomBy(-1)
      } else if (event.key === '0') {
        toggleActualSize()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, grid, menu, toggleActualSize, video, zoomBy])

  return (
    <div className="wx-viewer">
      <ViewerToolbar
        video={video}
        pinned={pinned}
        grid={grid}
        index={index}
        count={items.length}
        onPin={() => void actions.togglePin(pinned)}
        onPrev={() => go(-1)}
        onNext={() => go(1)}
        onToggleGrid={() => setGrid((open) => !open)}
        onZoomIn={() => zoomBy(1)}
        onZoomOut={() => zoomBy(-1)}
        onActualSize={toggleActualSize}
        onRotate={rotate}
        onSave={() => void actions.saveCurrent()}
        onMenu={(x, y) => setMenu({ x, y })}
      />

      <div className="wx-viewer__body">
        <div
          ref={zoom.canvasRef}
          className={`wx-viewer__canvas${zoom.pannable ? ' is-pannable' : ''}`}
          onPointerDown={video ? undefined : zoom.onPointerDown}
          onPointerMove={video ? undefined : zoom.onPointerMove}
          onPointerUp={video ? undefined : zoom.onPointerUp}
          onPointerCancel={video ? undefined : zoom.onPointerUp}
          onDoubleClick={video ? undefined : toggleActualSize}
        >
          {video && item ? (
            <VideoCanvas key={item.fileId} item={item} url={url} canvas={zoom.canvas} />
          ) : null}

          {!video && url ? (
            <img
              className="wx-viewer__image"
              src={url}
              alt={item?.fileName ?? '图片'}
              draggable={false}
              style={
                zoom.box
                  ? {
                      width: `${zoom.box.width}px`,
                      height: `${zoom.box.height}px`,
                      transform: `translate(${zoom.pan.x}px, ${zoom.pan.y}px) rotate(${zoom.rotation}deg)`,
                    }
                  : { maxWidth: '100%', maxHeight: '100%' }
              }
              onLoad={(event) =>
                zoom.onImageLoad({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
              }
            />
          ) : null}

          {!url && !loadError && !fatal ? (
            <div className="wx-viewer__status">
              {progress === null ? (
                <span className="wx-spinner" />
              ) : (
                percentOf(progress)
              )}
            </div>
          ) : null}
          {loadError ? (
            <div className="wx-viewer__status wx-viewer__status--error">{loadError}</div>
          ) : null}
          {fatal ? <div className="wx-viewer__status">{fatal}</div> : null}
        </div>

        {grid ? <ViewerGrid items={items} index={index} onSelect={setIndex} /> : null}
      </div>

      {notice ? <div className="wx-viewer__notice">{notice}</div> : null}

      {menu ? (
        <Popup x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          {menuEntries.map((entry, position) =>
            entry ? (
              <button
                key={entry.label}
                type="button"
                className="wx-context-menu__item"
                onClick={() => {
                  setMenu(null)
                  entry.run()
                }}
                role="menuitem"
              >
                {entry.label}
              </button>
            ) : (
              <span key={`sep-${position}`} className="wx-context-menu__separator" />
            ),
          )}
        </Popup>
      ) : null}
    </div>
  )
}
