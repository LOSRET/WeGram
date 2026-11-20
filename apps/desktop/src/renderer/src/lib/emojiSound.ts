import { ensureMedia } from './media'

/**
 * Plays an animated emoji's click sound (TDLib `animatedEmoji.sound`).
 *
 * The file is fetched on the first click instead of with the emoji: it is a few
 * kilobytes the reader may never ask for, and a first transcript paint must not
 * queue one download per emoji. A refused download or a browser autoplay rule
 * simply means silence — the animation is the point, the sound is the bonus.
 */
export async function playEmojiSound(fileId: number): Promise<void> {
  if (fileId <= 0) return
  const url = await ensureMedia(fileId, 4).catch(() => undefined)
  if (!url) return
  const audio = new Audio(url)
  void audio.play().catch(() => undefined)
}
