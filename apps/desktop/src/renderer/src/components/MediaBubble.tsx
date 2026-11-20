import type { MessageMedia } from '@wegram/protocol'
import { useRef, useState } from 'react'

import { ensureMedia, formatBytes, progressRatio, useFileProgress, useMediaUrl } from '../lib/media'
import { formatDuration } from '../lib/format'
import { percentOf, reserveBox } from '../lib/mediaBox'
import { errorMessage, invoke } from '../lib/ipc'
import { openPhotoViewer, openVideoViewer } from '../lib/viewer'
import { useViewerSource } from '../lib/viewerSource'
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
  /**
   * The reserved box's largest side. WeChat's 240×300 bubble photograph is the
   * default; a channel post is Telegram's wider card and asks for more.
   */
  maxWidth?: number
  maxHeight?: number
}

const MAX_PHOTO_W = 240
const MAX_PHOTO_H = 300

/** A channel post's media may grow past WeChat's 240×300 bubble photograph. */
export const CHANNEL_MEDIA_LIMITS = { maxWidth: 420, maxHeight: 480 } as const

/**
 * The inset a channel media bubble draws around its media. It is the
 * `--wx-channel-pad-x` of a media bubble in `styles/channel.css`; the bubble is
 * sized from the media plus this frame, so the picture sits flush.
 */
export const CHANNEL_MEDIA_INSET = 3

/** The ratio a photo / a video falls back to when TDLib gave no dimensions. */
const PHOTO_FALLBACK = { fallbackWidth: 4, fallbackHeight: 3 }
const VIDEO_FALLBACK = { fallbackWidth: 16, fallbackHeight: 9 }

/**
 * The width a channel post's media occupies, so the bubble that frames it can be
 * sized to the media itself. A long caption then wraps at the photograph's width —
 * the way Telegram's post reads — instead of widening the bubble and leaving a gap
 * to the right of the picture.
 */
export function channelMediaWidth(kind: 'photo' | 'video', media: MessageMedia): number {
  return reserveBox(media, {
    ...CHANNEL_MEDIA_LIMITS,
    ...(kind === 'photo' ? PHOTO_FALLBACK : VIDEO_FALLBACK),
  }).width
}

/**
 * The media half of a message. Photos and videos reserve their final box from
 * the dimensions in the DTO before the file arrives (design doc §8.2 rule 4:
 * height changes on load must not move the anchored row), so the blur-up
 * thumbnail appears in place and the bubble never collapses.
 */
export function MediaBubble({
  media,
  kind,
  chatId,
  messageId,
  variant,
  maxWidth = MAX_PHOTO_W,
  maxHeight = MAX_PHOTO_H,
}: MediaBubbleProps) {
  const inAlbum = variant === 'album'
  if (kind === 'photo') {
    return (
      <PhotoBubble
        media={media}
        chatId={chatId}
        messageId={messageId}
        inAlbum={inAlbum}
        maxWidth={maxWidth}
        maxHeight={maxHeight}
      />
    )
  }
  if (kind === 'video') {
    return (
      <VideoBubble
        media={media}
        chatId={chatId}
        messageId={messageId}
        inAlbum={inAlbum}
        maxWidth={maxWidth}
        maxHeight={maxHeight}
      />
    )
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
  maxWidth,
  maxHeight,
}: {
  media: MessageMedia
  chatId: number
  messageId: number
  inAlbum: boolean
  maxWidth: number
  maxHeight: number
}) {
  const url = useMediaUrl(media, 10)
  const { ratio } = useBubbleProgress(media)
  const progress = useFileProgress(media.fileId)
  const uploading = Boolean(progress && !progress.completed && ratio !== undefined)
  // The pane this bubble is drawn in, for panes that do not live in the chat store.
  const source = useViewerSource()

  const box = inAlbum
    ? undefined
    : reserveBox(media, {
        maxWidth,
        maxHeight,
        ...PHOTO_FALLBACK,
      })

  return (
    <button
      type="button"
      className={`wx-photo${inAlbum ? ' wx-photo--album' : ''}`}
      style={box}
      // The client opens the photo in its own window, not in an overlay.
      onClick={() => openPhotoViewer(chatId, messageId, source)}
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
  maxWidth,
  maxHeight,
}: {
  media: MessageMedia
  chatId: number
  messageId: number
  inAlbum: boolean
  maxWidth: number
  maxHeight: number
}) {
  const url = useMediaUrl(media, 6)
  const { ratio } = useBubbleProgress(media)
  const source = useViewerSource()

  const box = inAlbum
    ? undefined
    : reserveBox(media, {
        maxWidth,
        maxHeight,
        ...VIDEO_FALLBACK,
      })

  // Like a photo, a video opens in the client's 图片和视频 window — it does not
  // play inside the bubble, and the transport lives in that window's player bar.
  return (
    <button
      type="button"
      className={`wx-video wx-video--poster${inAlbum ? ' wx-video--album' : ''}`}
      style={box}
      onClick={() => openVideoViewer(chatId, messageId, source)}
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
