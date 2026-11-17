import type { ViewerItem, ViewerState } from '@wegram/protocol'
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'

import { errorMessage, invoke } from '../../lib/ipc'
import {
  clampPan,
  elementSize,
  fitScale,
  rotatedSize,
  stepZoom,
  type Point,
  type Size,
} from '../../lib/zoom'
import { Popup } from '../ContextMenu'
import { MoreIcon } from '../WechatIcons'
import { VideoCanvas } from './VideoCanvas'
import {
  ActualSizeIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  GridIcon,
  PinIcon,
  RotateIcon,
  SaveIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from './ViewerIcons'

const NO_ITEMS: ViewerState['items'] = []
const ORIGIN: Point = { x: 0, y: 0 }

/**
 * One cell of the 预览 board. Real media carries a base64 minithumbnail and paints
 * instantly; when one is missing the cell fetches the file at the lowest
 * priority, because the board is only open when the reader asked to see the
 * whole strip at once.
 */
function PreviewCell({
  item,
  position,
  active,
  onSelect,
}: {
  item: ViewerItem
  position: number
  active: boolean
  onSelect: () => void
}) {
  const [src, setSrc] = useState<string | null>(
    item.minithumbnail ? `data:image/jpeg;base64,${item.minithumbnail}` : null,
  )

  useEffect(() => {
    if (src || item.fileId <= 0) return
    let alive = true
    invoke('media:download', { fileId: item.fileId, priority: 2 })
      .then(({ url }) => {
        if (alive) setSrc(url)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [item.fileId, src])

  return (
    <button
      type="button"
      className={`wx-viewer__cell${active ? ' is-active' : ''}`}
      title={item.fileName ?? `${item.kind === 'video' ? '视频' : '图片'} ${position + 1}`}
      onClick={onSelect}
    >
      {src ? <img src={src} alt="" /> : <span className="wx-viewer__cell-empty" />}
    </button>
  )
}

/**
 * The standalone 图片和视频 window (design doc §9.5).
 *
 * Runs as its own window on `#viewer`: the toolbar takes the place of the title
 * strip, the photo or video is fitted into the canvas below it, and the strip it
 * pages through is handed over by the transcript through `viewer:init`. Every
 * size/zoom rule lives in `lib/zoom.ts`; the video's transport is
 * `VideoCanvas`, which keeps the client's translucent bar.
 */
export function MediaViewer() {
  const [state, setState] = useState<ViewerState | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [index, setIndex] = useState(0)

  const [url, setUrl] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [image, setImage] = useState<Size | null>(null)

  const [zoom, setZoom] = useState<number | null>(null)
  const [rotation, setRotation] = useState(0)
  const [pan, setPan] = useState<Point>(ORIGIN)
  const [canvas, setCanvas] = useState<Size>({ width: 0, height: 0 })

  const [pinned, setPinned] = useState(false)
  const [grid, setGrid] = useState(false)
  const [menu, setMenu] = useState<Point | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const canvasRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ origin: Point; pan: Point } | null>(null)
  const noticeTimer = useRef<number | null>(null)
  const fitRef = useRef(1)

  const items = state?.items ?? NO_ITEMS
  const item = items[index]
  const fileId = item?.fileId ?? 0
  const video = item?.kind === 'video'

  const showNotice = useCallback((text: string) => {
    setNotice(text)
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => {
      noticeTimer.current = null
      setNotice(null)
    }, 2400)
  }, [])

  useEffect(
    () => () => {
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
    },
    [],
  )

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

  /* ---------- current photo ---------- */

  useEffect(() => {
    setUrl(null)
    setLoadError(null)
    setProgress(null)
    setImage(null)
    setZoom(null)
    setRotation(0)
    setPan(ORIGIN)
    if (!fileId) return

    let alive = true
    invoke('media:download', { fileId, priority: 10 })
      .then(({ url: downloaded }) => {
        if (alive) setUrl(downloaded)
      })
      .catch((error: unknown) => {
        if (alive) setLoadError(errorMessage(error))
      })
    return () => {
      alive = false
    }
  }, [fileId])

  useEffect(() => {
    if (!fileId) return
    return window.tg.on('evt:file', ({ payload }) => {
      if (payload.fileId !== fileId) return
      if (payload.completed || payload.total <= 0) setProgress(null)
      else setProgress(Math.min(1, Math.max(0, payload.downloaded / payload.total)))
    })
  }, [fileId])

  /* ---------- geometry ---------- */

  useEffect(() => {
    const element = canvasRef.current
    if (!element) return
    const measure = (): void =>
      setCanvas({ width: element.clientWidth, height: element.clientHeight })
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  }, [])

  const natural = useMemo<Size | null>(() => {
    // A video is fitted by the player itself and never zooms or pans.
    if (video) return null
    const width = image?.width ?? item?.width
    const height = image?.height ?? item?.height
    if (!width || !height) return null
    // 1:1 means the photo's own pixels: a 2400 px shot on a 125 % display is
    // 1920 CSS px wide, which is what the client's 图片原始大小 shows.
    const ratio = window.devicePixelRatio || 1
    return { width: width / ratio, height: height / ratio }
  }, [image, item, video])

  const fit = fitScale(natural, canvas, rotation)
  fitRef.current = fit
  const scale = zoom ?? fit
  const box = natural && canvas.width > 0 ? elementSize(natural, scale) : null
  const covered = natural ? rotatedSize(natural, scale, rotation) : null

  useEffect(() => {
    if (!natural) return
    setPan((current) => {
      const next = clampPan(current, rotatedSize(natural, scale, rotation), canvas)
      return next.x === current.x && next.y === current.y ? current : next
    })
  }, [natural, scale, rotation, canvas])

  /* ---------- interaction ---------- */

  const go = useCallback(
    (delta: number) => {
      setIndex((current) => Math.min(Math.max(0, current + delta), Math.max(0, items.length - 1)))
    },
    [items.length],
  )

  const zoomBy = useCallback((direction: 1 | -1) => {
    setZoom((current) => stepZoom(current ?? fitRef.current, direction))
  }, [])

  const toggleActualSize = useCallback(() => {
    setPan(ORIGIN)
    setZoom((current) => (current === null ? 1 : null))
  }, [])

  const rotate = useCallback(() => {
    setRotation((current) => (current + 90) % 360)
    setPan(ORIGIN)
  }, [])

  // React attaches wheel listeners passively, so zoom needs a native one.
  useEffect(() => {
    const element = canvasRef.current
    if (!element || video) return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      setZoom((current) => stepZoom(current ?? fitRef.current, event.deltaY < 0 ? 1 : -1))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [video])

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

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || !covered) return
    dragRef.current = { origin: { x: event.clientX, y: event.clientY }, pan }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const start = dragRef.current
    if (!start || !covered) return
    setPan(
      clampPan(
        {
          x: start.pan.x + (event.clientX - start.origin.x),
          y: start.pan.y + (event.clientY - start.origin.y),
        },
        covered,
        canvas,
      ),
    )
  }

  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  /* ---------- actions ---------- */

  const togglePin = async (): Promise<void> => {
    try {
      const { onTop } = await invoke('viewer:pin', { onTop: !pinned })
      setPinned(onTop)
    } catch (error) {
      showNotice(errorMessage(error))
    }
  }

  const saveCurrent = async (): Promise<void> => {
    if (!fileId) return
    try {
      const result = await invoke('viewer:save', { fileId })
      if (!result.canceled) showNotice('已保存')
    } catch (error) {
      showNotice(errorMessage(error))
    }
  }

  const copyPhoto = async (): Promise<void> => {
    if (!fileId) return
    try {
      await invoke('viewer:copy', { fileId })
      showNotice('已复制')
    } catch (error) {
      showNotice(errorMessage(error))
    }
  }

  const openInSystem = async (): Promise<void> => {
    if (!fileId) return
    try {
      await invoke('media:open', { fileId })
    } catch (error) {
      showNotice(errorMessage(error))
    }
  }

  const locateInChat = async (): Promise<void> => {
    // The transcript owns the message list; closing the viewer hands the focus
    // back to the chat window, which is where the photo came from.
    try {
      await invoke('viewer:close')
    } catch (error) {
      showNotice(errorMessage(error))
    }
  }

  // The client hides what a video cannot do: there is no bitmap to copy and
  // nothing to print.
  const menuEntries: Array<{ label: string; run: () => void } | null> = [
    ...(video
      ? []
      : [
          { label: '复制', run: () => void copyPhoto() },
          { label: '另存为…', run: () => void saveCurrent() },
          null,
          { label: '打印', run: () => showNotice('还没有接入') },
        ]),
    ...(video ? [{ label: '另存为…', run: () => void saveCurrent() }] : []),
    { label: '转发…', run: () => showNotice('还没有接入') },
    { label: '收藏', run: () => showNotice('还没有接入') },
    null,
    { label: '定位到聊天位置', run: () => void locateInChat() },
    { label: '使用系统默认方式打开', run: () => void openInSystem() },
  ]

  const pannable = Boolean(
    covered && (covered.width > canvas.width || covered.height > canvas.height),
  )

  return (
    <div className="wx-viewer">
      <div className="wx-viewer__bar">
        <button
          type="button"
          className={`wx-viewer__icon${pinned ? ' is-active' : ''}`}
          title={pinned ? '取消置顶' : '置顶'}
          aria-pressed={pinned}
          onClick={() => void togglePin()}
        >
          <PinIcon />
        </button>
        <span className="wx-viewer__sep" />
        <button
          type="button"
          className="wx-viewer__icon"
          title="上一张"
          disabled={index <= 0}
          onClick={() => go(-1)}
        >
          <ArrowLeftIcon />
        </button>
        <button
          type="button"
          className="wx-viewer__icon"
          title="下一张"
          disabled={index >= items.length - 1}
          onClick={() => go(1)}
        >
          <ArrowRightIcon />
        </button>
        <button
          type="button"
          className={`wx-viewer__icon${grid ? ' is-active' : ''}`}
          title="预览"
          aria-pressed={grid}
          onClick={() => setGrid((open) => !open)}
        >
          <GridIcon />
        </button>
        <span className="wx-viewer__sep" />
        {/* A video has nothing to zoom or rotate: the client's video strip is
            pin ｜ ← → ▦ ｜ ⇩ ｜ … ｜ window controls, exactly this. */}
        {video ? null : (
          <>
            <button
              type="button"
              className="wx-viewer__icon"
              title="放大"
              onClick={() => zoomBy(1)}
            >
              <ZoomInIcon />
            </button>
            <button
              type="button"
              className="wx-viewer__icon"
              title="缩小"
              onClick={() => zoomBy(-1)}
            >
              <ZoomOutIcon />
            </button>
            <button
              type="button"
              className="wx-viewer__icon"
              title="图片原始大小"
              onClick={toggleActualSize}
            >
              <ActualSizeIcon />
            </button>
            <span className="wx-viewer__sep" />
            <button type="button" className="wx-viewer__icon" title="旋转" onClick={rotate}>
              <RotateIcon />
            </button>
            <span className="wx-viewer__sep" />
          </>
        )}
        <button
          type="button"
          className="wx-viewer__icon"
          title="保存"
          onClick={() => void saveCurrent()}
        >
          <SaveIcon />
        </button>
        <span className="wx-viewer__grow" />
        <button
          type="button"
          className="wx-viewer__icon"
          title="更多"
          aria-haspopup="menu"
          onClick={(event) => setMenu({ x: event.clientX, y: event.clientY })}
        >
          <MoreIcon size={19} />
        </button>
      </div>

      <div className="wx-viewer__body">
        <div
          ref={canvasRef}
          className={`wx-viewer__canvas${pannable ? ' is-pannable' : ''}`}
          onPointerDown={video ? undefined : onPointerDown}
          onPointerMove={video ? undefined : onPointerMove}
          onPointerUp={video ? undefined : onPointerUp}
          onPointerCancel={video ? undefined : onPointerUp}
          onDoubleClick={video ? undefined : toggleActualSize}
        >
          {video && item ? (
            <VideoCanvas key={item.fileId} item={item} url={url} canvas={canvas} />
          ) : null}

          {!video && url ? (
            <img
              className="wx-viewer__image"
              src={url}
              alt={item?.fileName ?? '图片'}
              draggable={false}
              style={
                box
                  ? {
                      width: `${box.width}px`,
                      height: `${box.height}px`,
                      transform: `translate(${pan.x}px, ${pan.y}px) rotate(${rotation}deg)`,
                    }
                  : { maxWidth: '100%', maxHeight: '100%' }
              }
              onLoad={(event) =>
                setImage({
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
                `${Math.round(progress * 100)}%`
              )}
            </div>
          ) : null}
          {loadError ? (
            <div className="wx-viewer__status wx-viewer__status--error">{loadError}</div>
          ) : null}
          {fatal ? <div className="wx-viewer__status">{fatal}</div> : null}
        </div>

        {grid ? (
          <aside className="wx-viewer__grid" aria-label="预览">
            {items.map((entry, position) => (
              <PreviewCell
                key={`${entry.fileId}-${position}`}
                item={entry}
                position={position}
                active={position === index}
                onSelect={() => setIndex(position)}
              />
            ))}
          </aside>
        ) : null}
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
