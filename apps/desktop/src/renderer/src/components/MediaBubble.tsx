import type { MessageMedia } from '@wegram/protocol'
import { useRef, useState } from 'react'

import { ensureMedia, formatBytes, progressRatio, useFileProgress, useMediaUrl } from '../lib/media'
import { formatDuration } from '../lib/format'
import { percentOf, reserveBox } from '../lib/mediaBox'
import { errorMessage, invoke } from '../lib/ipc'
import { openPhotoViewer, openVideoViewer } from '../lib/viewer'
import { PlayIcon } from './viewer/ViewerIcons'
import { useAppStore } from '../store/useAppStore'

interface MediaBubbleProps {
  media: MessageMedia
  kind: 'photo' | 'video' | 'file' | 'voice'
  /** Conversation and message the media belongs to; the photo viewer needs both. */
  chatId: number
  messageId: number
  /**
   * `album` renders the media as one cell of an album grid (design doc §8.6): the
   * grid's CSS owns the box, so the bubble's inline size is skipped.
   */
  variant?: 'bubble' | 'album'
}

const MAX_PHOTO_W = 240
const MAX_PHOTO_H = 300

/**
 * The media half of a message. Photos and videos reserve their final box from
 * the dimensions in the DTO before the file arrives (design doc §8.2 rule 4:
 * height changes on load must not move the anchored row), so the blur-up
 * thumbnail appears in place and the bubble never collapses.
 */
export function MediaBubble({ media, kind, chatId, messageId, variant }: MediaBubbleProps) {
  const inAlbum = variant === 'album'
  if (kind === 'photo') {
    return <PhotoBubble media={media} chatId={chatId} messageId={messageId} inAlbum={inAlbum} />
  }
  if (kind === 'video') {
    return <VideoBubble media={media} chatId={chatId} messageId={messageId} inAlbum={inAlbum} />
  }
  if (kind === 'voice') return <VoiceBubble media={media} />
  return <FileBubble media={media} />
}

function useBubbleProgress(media: MessageMedia) {
  const progress = useFileProgress(media.fileId)
  return { ratio: progressRatio(progress), completed: progress?.completed ?? false }
}

function PhotoBubble({
  media,
  chatId,
  messageId,
  inAlbum,
}: {
  media: MessageMedia
  chatId: number
  messageId: number
  inAlbum: boolean
}) {
  const url = useMediaUrl(media, 10)
  const { ratio } = useBubbleProgress(media)
  const progress = useFileProgress(media.fileId)
  const uploading = Boolean(progress && !progress.completed && ratio !== undefined)

  const box = inAlbum
    ? undefined
    : reserveBox(media, {
        maxWidth: MAX_PHOTO_W,
        maxHeight: MAX_PHOTO_H,
        fallbackWidth: 4,
        fallbackHeight: 3,
      })

  return (
    <button
      type="button"
      className={`wx-photo${inAlbum ? ' wx-photo--album' : ''}`}
      style={box}
      // The client opens the photo in its own window, not in an overlay.
      onClick={() => openPhotoViewer(chatId, messageId)}
      title="查看大图"
    >
      {media.minithumbnail ? (
        <img
          className="wx-photo__thumb"
          src={`data:image/jpeg;base64,${media.minithumbnail}`}
          alt=""
          aria-hidden
        />
      ) : null}
      {url ? (
        <img className="wx-photo__image" src={url} alt={media.fileName ?? '图片'} loading="lazy" />
      ) : (
        <span className="wx-photo__pending">
          {ratio === undefined ? <span className="wx-spinner" /> : percentOf(ratio)}
        </span>
      )}
      {url && uploading ? (
        <span className="wx-photo__upload">{percentOf(ratio ?? 0)}</span>
      ) : null}
    </button>
  )
}

function VideoBubble({
  media,
  chatId,
  messageId,
  inAlbum,
}: {
  media: MessageMedia
  chatId: number
  messageId: number
  inAlbum: boolean
}) {
  const url = useMediaUrl(media, 6)
  const { ratio } = useBubbleProgress(media)

  const box = inAlbum
    ? undefined
    : reserveBox(media, {
        maxWidth: MAX_PHOTO_W,
        maxHeight: MAX_PHOTO_H,
        fallbackWidth: 16,
        fallbackHeight: 9,
      })

  // Like a photo, a video opens in the client's 图片和视频 window — it does not
  // play inside the bubble, and the transport lives in that window's player bar.
  return (
    <button
      type="button"
      className={`wx-video wx-video--poster${inAlbum ? ' wx-video--album' : ''}`}
      style={box}
      onClick={() => openVideoViewer(chatId, messageId)}
      title="播放视频"
    >
      {media.minithumbnail ? (
        <img
          className="wx-photo__thumb"
          src={`data:image/jpeg;base64,${media.minithumbnail}`}
          alt=""
          aria-hidden
        />
      ) : null}
      <span className="wx-video__play" aria-hidden>
        <PlayIcon size={inAlbum ? 26 : 34} />
      </span>
      {media.duration ? (
        <span className="wx-video__duration">{formatDuration(media.duration)}</span>
      ) : null}
      {!url && ratio !== undefined ? (
        <span className="wx-video__progress">{percentOf(ratio)}</span>
      ) : null}
    </button>
  )
}

function FileBubble({ media }: { media: MessageMedia }) {
  const { ratio, completed } = useBubbleProgress(media)
  const [opening, setOpening] = useState(false)

  const open = async (): Promise<void> => {
    setOpening(true)
    try {
      await invoke('media:open', { fileId: media.fileId })
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
    } finally {
      setOpening(false)
    }
  }

  const extension = (media.fileName ?? '').split('.').pop()?.toUpperCase() ?? 'FILE'

  return (
    <button type="button" className="wx-file" onClick={() => void open()} title="打开文件">
      <span className="wx-file__icon">{extension.slice(0, 4)}</span>
      <span className="wx-file__main">
        <span className="wx-file__name">{media.fileName ?? '未命名文件'}</span>
        <span className="wx-file__meta">
          {formatBytes(media.size)}
          {!completed && ratio !== undefined && !opening
            ? ` · ${percentOf(ratio)}`
            : opening
              ? ' · 正在打开…'
              : ''}
        </span>
        {!completed && ratio !== undefined ? (
          <span className="wx-file__bar">
            <span style={{ width: percentOf(ratio) }} />
          </span>
        ) : null}
      </span>
    </button>
  )
}

function VoiceBubble({ media }: { media: MessageMedia }) {
  const url = useMediaUrl(media, 8)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const { ratio } = useBubbleProgress(media)

  const toggle = (): void => {
    const audio = audioRef.current
    if (!audio) {
      void ensureMedia(media.fileId, 8).catch(() => undefined)
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
      className={`wx-voice${playing ? ' wx-voice--playing' : ''}`}
      onClick={toggle}
      title="语音消息"
    >
      <span className="wx-voice__icon">{playing ? '❚❚' : '▶'}</span>
      <span className="wx-voice__wave" aria-hidden>
        {'▁▃▅▇▅▃▁'.repeat(3)}
      </span>
      <span className="wx-voice__time">
        {!url && ratio !== undefined ? percentOf(ratio) : formatDuration(media.duration)}
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
