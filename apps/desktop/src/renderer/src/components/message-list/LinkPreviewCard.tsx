import type { LinkPreview, LinkPreviewMedia, MessageMedia } from '@wegram/protocol'
import { useMemo, type CSSProperties } from 'react'

import { formatDuration } from '../../lib/format'
import { previewHue } from '../../lib/linkPreview'
import { useMediaUrl } from '../../lib/media'
import { thumbPriority } from '../../lib/mediaPriority'
import { useInView } from '../../lib/useInView'

/** How far outside the viewport a card's picture starts downloading. */
const PREVIEW_PRELOAD_PX = 320

/**
 * The file the card asks for: TDLib's small variant when it sent one.
 *
 * A card is 120–260 px wide, so the original would be a download nobody reads.
 * `localUrl` names the largest file, so it is dropped with the id it belonged to.
 */
function previewFile(media: MessageMedia): MessageMedia {
  const thumbFileId = media.thumbFileId ?? 0
  if (thumbFileId <= 0 || thumbFileId === media.fileId) return media
  const { localUrl: _fullUrl, ...rest } = media
  return {
    ...rest,
    fileId: thumbFileId,
    ...(media.thumbUrl ? { localUrl: media.thumbUrl } : {}),
  }
}

interface LinkPreviewCardProps {
  preview: LinkPreview
  /**
   * 即时预览 (design doc §8.9): opens the page in the in-app reader. Absent when
   * the card is drawn where no reader can open (the preview's own chrome), and
   * then the ⚡ bar falls back to opening the link.
   */
  onOpenInstantView?: (preview: LinkPreview) => void
}

/**
 * Telegram's 链接预览 / 即时预览 card (TDLib `messageText.link_preview`).
 *
 * One card with two anchors, exactly like the reference: the body opens the page
 * through the shell's external-link policy, and the ⚡ 即时预览 bar is the Instant
 * View entry. Anchors cannot nest, so the card is a plain container and the two
 * targets are siblings — never one wrapping the other.
 *
 * The tint is a single inline hue (`--wx-lp-h`) derived from the URL; the
 * stylesheet mixes the surface, the left bar and the accent from it, which keeps
 * the theme colours in `tokens.css` (see `lib/linkPreview.ts`).
 */
export function LinkPreviewCard({ preview, onOpenInstantView }: LinkPreviewCardProps) {
  const hue = useMemo(() => previewHue(preview.url), [preview.url])
  const siteLine = preview.siteName || preview.author
  const text = (
    <span className="wx-link-preview__text">
      {siteLine ? <span className="wx-link-preview__site">{siteLine}</span> : null}
      {preview.title ? <span className="wx-link-preview__title">{preview.title}</span> : null}
      {preview.description ? (
        <span className="wx-link-preview__desc">{preview.description}</span>
      ) : null}
    </span>
  )
  return (
    <div className="wx-link-preview" style={{ '--wx-lp-h': hue } as CSSProperties}>
      <a
        className="wx-link-preview__body"
        href={preview.url}
        target="_blank"
        rel="noreferrer"
        title={preview.displayUrl ?? preview.url}
      >
        {preview.mediaAboveText ? <PreviewMedia items={preview.media ?? []} /> : text}
        {preview.mediaAboveText ? text : <PreviewMedia items={preview.media ?? []} />}
      </a>
      {preview.instantView ? (
        onOpenInstantView ? (
          // The reader exists: the bar opens the page inside the app.
          <button
            type="button"
            className="wx-link-preview__instant"
            onClick={() => onOpenInstantView(preview)}
          >
            <span className="wx-link-preview__bolt" aria-hidden>
              ⚡
            </span>
            即时预览
          </button>
        ) : (
          <a className="wx-link-preview__instant" href={preview.url} target="_blank" rel="noreferrer">
            <span className="wx-link-preview__bolt" aria-hidden>
              ⚡
            </span>
            即时预览
          </a>
        )
      ) : null}
    </div>
  )
}

/**
 * The card's media: one hero picture, or up to four cells in a grid. A video is
 * only ever its poster here — a preview card does not play anything.
 */
function PreviewMedia({ items }: { items: LinkPreviewMedia[] }) {
  if (items.length === 0) return null
  const shown = items.slice(0, 4)
  const hero = shown.length === 1
  return (
    <span className={`wx-link-preview__media${hero ? '' : ' wx-link-preview__media--grid'}`}>
      {shown.map((item, index) => (
        <PreviewCell key={index} item={item} hero={hero} />
      ))}
    </span>
  )
}

function PreviewCell({ item, hero }: { item: LinkPreviewMedia; hero: boolean }) {
  const [ref, view] = useInView<HTMLSpanElement>(PREVIEW_PRELOAD_PX)
  const media = item.media
  const url = useMediaUrl(previewFile(media), thumbPriority(view.visible), view.armed)
  const ratio = media.width && media.height ? `${media.width} / ${media.height}` : '16 / 9'
  return (
    <span
      ref={ref}
      className={`wx-link-preview__cell${hero ? ' wx-link-preview__cell--hero' : ''}`}
      style={{ aspectRatio: ratio }}
    >
      {media.minithumbnail ? (
        <img
          className="wx-link-preview__thumb"
          src={`data:image/jpeg;base64,${media.minithumbnail}`}
          alt=""
          aria-hidden
        />
      ) : null}
      {url ? <img className="wx-link-preview__image" src={url} alt="" aria-hidden /> : null}
      {item.kind === 'video' ? (
        <span className="wx-link-preview__play" aria-hidden>
          ▶
        </span>
      ) : null}
      {media.duration ? (
        <span className="wx-link-preview__duration">{formatDuration(media.duration)}</span>
      ) : null}
    </span>
  )
}
