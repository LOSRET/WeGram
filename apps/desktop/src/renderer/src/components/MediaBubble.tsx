import type { MessageMedia } from '@wegram/protocol'
import { useRef, useState } from 'react'

import { ensureMedia, formatBytes, progressRatio, useFileProgress, useMediaUrl } from '../lib/media'
import { formatDuration } from '../lib/format'
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
}

const MAX_PHOTO_W = 240
const MAX_PHOTO_H = 300

/**
 * The media half of a message. Photos and videos reserve their final box from
 * the dimensions in the DTO before the file arrives (design doc §8.2 rule 4:
 * height changes on load must not move the anchored row), so the blur-up
 * thumbnail appears in place and the bubble never collapses.
 */
export function MediaBubble({ media, kind, chatId, messageId }: MediaBubbleProps) {
  if (kind === 'photo') return <PhotoBubble media={media} chatId={chatId} messageId={messageId} />
  if (kind === 'video') {
    return <VideoBubble media={media} chatId={chatId} messageId={messageId} />
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
}: {
  media: MessageMedia
  chatId: number
  messageId: number
}) {
  const url = useMediaUrl(media, 10)
  const { ratio } = useBubbleProgress(media)
  const progress = useFileProgress(media.fileId)
  const uploading = Boolean(progress && !progress.completed && ratio !== undefined)

  const width = media.width ?? 4
  const height = media.height ?? 3
  const scale = Math.min(MAX_PHOTO_W / width, MAX_PHOTO_H / height)
  const box = {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  }

  return (
    <button
      type="button"
      className="wx-photo"
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
          {ratio === undefined ? <span className="wx-spinner" /> : `${Math.round(ratio * 100)}%`}
        </span>
      )}
      {url && uploading ? (
        <span className="wx-photo__upload">{Math.round((ratio ?? 0) * 100)}%</span>
      ) : null}
    </button>
  )
}

function VideoBubble({
  media,
  chatId,
  messageId,
}: {
  media: MessageMedia
  chatId: number
  messageId: number
}) {
  const url = useMediaUrl(media, 6)
  const { ratio } = useBubbleProgress(media)

  const width = media.width ?? 16
  const height = media.height ?? 9
  const scale = Math.min(MAX_PHOTO_W / width, MAX_PHOTO_H / height)
  const box = { width: Math.round(width * scale), height: Math.round(height * scale) }

  // Like a photo, a video opens in the client's 图片和视频 window — it does not
  // play inside the bubble, and the transport lives in that window's player bar.
  return (
    <button
      type="button"
      className="wx-video wx-video--poster"
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
        <PlayIcon size={34} />
      </span>
      {media.duration ? (
        <span className="wx-video__duration">{formatDuration(media.duration)}</span>
      ) : null}
      {!url && ratio !== undefined ? (
        <span className="wx-video__progress">{Math.round(ratio * 100)}%</span>
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
            ? ` · ${Math.round(ratio * 100)}%`
            : opening
              ? ' · 正在打开…'
              : ''}
        </span>
        {!completed && ratio !== undefined ? (
          <span className="wx-file__bar">
            <span style={{ width: `${Math.round(ratio * 100)}%` }} />
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
        {!url && ratio !== undefined
          ? `${Math.round(ratio * 100)}%`
          : formatDuration(media.duration)}
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
