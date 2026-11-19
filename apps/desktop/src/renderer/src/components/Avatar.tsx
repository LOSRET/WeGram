import { avatarColor, initials } from '../lib/format'

export interface AvatarProps {
  /** The photo, when one is known; otherwise the initials are drawn. */
  url?: string
  /** Name the initials come from. */
  name: string
  /** Seed for the placeholder colour: a chat, a user or a channel-post id. */
  colorId: number
  /**
   * The box's own class. Every call site sizes its avatar differently, so the
   * component only adds what is identical everywhere: the colour and the photo.
   */
  className: string
}

/**
 * One avatar box: the photo when there is one, initials on a colour otherwise.
 *
 * The box itself must be the positioned element — `.wx-avatar` and
 * `.wx-comments-panel__post-avatar` both are. `.wx-avatar__img` is absolutely
 * positioned with `inset: 0`, so a wrapper without `position: relative` throws
 * the photo out to the nearest positioned ancestor (the message row), where it
 * paints over the whole bubble at row size. That happened once; the box class
 * travelling with the component is what keeps it from happening again.
 */
export function Avatar({ url, name, colorId, className }: AvatarProps) {
  return (
    <span className={className} style={url ? undefined : { background: avatarColor(colorId) }}>
      {url ? (
        <img className="wx-avatar__img" src={url} alt="" draggable={false} />
      ) : (
        initials(name)
      )}
    </span>
  )
}
