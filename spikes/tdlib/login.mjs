// Spike 2:真实登录(手机号 → 验证码 → 两步验证),并把 session 落到本地库。
//
// 用法(在你自己终端里跑,不要把验证码发给任何人):
//   1) 到 https://my.telegram.org/apps 创建一个应用,拿到 api_id / api_hash
//   2) 在本目录建 .env:
//        TELEGRAM_API_ID=123456
//        TELEGRAM_API_HASH=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
//   3) node login.mjs
//
// 重复运行本脚本 == 验证 session 复用:不会再要求输入验证码,直接打印 getMe。
import { createRequire } from 'node:module'
import readline from 'node:readline/promises'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)
const tdl = require('tdl')
const prebuilt = require('prebuilt-tdlib')

// ---- 读 .env(只支持 KEY=VALUE,够用) ----
const envFile = path.resolve('.env')
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const apiId = Number(process.env.TELEGRAM_API_ID || 0)
const apiHash = (process.env.TELEGRAM_API_HASH || '').trim()

if (!apiId || !apiHash) {
  console.error(`
缺少凭据。请到 https://my.telegram.org/apps 创建应用后,在本目录的 .env 里写:

  TELEGRAM_API_ID=123456
  TELEGRAM_API_HASH=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

`.trim())
  process.exit(2)
}

const DATA = path.resolve('data')
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const ask = (q) => rl.question(q)

tdl.configure({ tdjson: prebuilt.getTdjson(), verbosityLevel: 1 })

const client = tdl.createClient({
  apiId,
  apiHash,
  databaseDirectory: path.join(DATA, 'db'),
  filesDirectory: path.join(DATA, 'files'),
  tdlibParameters: {
    use_message_database: true,
    use_secret_chats: false,
    system_language_code: 'zh-hans',
    application_version: '0.0.1-spike',
    device_model: 'WechatGram Spike',
    system_version: 'Windows',
  },
})

client.on('error', (e) => console.error('[tdlib error]', e.message))
client.on('update', (u) => {
  if (u._ === 'updateConnectionState') console.log('  · 连接:', u.state?._)
  if (u._ === 'updateAuthorizationState') console.log('  · 授权:', u.authorization_state?._)
})

let passwordUsed = false

try {
  await client.login({
    getPhoneNumber: () => ask('手机号(含国家码,如 +8613800000000): '),
    getAuthCode: () => ask('Telegram 收到的验证码: '),
    getPassword: (hint) => {
      passwordUsed = true
      return ask(`两步验证密码${hint ? `(${hint})` : ''}: `)
    },
    getName: async () => ({ firstName: await ask('未注册,输入名字: ') }),
  })
} catch (e) {
  console.error('\n[FAIL] 登录失败:', e.message)
  rl.close()
  process.exit(1)
}
rl.close()

const me = await client.invoke({ _: 'getMe' })
const ver = await client.invoke({ _: 'getOption', name: 'version' })

console.log('\n[PASS] 已登录')
console.log('  TDLib    :', ver.value)
console.log('  user_id  :', me.id)
console.log('  姓名     :', [me.first_name, me.last_name].filter(Boolean).join(' '))
console.log('  用户名   :', me.usernames?.active_usernames?.join(', ') || '(无)')
console.log('  手机号   :', me.phone_number)
console.log('  用了 2FA :', passwordUsed || '(本次无需)')
console.log('  session  :', path.join(DATA, 'db'))
console.log('\n再跑一次 node login.mjs,若不再要求输入验证码即为 session 复用成功。\n')

await client.close()
process.exit(0)
