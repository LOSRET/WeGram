import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'

import { isSilent, volumeAtPoint, VOLUME_STEP } from '../../lib/player'
import { MutedIcon, VolumeIcon } from './ViewerIcons'

/**
 * How long the capsule survives the pointer leaving it. The speaker and the capsule
 * are two boxes with a gap between them; without a grace period a pointer moving up
 * from the speaker crosses dead space, the wrapper sees `pointerleave` and the
 * capsule vanishes before it can be reached (measured: it did exactly that).
 */
const CLOSE_DELAY_MS = 180

/**
 * 音量 at the right end of the player bar (design doc §9.5).
 *
 * The client draws a speaker that toggles 静音 and lifts a capsule above it while the
 * pointer (or keyboard focus) is there. Measured off the client at 4×: a 34 × 128 px
 * capsule, radius 17, `rgba(0,0,0,.4)`, a 2 px white track and a 22 px knob, the top
 * of the track being 100 %.
 *
 * The capsule is a child of the bar's own volume cell, so the bar still counts the
 * pointer as hovering and cannot hide itself from under a drag. A drag repaints
 * through `onVolume`; only the release (`onCommit`) and a key step write to `ui.db`.
 */
export function VolumeControl({
  volume,
  muted,
  onVolume,
  onStep,
  onCommit,
  onToggleMute,
}: {
  volume: number
  muted: boolean
  /** A drag in progress: repaint only. */
  onVolume: (volume: number) => void
  /** ↑/↓ on the capsule: one `VOLUME_STEP` per press, stored at once. */
  onStep: (delta: number) => void
  /** The drag ended at the current level. */
  onCommit: () => void
  onToggleMute: () => void
}) {
  const [open, setOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const closeTimer = useRef<number | null>(null)
  const silent = isSilent(muted, volume)
  /**
   * The level the capsule paints: 静音 slides the knob to the bottom while the real
   * level stays in the hook, so clicking the speaker again puts it back where it was
   * instead of jumping to 100 %.
   */
  const shown = muted ? 0 : volume

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  const scheduleClose = (): void => {
    cancelClose()
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null
      setOpen(false)
    }, CLOSE_DELAY_MS)
  }

  useEffect(() => cancelClose, [cancelClose])

  const levelAt = (clientY: number): number => {
    const track = trackRef.current
    if (!track) return volume
    const rect = track.getBoundingClientRect()
    return volumeAtPoint(clientY - rect.top, rect.height)
  }

  /** Is the pointer still on the capsule (a release there must not close it)? */
  const overTrack = (clientX: number, clientY: number): boolean => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return false
    return (
      clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
    )
  }

  const onTrackDown = (event: PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
    onVolume(levelAt(event.clientY))
  }

  const onTrackMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!dragging) return
    onVolume(levelAt(event.clientY))
  }

  const onTrackUp = (event: PointerEvent<HTMLDivElement>): void => {
    if (!dragging) return
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    onCommit()
    // Released away from the capsule: it has served its purpose. A release on the
    // capsule keeps it up, because the pointer is still on a descendant.
    if (!overTrack(event.clientX, event.clientY)) scheduleClose()
  }

  const onTrackKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      onStep(VOLUME_STEP)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      onStep(-VOLUME_STEP)
    }
  }

  return (
    <div
      className={`wx-player__volume${open ? ' is-open' : ''}`}
      onPointerEnter={() => {
        cancelClose()
        setOpen(true)
      }}
      onPointerMove={() => {
        // Reaching the capsule, or coming back for it, cancels a pending close.
        if (closeTimer.current !== null) cancelClose()
      }}
      onPointerLeave={() => {
        if (!dragging) scheduleClose()
      }}
      onFocus={() => {
        cancelClose()
        setOpen(true)
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation()
          setOpen(false)
        }
      }}
    >
      <button
        type="button"
        className="wx-player__icon"
        title={silent ? '取消静音' : '静音'}
        aria-label={silent ? '取消静音' : '静音'}
        onClick={onToggleMute}
      >
        {silent ? <MutedIcon size={18} /> : <VolumeIcon size={18} />}
      </button>

      {open ? (
        <div className="wx-player__volume-pop">
          <div
            ref={trackRef}
            className={`wx-player__volume-track${dragging ? ' is-dragging' : ''}`}
            role="slider"
            tabIndex={0}
            aria-label="音量"
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(shown * 100)}
            onPointerDown={onTrackDown}
            onPointerMove={onTrackMove}
            onPointerUp={onTrackUp}
            onPointerCancel={onTrackUp}
            onKeyDown={onTrackKey}
          >
            <span className="wx-player__volume-fill" style={{ height: `${shown * 100}%` }} />
            <span className="wx-player__volume-thumb" style={{ bottom: `${shown * 100}%` }} />
          </div>
        </div>
      ) : null}
    </div>
  )
}
