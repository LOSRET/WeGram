import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'

import { formatDuration } from '../../lib/format'
import { errorMessage } from '../../lib/ipc'
import {
  VOICE_MAX_SECONDS,
  startVoiceRecording,
  voiceRecordingSupported,
  type RecordedVoice,
  type VoiceRecording,
} from '../../lib/voice/recorder'
import { useAppStore } from '../../store/useAppStore'

/** How far the finger has to slide up before the release cancels. */
const CANCEL_DISTANCE = 48
/** Bars in the recording panel's wave. */
const BAR_COUNT = 18

export interface VoiceRecorderProps {
  disabled?: boolean
  /** Sends the finished clip through the chat's send path. */
  onSend: (voice: RecordedVoice) => Promise<void> | void
  /**
   * True while the microphone is live, so the composer can show the peer
   * "recording a voice message" instead of "typing".
   */
  onRecordingChange?: (recording: boolean) => void
}

/**
 * One hold-to-record gesture.
 *
 * The session lives in a ref, not in state, because the pointer is released
 * before `getUserMedia` and the encoder have started: the ref is what the late
 * answer checks to decide whether the clip should be sent or dropped. State is
 * only what the overlay draws.
 */
interface Session {
  recording: VoiceRecording | null
  startY: number
  cancelled: boolean
  released: boolean
  startedAt: number
}

/**
 * 语音消息's gesture: press and hold 按住 说话, slide up to cancel, release to send.
 *
 * The panel is portalled to `body` so it can float over the transcript without
 * becoming a row — anything inside the virtualised list would re-measure it.
 * Recording happens in `lib/voice/recorder.ts` (WebCodecs); this component only
 * owns the gesture, the timer and the panel.
 */
export function VoiceRecorder({ disabled = false, onSend, onRecordingChange }: VoiceRecorderProps) {
  const session = useRef<Session | null>(null)
  const timer = useRef<number | null>(null)
  const [live, setLive] = useState(false)
  const [cancelled, setCancelled] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [bars, setBars] = useState<number[]>(() => new Array(BAR_COUNT).fill(0))
  const supported = voiceRecordingSupported()

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearInterval(timer.current)
      timer.current = null
    }
  }, [])

  /** Ends the gesture: sends the clip, or throws it away. Safe to call twice. */
  const finish = useCallback(
    async (discard: boolean): Promise<void> => {
      const current = session.current
      if (!current) return
      session.current = null
      clearTimer()
      setLive(false)
      setCancelled(false)
      onRecordingChange?.(false)
      const { recording } = current
      if (!recording) return
      if (discard) {
        recording.cancel()
        return
      }
      try {
        await onSend(await recording.stop())
      } catch (error) {
        useAppStore.getState().setError(errorMessage(error))
      }
    },
    [clearTimer, onRecordingChange, onSend],
  )

  const begin = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (disabled || !supported || session.current || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const current: Session = {
      recording: null,
      startY: event.clientY,
      cancelled: false,
      released: false,
      startedAt: Date.now(),
    }
    session.current = current
    setLive(true)
    setCancelled(false)
    setElapsed(0)
    setBars(new Array(BAR_COUNT).fill(0))
    onRecordingChange?.(true)

    timer.current = window.setInterval(() => {
      const active = session.current
      if (!active) return
      const seconds = (Date.now() - active.startedAt) / 1000
      setElapsed(seconds)
      const level = active.recording?.level() ?? 0
      setBars((previous) => [...previous.slice(1), level])
      // The client's own cap: a held gesture stops and sends at 60 seconds.
      if (seconds >= VOICE_MAX_SECONDS) void finish(false)
    }, 100)

    startVoiceRecording()
      .then((recording) => {
        const active = session.current
        if (!active) {
          // The gesture was let go while the microphone was still opening.
          recording.cancel()
          return
        }
        active.recording = recording
        if (active.released) void finish(active.cancelled)
      })
      .catch((error: unknown) => {
        session.current = null
        clearTimer()
        setLive(false)
        onRecordingChange?.(false)
        useAppStore.getState().setError(errorMessage(error))
      })
  }

  const move = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const active = session.current
    if (!active) return
    const discard = active.startY - event.clientY > CANCEL_DISTANCE
    if (discard === active.cancelled) return
    active.cancelled = discard
    setCancelled(discard)
  }

  const release = (): void => {
    const active = session.current
    if (!active) return
    active.released = true
    if (active.recording) void finish(active.cancelled)
  }

  /** A lost pointer or Esc throws the clip away instead of sending it. */
  const abort = (): void => {
    const active = session.current
    if (!active) return
    active.cancelled = true
    active.released = true
    setCancelled(true)
    if (active.recording) void finish(true)
  }

  useEffect(() => {
    if (!live) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') abort()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Leaving the chat (or the composer) mid-recording must release the microphone.
  useEffect(() => {
    return () => {
      const active = session.current
      session.current = null
      active?.recording?.cancel()
      clearTimer()
    }
  }, [clearTimer])

  return (
    <>
      <button
        type="button"
        className={`wx-composer__hold${live ? ' wx-composer__hold--live' : ''}`}
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={release}
        onPointerCancel={abort}
        onLostPointerCapture={abort}
        onContextMenu={(event) => event.preventDefault()}
        disabled={disabled || !supported}
        title={supported ? '按住说话，松开发送，上滑取消' : '这台设备不支持录音'}
      >
        {supported ? '按住 说话' : '无法录音'}
      </button>

      {live
        ? createPortal(
            <div className="wx-voice-rec" role="status" aria-live="polite">
              <div
                className={`wx-voice-rec__panel${cancelled ? ' wx-voice-rec__panel--cancel' : ''}`}
              >
                <div className="wx-voice-rec__wave" aria-hidden>
                  {bars.map((level, index) => (
                    <span
                      // The bar's identity is its slot in the wave, not its height.
                      key={index}
                      style={{ height: `${16 + Math.round(level * 84)}%` }}
                    />
                  ))}
                </div>
                <div className="wx-voice-rec__time">{formatDuration(Math.floor(elapsed))}</div>
                <div className="wx-voice-rec__hint">
                  {cancelled ? '松开 取消' : '上滑 取消 · 松开 发送'}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
