import type { AdapterEvent } from './adapter'
import type { EventBus } from './updates'

/** Maps domain events onto the `evt:*` channels declared in the protocol (§7.2). */
export function publishAdapterEvent(bus: EventBus, event: AdapterEvent): void {
  switch (event.type) {
    case 'auth':
      bus.publish('evt:auth', event.state)
      return
    case 'connection':
      bus.publish('evt:connection', event.state)
      return
    case 'chats':
      bus.publish('evt:chats', { ops: event.ops })
      return
    case 'messages':
      bus.publish('evt:messages', { chatId: event.chatId, ops: event.ops })
      return
    case 'typing':
      bus.publish('evt:typing', {
        chatId: event.chatId,
        userId: event.userId,
        action: event.action,
        until: event.until,
      })
      return
    case 'file':
      bus.publish('evt:file', {
        fileId: event.fileId,
        downloaded: event.downloaded,
        total: event.total,
        ...(event.path === undefined ? {} : { path: event.path }),
      })
      return
    default:
      return
  }
}
