import { describe, expect, it } from 'vitest'

import { loginCopy } from './loginCopy'

describe('loginCopy', () => {
  it('uses the phone form for the first step', () => {
    expect(loginCopy('phone', { kind: 'waitPhoneNumber' }).title).toBe('登录 Telegram')
    expect(loginCopy('phone', null).action).toBe('下一步')
  })

  it('shows the code hint and length when TDLib sends them', () => {
    const copy = loginCopy('code', { kind: 'waitCode', hint: '+86 138****0000', codeLength: 5 })
    expect(copy.subtitle).toBe('验证码已发送：+86 138****0000')
    expect(copy.placeholder).toBe('5 位数字')
  })

  it('falls back to the neutral copy when the hint is missing', () => {
    expect(loginCopy('code', { kind: 'waitCode' }).subtitle).toBe('验证码已发送，请输入收到的数字。')
    expect(loginCopy('code', { kind: 'waitCode' }).placeholder).toBe('验证码')
    expect(loginCopy('password', { kind: 'waitPassword' }).subtitle).toBe(
      '该账号开启了两步验证，请输入密码。',
    )
  })

  it('asks for a name when the number has no account yet', () => {
    const copy = loginCopy('register', { kind: 'waitRegistration' })
    expect(copy.title).toBe('创建新账号')
    expect(copy.action).toBe('创建账号')
  })

  it('shows the account hint on the two-step step', () => {
    expect(loginCopy('password', { kind: 'waitPassword', hint: '生日' }).subtitle).toBe(
      '需要两步验证密码（提示：生日）',
    )
  })
})
