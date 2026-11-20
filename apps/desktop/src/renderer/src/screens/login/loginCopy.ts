import type { AuthState } from '@wegram/protocol'

import type { LoginStep } from '../loginModel'

/** The words the sign-in form shows for one step. Pure, so it can be tested. */
export interface LoginCopy {
  title: string
  subtitle: string
  placeholder: string
  action: string
  label: string
}

/**
 * The form's copy per step. The two hint lines come from TDLib when it has
 * them: `waitCode` may say where the code went and how long it is, and
 * `waitPassword` may carry the account's own hint.
 */
export function loginCopy(step: LoginStep, auth: AuthState | null): LoginCopy {
  switch (step) {
    case 'code':
      return {
        title: '输入验证码',
        subtitle:
          auth?.kind === 'waitCode' && auth.hint
            ? `验证码已发送：${auth.hint}`
            : '验证码已发送，请输入收到的数字。',
        placeholder:
          auth?.kind === 'waitCode' && auth.codeLength ? `${auth.codeLength} 位数字` : '验证码',
        action: '确认',
        label: '验证码',
      }
    case 'register':
      return {
        title: '创建新账号',
        subtitle: '这个号码还没有 Telegram 账号，填一个名字即可创建。',
        placeholder: '名字',
        action: '创建账号',
        label: '名字',
      }
    case 'password':
      return {
        title: '两步验证',
        subtitle:
          auth?.kind === 'waitPassword' && auth.hint
            ? `需要两步验证密码（提示：${auth.hint}）`
            : '该账号开启了两步验证，请输入密码。',
        placeholder: '两步验证密码',
        action: '登录',
        label: '两步验证密码',
      }
    default:
      return {
        title: '登录 Telegram',
        subtitle: '用你的手机号登录，验证码会发到 Telegram 客户端。',
        placeholder: '+8613800000000',
        action: '下一步',
        label: '手机号',
      }
  }
}
