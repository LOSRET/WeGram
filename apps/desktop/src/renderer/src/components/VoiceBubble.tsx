import type { MessageMedia } from '@wegram/protocol'
import { useRef, useState } from 'react'

import { ensureMedia, nextOwner, progressRatio, useFileProgress, useMediaUrl } from '../lib/media'
import { percentOf } from '../lib/mediaBox'
import { MEDIA_PRIORITY } from '../lib/mediaPriority'
import { voiceBubbleWidth, voiceSecondsLabel } from '../lib/voiceBubble'
import { VoiceWaveIcon } from './Icon'

/**
 * 语音消息, drawn the way WeChat does: a plain bubble whose width grows with the
 * clip, the seconds with a double-prime on one side and the sound waves on the
 * other. There is no play triangle and no drawn waveform — the whole bubble
 * plays, and the waves pulse while it does.
 *
 * Split out of MediaBubble.tsx when that file reached its line cap: the voice
 * strip shares nothing with the photo/video/file geometry.
 */
export function VoiceBubble({ media, outgoing }: { media: MessageMedia; outgoing: boolean }) {
  const url = useMediaUrl(media, MEDIA_PRIORITY.idle)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const ratio = progressRatio(useFileProgress(media.fileId))

  const toggle = (): void => {
    const audio = audioRef.current
    if (!audio) {
      void ensureMedia(media.fileId, MEDIA_PRIORITY.idle, nextOwner('voice')).catch(() => undefined)
      return
    }
    if (playing) {
      audio.pause()
      setPlaying(false)
    } else {
      void audio
        .play()
        .then(() => setPlaying(true))
        .catch(() => undefined)
    }
  }

  return (
    <button
      type="button"
      className={`wx-voice${playing ? ' wx-voice--playing' : ''}${outgoing ? ' wx-voice--self' : ''}`}
      style={{ width: voiceBubbleWidth(media.duration) }}
      onClick={toggle}
      title="语音消息"
    >
      <span className="wx-voice__time">
        {!url && ratio !== undefined ? percentOf(ratio) : voiceSecondsLabel(media.duration)}
      </span>
      <span className="wx-voice__wave" aria-hidden>
        <VoiceWaveIcon size={16} />
      </span>
      {url ? (
        <audio
          ref={audioRef}
          src={url}
          onEnded={() => setPlaying(false)}
          onPause={() => setPlaying(false)}
          hidden
        />
      ) : null}
    </button>
  )
}
