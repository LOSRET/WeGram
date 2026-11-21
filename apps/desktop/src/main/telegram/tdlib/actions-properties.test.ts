import { describe, expect, it, vi } from 'vitest'

import { messageProperties } from './actions/properties'

describe('messageProperties', () => {
  it('maps the offline getMessageProperties answer', async () => {
    const invoke = vi.fn(async (method: Record<string, unknown>) => {
      expect(method._).toBe('getMessageProperties')
      expect(method.chat_id).toBe(-1001)
      expect(method.message_id).toBe(42)
      return {
        can_be_edited: true,
        can_be_forwarded: false,
        can_be_deleted_only_for_self: true,
        can_be_deleted_for_all_users: false,
        can_be_copied: true,
        can_be_replied: true,
      }
    })

    await expect(messageProperties({ invoke }, { chatId: -1001, messageId: 42 })).resolves.toEqual({
      canBeEdited: true,
      canBeForwarded: false,
      canBeDeletedOnlyForSelf: true,
      canBeDeletedForAllUsers: false,
      canBeCopied: true,
      canBeReplied: true,
    })
  })

  it('reads a flag TDLib omitted as false', async () => {
    const invoke = vi.fn(async () => ({ can_be_edited: true }))

    await expect(messageProperties({ invoke }, { chatId: 1, messageId: 2 })).resolves.toMatchObject(
      { canBeEdited: true, canBeForwarded: false, canBeCopied: false },
    )
  })
})
