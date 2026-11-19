import type { ViewerItem } from '@wegram/protocol'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from 'react'

import {
  clampPan,
  elementSize,
  fitScale,
  rotatedSize,
  stepZoom,
  type Point,
  type Size,
} from '../../lib/zoom'

const ORIGIN: Point = { x: 0, y: 0 }

export interface ViewerZoom {
  /** Attach to the canvas element; the hook measures it for fitting. */
  canvasRef: RefObject<HTMLDivElement | null>
  /** The canvas' current size, which the video player also fits itself into. */
  canvas: Size
  /** The photo's natural size as the browser decoded it. */
  natural: Size | null
  /** Our scale on top of the fitted size: `0 — 1` to the photo's own pixels. */
  scale: number
  /** The size the picture is painted at, or null until it is known. */
  box: Size | null
  /** The rotated footprint, used for the pan bounds. */
  covered: Size | null
  pan: Point
  rotation: number
  pannable: boolean
  onImageLoad: (size: Size) => void
  zoomBy: (direction: 1 | -1) => void
  toggleActualSize: () => void
  rotate: () => void
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void
}

/**
 * How the picture is sized and moved: fit, zoom step, 1:1, rotation, and the
 * drag that pans a picture larger than the canvas.
 *
 * Every size rule lives in `lib/zoom.ts` (pure, unit-tested); this hook only
 * keeps the state and wires the DOM events — React attaches wheel listeners
 * passively, so zoom needs a native one.
 *
 * A video is fitted by the player itself and never zooms or pans: when `video`
 * is true the hook keeps `natural` null and the canvas gets no handlers.
 */
export function useViewerZoom(item: ViewerItem | undefined, video: boolean): ViewerZoom {
  const fileId = item?.fileId ?? 0
  const [imageSize, setImageSize] = useState<Size | null>(null)
  const [zoom, setZoom] = useState<number | null>(null)
  const [rotation, setRotation] = useState(0)
  const [pan, setPan] = useState<Point>(ORIGIN)
  const [canvas, setCanvas] = useState<Size>({ width: 0, height: 0 })

  const canvasRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ origin: Point; pan: Point } | null>(null)
  const fitRef = useRef(1)

  // A new picture starts fitted, upright and un-panned.
  useEffect(() => {
    setImageSize(null)
    setZoom(null)
    setRotation(0)
    setPan(ORIGIN)
  }, [fileId])

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
    if (video) return null
    const width = imageSize?.width ?? item?.width
    const height = imageSize?.height ?? item?.height
    if (!width || !height) return null
    // 1:1 means the photo's own pixels: a 2400 px shot on a 125 % display is
    // 1920 CSS px wide, which is what the client's 图片原始大小 shows.
    const ratio = window.devicePixelRatio || 1
    return { width: width / ratio, height: height / ratio }
  }, [imageSize, item, video])

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

  const pannable = Boolean(
    covered && (covered.width > canvas.width || covered.height > canvas.height),
  )

  return {
    canvasRef,
    canvas,
    natural,
    scale,
    box,
    covered,
    pan,
    rotation,
    pannable,
    onImageLoad: setImageSize,
    zoomBy,
    toggleActualSize,
    rotate,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  }
}
