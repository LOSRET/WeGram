/** WeChat-style timestamps: HH:MM for today, otherwise MM/DD. */
export function formatChatTime(seconds: number | undefined): string {
  if (!seconds) return ''
  const date = new Date(seconds * 1000)
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (sameDay) return formatClock(date)
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`
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
