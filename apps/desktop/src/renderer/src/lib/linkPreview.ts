/**
 * The one content-derived decision of a 链接预览 card: its hue.
 *
 * Telegram tints the card with a colour sampled from the link's cover, so two
 * pages never look alike. A card must paint before its media arrives, so this
 * derives a stable hue from the URL instead of waiting for the picture: the same
 * link always gets the same colour, in the transcript and after a restart.
 *
 * Only the hue travels. `styles/link-preview.css` mixes the surface, the left bar
 * and the accent from it, so the light and dark themes keep their own base
 * colours in `tokens.css` while the card still looks like *this* link.
 */
export function previewHue(seed: string): number {
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) {
    // 31 is the classic string mix: cheap, and a changed character moves the hue
    // well away from the previous one.
    hash = (hash * 31 + seed.charCodeAt(index)) | 0
  }
  return Math.abs(hash) % 360
}
