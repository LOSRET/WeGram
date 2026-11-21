import type { MessageMedia } from '@wegram/protocol'
import { useMemo, useRef, useState } from 'react'

import { formatDuration } from '../lib/format'
import { errorMessage, invoke } from '../lib/ipc'
import {
  ensureMedia,
  formatBytes,
  nextOwner,
  progressRatio,
  useFileProgress,
  useMediaUrl,
} from '../lib/media'
import { percentOf, reserveBox } from '../lib/mediaBox'
import { bubblePriority, MEDIA_PRIORITY, thumbPriority } from '../lib/mediaPriority'
import { pickVariant } from '../lib/mediaVariant'
import { useInView } from '../lib/useInView'
import { openPhotoViewer, openVideoViewer } from '../lib/viewer'
import { useViewerSource } from '../lib/viewerSource'
import { useAppStore } from '../store/useAppStore'
import { PlayIcon } from './viewer/ViewerIcons'

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
 * How far outside the viewport a bubble's media starts downloading.
 *
 * About half a screen: the official client prefetches a screen ahead, so a
 * picture is already there when it scrolls in. The download is cancelled again
 * when the bubble leaves this margin.
 */
const MEDIA_PRELOAD_PX = 420

/** The ratio a photo / a video falls back to when TDLib gave no dimensions. */
const PHOTO_FALLBACK = { fallbackWidth: 4, fallbackHeight: 3 }
const VIDEO_FALLBACK = { fallbackWidth: 16, fallbackHeight: 9 }

/**
 * The DTO narrowed to one file id, without the full picture's cached URL.
 *
 * A photo's `localUrl` belongs to its *largest* file; handing that URL to a
 * variant would paint the original where a thumbnail was asked for. Only the DTO
 * that already names that file keeps it.
 */
function mediaAt(media: MessageMedia, fileId: number): MessageMedia {
  if (fileId === media.fileId) return media
  const { localUrl: _fullUrl, ...rest } = media
  return { ...rest, fileId }
}

/**
 * The bubble's thumbnail: TDLib's second, small size of the same picture — the
 * official client's "sharp placeholder" between the blurred minithumbnail and
 * the picture the reader asked for.
 */
function thumbMediaOf(media: MessageMedia, primaryFileId: number): MessageMedia | undefined {
  const thumbFileId = media.thumbFileId ?? 0
  if (thumbFileId <= 0 || thumbFileId === primaryFileId) return undefined
  const thumb = mediaAt(media, thumbFileId)
  return media.thumbUrl ? { ...thumb, localUrl: media.thumbUrl } : thumb
}

/** The box a picture will be painted in, in device pixels (CSS px × DPR). */
function deviceBox(
  box: { width: number; height: number } | undefined,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const ratio = window.devicePixelRatio || 1
  const css = box ?? { width: maxWidth, height: maxHeight }
  return { width: css.width * ratio, height: css.height * ratio }
}

/**
 * The media half of a message. Photos and videos reserve their final box from
 * the dimensions in the DTO before the file arrives (design doc §8.2 rule 4:
 * height changes on load must not move the anchored row), so the blur-up
 * thumbnail appears in place and the bubble never collapses.
 *
 * Loading follows the official client rather than "download the biggest file when
 * the row mounts":
 * - the minithumbnail paints instantly, then TDLib's small size sharpens it;
 * - a photo asks for the smallest variant that still covers its box (§8.7);
 * - nothing downloads until the bubble is about half a screen away, and the
 *   transfer stops again once it leaves;
 * - a video only fetches its poster here — the clip is streamed by the viewer.
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
  const [ref, view] = useInView<HTMLButtonElement>(MEDIA_PRELOAD_PX)
  const [loadedUrl, setLoadedUrl] = useState<string>()
  // The pane this bubble is drawn in, for panes that do not live in the chat store.
  const source = useViewerSource()

  const box = inAlbum
    ? undefined
    : reserveBox(media, {
        maxWidth: MAX_PHOTO_W,
        maxHeight: MAX_PHOTO_H,
        ...PHOTO_FALLBACK,
      })

  // A picture already on disk is the picture: asking for a variant of it would
  // download bytes we already have.
  const variant = media.localUrl
    ? undefined
    : pickVariant(media.sizes, deviceBox(box, MAX_PHOTO_W, MAX_PHOTO_H))
  const primaryId = variant?.fileId ?? media.fileId

  const primaryMedia = useMemo(() => mediaAt(media, primaryId), [media, primaryId])
  const thumbMedia = useMemo(() => thumbMediaOf(media, primaryId), [media, primaryId])

  const primaryUrl = useMediaUrl(primaryMedia, bubblePriority(view.visible), view.armed)
  const thumbUrl = useMediaUrl(thumbMedia, thumbPriority(view.visible), view.armed)

  // Sending and receiving are different files here: the upload progress belongs
  // to the file we sent, the percentage to the variant being downloaded.
  const upload = useFileProgress(media.fileId)
  const download = useFileProgress(primaryId)
  const upRatio = progressRatio(upload)
  const downRatio = progressRatio(download)
  const sending = Boolean(upload && !upload.completed && upRatio !== undefined)
  const ready = Boolean(primaryUrl && loadedUrl === primaryUrl)

  return (
    <button
      ref={ref}
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
      {thumbUrl && !ready ? (
        <img className="wx-photo__preview" src={thumbUrl} alt="" aria-hidden />
      ) : null}
      {primaryUrl ? (
        <img
          className={`wx-photo__image${ready ? ' is-loaded' : ''}`}
          src={primaryUrl}
          alt={media.fileName ?? '图片'}
          loading="lazy"
          onLoad={() => setLoadedUrl(primaryUrl)}
        />
      ) : null}
      {!primaryUrl && !thumbUrl && !media.minithumbnail ? (
        <span className="wx-photo__pending">
          {downRatio === undefined ? <span className="wx-spinner" /> : percentOf(downRatio)}
        </span>
      ) : null}
      {primaryUrl && sending ? (
        <span className="wx-photo__upload">{percentOf(upRatio ?? 0)}</span>
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
  const [ref, view] = useInView<HTMLButtonElement>(MEDIA_PRELOAD_PX)
  const source = useViewerSource()

  const box = inAlbum
    ? undefined
    : reserveBox(media, {
        maxWidth: MAX_PHOTO_W,
        maxHeight: MAX_PHOTO_H,
        ...VIDEO_FALLBACK,
      })

  const posterMedia = useMemo(() => thumbMediaOf(media, media.fileId), [media])
  const posterUrl = useMediaUrl(posterMedia, thumbPriority(view.visible), view.armed)

  // Like a photo, a video opens in the client's 图片和视频 window — it does not
  // play inside the bubble, and the transport lives in that window's player bar.
  // The clip itself is not downloaded here: the viewer streams it (§8.7).
  return (
    <button
      ref={ref}
      type="button"
      className={`wx-video wx-video--poster${inAlbum ? ' wx-video--album' : ''}`}
      style={box}
      onClick={() => openVideoViewer(chatId, messageId, source)}
      title="播放视频"
    >
      {media.minithumbnail ? (
        <img
          className="wx-video__thumb"
          src={`data:image/jpeg;base64,${media.minithumbnail}`}
          alt=""
          aria-hidden
        />
      ) : null}
      {posterUrl ? <img className="wx-video__poster" src={posterUrl} alt="" aria-hidden /> : null}
      <span className="wx-video__play" aria-hidden>
        <PlayIcon size={inAlbum ? 26 : 34} />
      </span>
      {media.duration ? (
        <span className="wx-video__duration">{formatDuration(media.duration)}</span>
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
  const url = useMediaUrl(media, MEDIA_PRIORITY.idle)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const { ratio } = useBubbleProgress(media)

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
