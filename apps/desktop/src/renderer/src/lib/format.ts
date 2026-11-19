import type { ChatSummary, Message } from '@wegram/protocol'

/** `[start, end)` spoiler runs of a preview, as `ChatSummary` carries them. */
type SpoilerRuns = NonNullable<ChatSummary['lastMessageSpoilers']>

/** WeChat stamps a list row: HH:MM today, 昨天 HH:MM, 星期X within the week, then MM/DD. */
export function formatChatTime(seconds: number | undefined): string {
  if (!seconds) return ''
  const date = new Date(seconds * 1000)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const diffDays = Math.round((startOfToday - day) / 86_400_000)

  if (diffDays === 0) return formatClock(date)
  if (diffDays === 1) return `昨天 ${formatClock(date)}`
  if (diffDays > 1 && diffDays < 7) {
    const weekdays = ['日', '一', '二', '三', '四', '五', '六']
    return `星期${weekdays[date.getDay()]}`
  }
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const dayOfMonth = String(date.getDate()).padStart(2, '0')
  if (date.getFullYear() === now.getFullYear()) return `${month}/${dayOfMonth}`
  return `${date.getFullYear()}/${month}/${dayOfMonth}`
}

export function formatClock(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function formatMessageTime(seconds: number): string {
  return formatClock(new Date(seconds * 1000))
}

/** Two-character initial used by the placeholder avatar. */
export function initials(title: string): string {
  const trimmed = title.trim()
  if (!trimmed) return '?'
  return trimmed.slice(0, 2)
}

const AVATAR_HUES = ['#4C9AFF', '#7B61FF', '#FF9F43', '#2ED573', '#FF6B81', '#00C2D1', '#B57BFF']

export function avatarColor(id: number): string {
  const index = Math.abs(id) % AVATAR_HUES.length
  return AVATAR_HUES[index] ?? AVATAR_HUES[0]!
}

export function isSameDay(a: number, b: number): boolean {
  const first = new Date(a * 1000)
  const second = new Date(b * 1000)
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  )
}

/** WeChat day separators: 今天 / 昨天 / 周三 / 2026年11月17日. */
export function formatDaySeparator(seconds: number): string {
  const date = new Date(seconds * 1000)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const diffDays = Math.round((startOfToday - day) / 86_400_000)

  if (diffDays === 0) return `今天 ${formatClock(date)}`
  if (diffDays === 1) return `昨天 ${formatClock(date)}`
  if (diffDays < 7 && diffDays > 0) {
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    return `${weekdays[date.getDay()]} ${formatClock(date)}`
  }
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日 ${formatClock(date)}`
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${formatClock(date)}`
}

export function formatDuration(seconds: number | undefined): string {
  const total = Math.max(0, Math.round(seconds ?? 0))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

/**
 * Split a chat-list preview into plain and spoiler runs.
 *
 * `lastMessageSpoilers` carries the spoiler offsets of the preview string, so the
 * row can mask exactly the words the transcript masks. Out-of-range, inverted and
 * overlapping ranges are clamped and merged, and the segments always concatenate
 * back to `text` — the block must never eat or duplicate a character.
 */
export function previewSegments(
  text: string,
  runs: SpoilerRuns | undefined,
): { text: string; spoiler: boolean }[] {
  if (!text) return []
  const clamped = (runs ?? [])
    .map(([start, end]) => ({
      start: Math.min(Math.max(start, 0), text.length),
      end: Math.min(Math.max(end, 0), text.length),
    }))
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start)
  if (clamped.length === 0) return [{ text, spoiler: false }]

  const merged: { start: number; end: number }[] = []
  for (const range of clamped) {
    const last = merged[merged.length - 1]
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end)
    else merged.push({ ...range })
  }

  const segments: { text: string; spoiler: boolean }[] = []
  let cursor = 0
  for (const range of merged) {
    if (range.start > cursor)
      segments.push({ text: text.slice(cursor, range.start), spoiler: false })
    segments.push({ text: text.slice(range.start, range.end), spoiler: true })
    cursor = range.end
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), spoiler: false })
  return segments
}

/** Short one-line representation of any message, used by replies and quotes. */
export function messagePreview(message: Message): string {
  const text = message.text.trim()
  switch (message.kind) {
    case 'photo':
      return text ? `[图片] ${text}` : '[图片]'
    case 'video':
      return text ? `[视频] ${text}` : '[视频]'
    case 'file':
      return text ? `[文件] ${text}` : `[文件] ${message.media?.fileName ?? ''}`.trim()
    case 'sticker':
      return '[贴纸]'
    case 'voice':
      return `[语音] ${formatDuration(message.media?.duration)}`.trim()
    case 'poll':
      return `[投票] ${text}`
    case 'rich':
      return text ? `[图文] ${text}` : '[图文]'
    case 'contact':
      return text ? `[名片] ${text}` : '[名片]'
    default:
      return text || '[消息]'
  }
}
