import type { MessageMedia } from '@wechatgram/protocol'
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { ensureMedia, formatBytes, progressRatio, useFileProgress, useMediaUrl } from '../lib/media'
import { formatDuration } from '../lib/format'
import { errorMessage, invoke } from '../lib/ipc'
import { useAppStore } from '../store/useAppStore'

interface MediaBubbleProps {
  media: MessageMedia
  kind: 'photo' | 'video' | 'file' | 'voice'
}

const MAX_PHOTO_W = 240
const MAX_PHOTO_H = 300

/**
 * The media half of a message. Photos and videos reserve their final box from
 * the dimensions in the DTO before the file arrives (design doc §8.2 rule 4:
 * height changes on load must not move the anchored row), so the blur-up
 * thumbnail appears in place and the bubble never collapses.
 */
export function MediaBubble({ media, kind }: MediaBubbleProps) {
  if (kind === 'photo') return <PhotoBubble media={media} />
  if (kind === 'video') return <VideoBubble media={media} />
  if (kind === 'voice') return <VoiceBubble media={media} />
  return <FileBubble media={media} />
}

function useBubbleProgress(media: MessageMedia) {
  const progress = useFileProgress(media.fileId)
  return { ratio: progressRatio(progress), completed: progress?.completed ?? false }
}

function PhotoBubble({ media }: { media: MessageMedia }) {
  const url = useMediaUrl(media, 10)
  const { ratio } = useBubbleProgress(media)
  const progress = useFileProgress(media.fileId)
  const [lightbox, setLightbox] = useState(false)
  const uploading = Boolean(progress && !progress.completed && ratio !== undefined)

  const width = media.width ?? 4
  const height = media.height ?? 3
  const scale = Math.min(MAX_PHOTO_W / width, MAX_PHOTO_H / height)
  const box = {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  }

  return (
    <>
      <button
        type="button"
        className="wx-photo"
        style={box}
        onClick={() => url && setLightbox(true)}
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
          <img
            className="wx-photo__image"
            src={url}
            alt={media.fileName ?? '图片'}
            loading="lazy"
          />
        ) : (
          <span className="wx-photo__pending">
            {ratio === undefined ? <span className="wx-spinner" /> : `${Math.round(ratio * 100)}%`}
          </span>
        )}
        {url && uploading ? (
          <span className="wx-photo__upload">{Math.round((ratio ?? 0) * 100)}%</span>
        ) : null}
      </button>

      {lightbox && url
        ? createPortal(
            // Portal: virtualised rows are transform-positioned, and a fixed
            // overlay inside a transformed ancestor would be positioned against
            // that row instead of the window.
            <div className="wx-lightbox" onClick={() => setLightbox(false)}>
              <img
                src={url}
                alt={media.fileName ?? '图片'}
                onClick={(event) => event.stopPropagation()}
              />
              <div className="wx-lightbox__actions">
                <button
                  className="wx-button"
                  onClick={(event) => {
                    event.stopPropagation()
                    void invoke('media:open', { fileId: media.fileId }).catch((error) =>
                      useAppStore.getState().setError(errorMessage(error)),
                    )
                  }}
                >
                  在系统中打开
                </button>
                <button className="wx-button wx-button--ghost" onClick={() => setLightbox(false)}>
                  关闭
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

function VideoBubble({ media }: { media: MessageMedia }) {
  const url = useMediaUrl(media, 6)
  const { ratio } = useBubbleProgress(media)
  const [playing, setPlaying] = useState(false)

  const width = media.width ?? 16
  const height = media.height ?? 9
  const scale = Math.min(MAX_PHOTO_W / width, MAX_PHOTO_H / height)
  const box = { width: Math.round(width * scale), height: Math.round(height * scale) }

  if (url && playing) {
    return (
      <video
        className="wx-video"
        style={box}
        src={url}
        controls
        autoPlay
        playsInline
        onEnded={() => setPlaying(false)}
      />
    )
  }

  return (
    <button
      type="button"
      className="wx-video wx-video--poster"
      style={box}
      onClick={() => setPlaying(true)}
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
      <span className="wx-video__play">▶</span>
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
