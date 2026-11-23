/**
 * The public share link of a sticker set.
 *
 * TDLib's `stickerSet.name` is the short name behind
 * `https://t.me/addstickers/<name>`: what the official clients put on the
 * clipboard and send to a chat when a pack is shared. The name is user-controlled
 * and may be empty (a set built locally), so it is checked before it becomes a
 * link — never interpolated blind.
 */
const NAME = /^[A-Za-z0-9_]{1,64}$/

export function stickerSetLink(name: string | undefined): string | null {
  if (!name || !NAME.test(name)) return null
  return `https://t.me/addstickers/${name}`
}
