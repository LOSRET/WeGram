/**
 * Puts text on the clipboard from the renderer.
 *
 * `navigator.clipboard` needs a secure context, which a `file://` renderer is not
 * guaranteed to be, so a hidden textarea + execCommand is the fallback. The main
 * process owns the viewer's 复制 (an image), this one is only for text.
 */
export async function copyText(text: string): Promise<void> {
  if (!text) throw new Error('nothing to copy')
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  try {
    if (!document.execCommand('copy')) throw new Error('copy was refused')
  } finally {
    area.remove()
  }
}
