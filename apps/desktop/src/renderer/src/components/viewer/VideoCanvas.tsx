import type { ViewerItem } from '@wechatgram/protocol'
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'

import {
  PLAYBACK_RATES,
  playerClock,
  progressRatio,
  seekTarget,
  timeAtRatio,
  type PlaybackRate,
} from '../../lib/player'
import { elementSize, fitScale, type Size } from '../../lib/zoom'
import { Popup } from '../ContextMenu'
import { MutedIcon, PauseIcon, PlayIcon, VolumeIcon } from './ViewerIcons'

/** How long the bar stays on screen while the video plays (the client hides it). */
const IDLE_HIDE_MS = 2400
/** ←/→ in the window: the client seeks by five seconds. */
const SEEK_STEP = 5

/**
 * The video half of the 图片和视频 window (design doc §9.5).
 *
 * The client's video window is the image window with a different canvas: same
 * 40 px toolbar, light #f7f7f7 canvas, the clip fitted by height with no padding —
 * plus a translucent player bar near the bottom edge. Measured off the client:
 * 40 px tall, 84 px from the left edge and 82 px from the right, 20 px above the
 * bottom, `rgba(0,0,0,.45)` over the footage, white glyphs.
 *
 * The bar floats over the video instead of taking layout space, hides itself while
 * the clip plays and comes back on any pointer movement — everything time-based
 * here is a `setTimeout`, never a frame loop (an occluded Electron window throttles
 * `requestAnimationFrame`).
 */
export function VideoCanvas({
  item,
  url,
  canvas,
}: {
  item: ViewerItem
  url: string | null
  /** The canvas the clip has to fit into, measured by the window. */
  canvas: Size
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const hideTimer = useRef<number | null>(null)

  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(item.duration ?? 0)
  const [rate, setRate] = useState<PlaybackRate>(1)
  const [muted, setMuted] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [hovering, setHovering] = useState(false)
  const [chrome, setChrome] = useState(true)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  // The clip is laid out by hand, like the photo: `max-width` alone would refuse
  // to enlarge a 270 px clip, while the client always fills the canvas.
  const [clip, setClip] = useState<Size | null>(() => {
    const ratio = window.devicePixelRatio || 1
    if (!item.width || !item.height) return null
    return { width: item.width / ratio, height: item.height / ratio }
  })

  const ratio = progressRatio(current, duration)
  const box = clip && canvas.width > 0 ? elementSize(clip, fitScale(clip, canvas)) : null

  /* ---------- playback ---------- */

  // A new clip resets the transport: the element survives navigation, the state
  // around it must not.
  useEffect(() => {
    setCurrent(0)
    setPlaying(false)
    setDuration(item.duration ?? 0)
  }, [item.fileId, item.duration])

  const play = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.ended) video.currentTime = 0
    void video.play().catch(() => setPlaying(false))
  }, [])

  const toggle = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) play()
    else video.pause()
  }, [play])

  const seek = useCallback((target: number) => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = target
    setCurrent(target)
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.playbackRate = rate
  }, [rate, url])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = muted
  }, [muted, url])

  const onSeekPointer = (event: PointerEvent<HTMLDivElement>): void => {
    const track = trackRef.current
    if (!track) return
    const rect = track.getBoundingClientRect()
    if (rect.width <= 0) return
    seek(timeAtRatio((event.clientX - rect.left) / rect.width, duration))
  }

  const onTrackPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
    onSeekPointer(event)
  }

  const onTrackPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!dragging) return
    onSeekPointer(event)
  }

  const onTrackPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  /* ---------- the bar ---------- */

  const armHide = useCallback(() => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = null
      setChrome(false)
    }, IDLE_HIDE_MS)
  }, [])

  useEffect(() => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
    // A paused clip keeps its controls: hiding them would leave a still frame,
    // and the bar must never vanish from under the pointer that is using it.
    if (!playing || menu || dragging || hovering) {
      setChrome(true)
      return
    }
    armHide()
    return () => {
      if (hideTimer.current !== null) {
        window.clearTimeout(hideTimer.current)
        hideTimer.current = null
      }
    }
  }, [playing, menu, dragging, hovering, armHide])

  useEffect(
    () => () => {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current)
    },
    [],
  )

  const wake = (): void => {
    if (!chrome) setChrome(true)
    if (playing) armHide()
  }

  /* ---------- keyboard ---------- */

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const video = videoRef.current
      if (!video) return
      if (event.key === ' ' || event.key === 'k' || event.key === 'K') {
        event.preventDefault()
        toggle()
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        seek(seekTarget(video.currentTime, duration, -SEEK_STEP))
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        seek(seekTarget(video.currentTime, duration, SEEK_STEP))
      } else if (event.key === 'm' || event.key === 'M') {
        setMuted((value) => !value)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [duration, seek, toggle])

  return (
    <div className="wx-viewer__stage" onPointerMove={wake}>
      {url ? (
        <video
          ref={videoRef}
          className="wx-viewer__video"
          src={url}
          poster={item.minithumbnail ? `data:image/jpeg;base64,${item.minithumbnail}` : undefined}
          autoPlay
          playsInline
          style={
            box
              ? { width: `${box.width}px`, height: `${box.height}px` }
              : { maxWidth: '100%', maxHeight: '100%' }
          }
          onClick={toggle}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false)
            setChrome(true)
          }}
          onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) => {
            const video = event.currentTarget
            if (Number.isFinite(video.duration)) setDuration(video.duration)
            // The DTO's width/height can be the thumbnail's; the element knows.
            const ratio = window.devicePixelRatio || 1
            if (video.videoWidth > 0 && video.videoHeight > 0) {
              setClip({ width: video.videoWidth / ratio, height: video.videoHeight / ratio })
            }
            video.playbackRate = rate
            video.muted = muted
          }}
        />
      ) : null}

      <div
        className={`wx-player${chrome ? '' : ' is-hidden'}`}
        onPointerEnter={() => setHovering(true)}
        onPointerLeave={() => setHovering(false)}
      >
        <button
          type="button"
          className="wx-player__icon"
          title={playing ? '暂停' : '播放'}
          onClick={toggle}
        >
          {playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
        </button>

        <span className="wx-player__time">{playerClock(current)}</span>

        <div
          ref={trackRef}
          className="wx-player__track"
          role="slider"
          aria-label="播放进度"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(current)}
          onPointerDown={onTrackPointerDown}
          onPointerMove={onTrackPointerMove}
          onPointerUp={onTrackPointerUp}
          onPointerCancel={onTrackPointerUp}
        >
          <span className="wx-player__played" style={{ width: `${ratio * 100}%` }} />
          <span className="wx-player__thumb" style={{ left: `${ratio * 100}%` }} />
        </div>

        <span className="wx-player__time">{playerClock(duration)}</span>

        <button
          type="button"
          className="wx-player__rate"
          title="播放速度"
          aria-haspopup="menu"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            setMenu({ x: rect.left, y: rect.top - 6 })
          }}
        >
          {rate === 1 ? '倍速' : `${rate}x`}
        </button>

        <button
          type="button"
          className="wx-player__icon"
          title={muted ? '取消静音' : '静音'}
          onClick={() => setMuted((value) => !value)}
        >
          {muted ? <MutedIcon size={18} /> : <VolumeIcon size={18} />}
        </button>
      </div>

      {menu ? (
        <Popup x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          {PLAYBACK_RATES.map((option) => (
            <button
              key={option}
              type="button"
              className="wx-context-menu__item"
              onClick={() => {
                setMenu(null)
                setRate(option)
              }}
              role="menuitem"
            >
              {option === rate ? `✓ ${option}x` : `${option}x`}
            </button>
          ))}
        </Popup>
      ) : null}
    </div>
  )
}
