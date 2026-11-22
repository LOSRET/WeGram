/**
 * How a 语音消息 bubble is sized and labelled.
 *
 * WeChat grows the bubble with the clip and prints whole seconds with a
 * double-prime (13"), never mm:ss; the same rule is what the outgoing and
 * incoming bubbles share, so it lives here rather than in the component.
 */

/** One second of speech adds about 2 px; nothing is shorter than a tap. */
export function voiceBubbleWidth(seconds: number | undefined): number {
  const safe = Math.max(1, Math.round(seconds ?? 0))
  return Math.min(200, Math.round(74 + Math.min(safe, 60) * 2.1))
}

/** 13" — the label the client prints inside the bubble. */
export function voiceSecondsLabel(seconds: number | undefined): string {
  return `${Math.max(0, Math.round(seconds ?? 0))}"`
}
