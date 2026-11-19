import { errorMessage, invoke } from '../../lib/ipc'

export interface ViewerActionDeps {
  fileId: number
  /** The message the picture came from, when it came from a chat. */
  messageId: number | undefined
  shine: (text: string) => void
  setPinned: (onTop: boolean) => void
}

/**
 * The viewer's window actions as plain functions, so the toolbar and the menu
 * only have to call them.
 *
 * 定位到聊天位置 is the one that reaches out of this window: main raises the
 * shell above the viewer and tells the transcript to open the conversation on
 * this message; the viewer itself stays open, so flipping back needs no reload.
 */
export function createViewerActions({
  fileId,
  messageId,
  shine,
  setPinned,
}: ViewerActionDeps): {
  togglePin: (pinned: boolean) => Promise<void>
  saveCurrent: () => Promise<void>
  copyPhoto: () => Promise<void>
  openInSystem: () => Promise<void>
  locateInChat: () => Promise<void>
} {
  const togglePin = async (pinned: boolean): Promise<void> => {
    try {
      const { onTop } = await invoke('viewer:pin', { onTop: !pinned })
      setPinned(onTop)
    } catch (error) {
      shine(errorMessage(error))
    }
  }

  const saveCurrent = async (): Promise<void> => {
    if (!fileId) return
    try {
      const result = await invoke('viewer:save', { fileId })
      if (!result.canceled) shine('已保存')
    } catch (error) {
      shine(errorMessage(error))
    }
  }

  const copyPhoto = async (): Promise<void> => {
    if (!fileId) return
    try {
      await invoke('viewer:copy', { fileId })
      shine('已复制')
    } catch (error) {
      shine(errorMessage(error))
    }
  }

  const openInSystem = async (): Promise<void> => {
    if (!fileId) return
    try {
      await invoke('media:open', { fileId })
    } catch (error) {
      shine(errorMessage(error))
    }
  }

  const locateInChat = async (): Promise<void> => {
    if (!messageId) {
      shine('这条媒体不来自聊天')
      return
    }
    try {
      await invoke('viewer:locate', { messageId })
    } catch (error) {
      shine(errorMessage(error))
    }
  }

  return { togglePin, saveCurrent, copyPhoto, openInSystem, locateInChat }
}
