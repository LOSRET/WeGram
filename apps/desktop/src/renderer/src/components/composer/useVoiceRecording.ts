import { useCallback, useEffect, useRef, useState } from 'react'

import { errorMessage } from '../../lib/ipc'
import {
  VOICE_MAX_SECONDS,
  startVoiceRecording,
  voiceRecordingSupported,
  type RecordedVoice,
  type VoiceRecording,
} from '../../lib/voice/recorder'
import { useAppStore } from '../../store/useAppStore'

/** What the green arrow / the cross asked for once the recorder is ready. */
interface Session {
  recorder: VoiceRecording | null
  startedAt: number
  /** Set by send or cancel; the recorder may still be opening when they land. */
  want: 'send' | 'cancel' | null
}

export interface VoiceRecordingController {
  supported: boolean
  /** The card shows the recording controls while this is true. */
  recording: boolean
  seconds: number
  /** Live input level 0..1, for the dot meter. */
  level: number
  /** Starts a clip; the microphone may take a moment to open. */
  start(): void
  /** The green arrow: stops and sends. */
  send(): void
  /** The cross (and Esc): stops and throws the clip away. */
  cancel(): void
}

/**
 * 语音消息's recording state machine.
 *
 * A voice note is clicked, not held: WeChat 4.x starts recording when the mic is
 * clicked and then shows a cancel cross, a live dot meter and the green send
 * arrow inside the composer card — there is no push-to-talk gesture on the
 * desktop. This hook owns that state; the card owns the drawing.
 *
 * The recorder opens asynchronously, so a send/cancel pressed in that first
 * moment is remembered in the session ref and applied when the recorder lands;
 * the session lives in a ref because state would be stale by then.
 */
export function useVoiceRecording(options: {
  onSend: (voice: RecordedVoice) => Promise<void> | void
  onRecordingChange?: (recording: boolean) => void
}): VoiceRecordingController {
  const { onSend, onRecordingChange } = options
  const session = useRef<Session | null>(null)
  const timer = useRef<number | null>(null)
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [level, setLevel] = useState(0)
  const supported = voiceRecordingSupported()

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearInterval(timer.current)
      timer.current = null
    }
  }, [])

  const reset = useCallback(() => {
    clearTimer()
    setRecording(false)
    setSeconds(0)
    setLevel(0)
    onRecordingChange?.(false)
  }, [clearTimer, onRecordingChange])

  /** Applies the pending send/cancel once the recorder exists. */
  const settle = useCallback(async (): Promise<void> => {
    const current = session.current
    if (!current || current.want === null || !current.recorder) return
    session.current = null
    reset()
    if (current.want === 'cancel') {
      current.recorder.cancel()
      return
    }
    try {
      await onSend(await current.recorder.stop())
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
    }
  }, [onSend, reset])

  /** Drops a session the recorder never opened (a refused microphone). */
  const abandon = useCallback(
    (message: string): void => {
      session.current = null
      reset()
      useAppStore.getState().setError(message)
    },
    [reset],
  )

  const start = useCallback((): void => {
    if (!supported || session.current) return
    const current: Session = { recorder: null, startedAt: Date.now(), want: null }
    session.current = current
    setRecording(true)
    setSeconds(0)
    setLevel(0)
    onRecordingChange?.(true)

    timer.current = window.setInterval(() => {
      const active = session.current
      if (!active) return
      const elapsed = (Date.now() - active.startedAt) / 1000
      setSeconds(elapsed)
      setLevel(active.recorder?.level() ?? 0)
      // The client's own cap: a clip that reaches 60 s is sent as it is.
      if (elapsed >= VOICE_MAX_SECONDS) {
        active.want = 'send'
        void settle()
      }
    }, 100)

    startVoiceRecording()
      .then((recorder) => {
        const active = session.current
        if (!active) {
          recorder.cancel()
          return
        }
        active.recorder = recorder
        void settle()
      })
      .catch((error: unknown) => {
        if (!session.current) return
        abandon(errorMessage(error))
      })
  }, [abandon, onRecordingChange, settle, supported])

  const send = useCallback((): void => {
    const current = session.current
    if (!current) return
    current.want = 'send'
    void settle()
  }, [settle])

  const cancel = useCallback((): void => {
    const current = session.current
    if (!current) return
    current.want = 'cancel'
    void settle()
  }, [settle])

  // Esc cancels an open clip, like every other transient state in the app.
  useEffect(() => {
    if (!recording) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cancel, recording])

  // Leaving the chat mid-recording must release the microphone.
  useEffect(() => {
    return () => {
      const current = session.current
      session.current = null
      current?.recorder?.cancel()
      if (timer.current !== null) window.clearInterval(timer.current)
    }
  }, [])

  return { supported, recording, seconds, level, start, send, cancel }
}
