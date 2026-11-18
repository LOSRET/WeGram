import { describe, expect, it } from 'vitest'

import type { Self } from '@wegram/protocol'

import { displayName, stepOf } from './loginModel'

const ME: Self = { id: 1, firstName: '本地', lastName: '账号' }

describe('stepOf', () => {
  it('maps the three credential states to their forms', () => {
    expect(stepOf({ kind: 'waitPhoneNumber' })).toBe('phone')
    expect(stepOf({ kind: 'waitCode' })).toBe('code')
    expect(stepOf({ kind: 'waitPassword' })).toBe('password')
  })

  it('keeps non-form states on the phone step instead of inventing one', () => {
    expect(stepOf({ kind: 'idle' })).toBe('phone')
    expect(stepOf({ kind: 'closed' })).toBe('phone')
    expect(stepOf({ kind: 'ready', me: ME })).toBe('phone')
  })
})

describe('displayName', () => {
  it('joins the Telegram name without a space, like the rail', () => {
    expect(displayName(ME)).toBe('本地账号')
    expect(displayName({ id: 2, firstName: 'Ada', lastName: 'Lovelace' })).toBe('AdaLovelace')
  })

  it('falls back to the username when both name parts are empty', () => {
    expect(displayName({ id: 3, firstName: '', username: 'ada' })).toBe('@ada')
  })

  it('falls back to the phone number, then to 我', () => {
    expect(displayName({ id: 4, firstName: ' ', phone: '+8613800000000' })).toBe('+8613800000000')
    expect(displayName({ id: 5, firstName: '' })).toBe('我')
  })
})
