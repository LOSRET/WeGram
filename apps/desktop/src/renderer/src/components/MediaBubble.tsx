import type { MessageMedia } from '@wegram/protocol'
import { useEffect, useMemo, useRef, useState } from 'react'

import { formatDuration } from '../lib/format'
import { errorMessage, invoke } from '../lib/ipc'
import {
  ensureMedia,
  formatBytes,
  nextOwner,
  progressRatio,
  releaseMedia,
  streamMedia,
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
  /**
   * The reserved box's largest side. WeChat's 240×300 bubble photograph is the
   * default; a channel post is Telegram's wider card and asks for more.
   */
  maxWidth?: number
  maxHeight?: number
  /**
   * The "GIF" corner badge. Telegram hides it on an animation that carries a
   * caption (the text is the label there), so the row turns it off when it has one.
   */
  showAnimationBadge?: boolean
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
export function MediaBubble({
  media,
  kind,
  chatId,
  messageId,
  variant,
  maxWidth = MAX_PHOTO_W,
  maxHeight = MAX_PHOTO_H,
  showAnimationBadge = true,
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
    // A GIF (TDLib `messageAnimation`) is a video file that plays in the bubble;
    // an ordinary clip waits for the viewer. Same file, two behaviours.
    return media.isAnimation ? (
      <AnimationBubble
        media={media}
        chatId={chatId}
        messageId={messageId}
        inAlbum={inAlbum}
        maxWidth={maxWidth}
        maxHeight={maxHeight}
        showBadge={showAnimationBadge}
      />
    ) : (
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
  const [ref, view] = useInView<HTMLButtonElement>(MEDIA_PRELOAD_PX)
  const [loadedUrl, setLoadedUrl] = useState<string>()
  // The pane this bubble is drawn in, for panes that do not live in the chat store.
  const source = useViewerSource()

  const box = inAlbum
    ? undefined
    : reserveBox(media, {
        maxWidth,
        maxHeight,
        ...PHOTO_FALLBACK,
      })

  // A picture already on disk is the picture: asking for a variant of it would
  // download bytes we already have.
  const variant = media.localUrl
    ? undefined
    : pickVariant(media.sizes, deviceBox(box, maxWidth, maxHeight))
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
  const [ref, view] = useInView<HTMLButtonElement>(MEDIA_PRELOAD_PX)
  const source = useViewerSource()

  const box = inAlbum
    ? undefined
    : reserveBox(media, {
        maxWidth,
        maxHeight,
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

/**
 * Telegram's GIF: the clip plays inside the bubble — muted, looping, no controls
 * — and a click opens the same 图片和视频 window a video uses. It streams through
 * the scheme handler (design doc §8.7), so it starts while TDLib is still
 * fetching, and it pauses whenever the bubble scrolls out of view.
 */
function AnimationBubble({
  media,
  chatId,
  messageId,
  inAlbum,
  maxWidth,
  maxHeight,
  showBadge,
}: {
  media: MessageMedia
  chatId: number
  messageId: number
  inAlbum: boolean
  maxWidth: number
  maxHeight: number
  showBadge: boolean
}) {
  const [ref, view] = useInView<HTMLButtonElement>(MEDIA_PRELOAD_PX)
  const source = useViewerSource()
  const [url, setUrl] = useState<string>()
  const [failed, setFailed] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const ownerRef = useRef('')
  if (!ownerRef.current) ownerRef.current = nextOwner('animation')

  const box = inAlbum
    ? undefined
    : reserveBox(media, {
        maxWidth,
        maxHeight,
        ...VIDEO_FALLBACK,
      })

  const posterMedia = useMemo(() => thumbMediaOf(media, media.fileId), [media])
  const posterUrl = useMediaUrl(posterMedia, thumbPriority(view.visible), view.armed)
  const progress = useFileProgress(media.fileId)
  const ratio = progressRatio(progress)
  const poster =
    posterUrl ?? (media.minithumbnail ? `data:image/jpeg;base64,${media.minithumbnail}` : undefined)

  useEffect(() => {
    if (!view.armed || url) return
    let alive = true
    void streamMedia(media.fileId, ownerRef.current)
      .then((next) => {
        if (alive) setUrl(next)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [view.armed, url, media.fileId])

  // Same rule as a sticker: only the animation on screen runs, so a transcript of
  // GIFs does not decode a screenful of them.
  useEffect(() => {
    const video = videoRef.current
    if (!video || !url) return
    if (view.visible) void video.play().catch(() => undefined)
    else video.pause()
  }, [view.visible, url])

  useEffect(() => () => releaseMedia(ownerRef.current), [])

  return (
    <button
      ref={ref}
      type="button"
      className={`wx-video wx-video--animation${inAlbum ? ' wx-video--album' : ''}`}
      style={box}
      onClick={() => openVideoViewer(chatId, messageId, source)}
      title="查看动图"
    >
      {url && !failed ? (
        <video
          ref={videoRef}
          className="wx-video__clip"
          src={url}
          poster={poster}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-label="动图"
          onError={() => setFailed(true)}
        />
      ) : poster ? (
        <img className="wx-video__poster" src={poster} alt="" aria-hidden />
      ) : null}
      {!url && !failed && ratio !== undefined ? (
        <span className="wx-video__progress">{percentOf(ratio)}</span>
      ) : null}
      {failed ? <span className="wx-video__progress">动图加载失败</span> : null}
      {showBadge ? <span className="wx-video__gif">GIF</span> : null}
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
