import type { AuthState } from '@wegram/protocol'
import { describe, expect, it } from 'vitest'

import { SELF_PLACEHOLDER_ID, selfIdentity } from './self'

describe('selfIdentity', () => {
  it('joins the two name parts and keeps the photo', () => {
    const auth: AuthState = {
      kind: 'ready',
      me: { id: 42, firstName: '本地', lastName: '账号', avatarUrl: 'wx-media://f/me' },
    }
    expect(selfIdentity(auth)).toEqual({ id: 42, name: '本地账号', avatarUrl: 'wx-media://f/me' })
  })

  it('uses the one placeholder id before login', () => {
    const auth: AuthState = { kind: 'waitPhoneNumber' }
    expect(selfIdentity(auth)).toEqual({
      id: SELF_PLACEHOLDER_ID,
      name: '我',
      avatarUrl: undefined,
    })
  })
})
