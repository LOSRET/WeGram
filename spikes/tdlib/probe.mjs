// Spike 1:验证 tdjson.dll 能否加载、tdl 原生 addon 能否运行、TDLib 事件流是否可用。
// 不需要 api_id / api_hash —— 全部在 setTdlibParameters 之前完成。
import { createRequire } from 'node:module'
import fs from 'node:fs'

const require = createRequire(import.meta.url)
const tdl = require('tdl')
const prebuilt = require('prebuilt-tdlib')

const log = (...a) => console.log('[probe]', ...a)
const fail = (msg) => {
  console.error('\n[FAIL]', msg)
  process.exit(1)
}

// ---------- 1. 定位 tdjson ----------
const tdjson = prebuilt.getTdjson()
const info = prebuilt.getTdlibInfo()
log('tdjson      :', tdjson)
log('tdlib info  :', `version=${info.version} commit=${info.commit.slice(0, 8)}`)
if (!fs.existsSync(tdjson)) fail(`tdjson 不存在: ${tdjson}`)
log('dll size    :', (fs.statSync(tdjson).size / 1024 / 1024).toFixed(1), 'MB')

// ---------- 2. 加载共享库并同步执行 ----------
let version = null
try {
  console.time('[probe] load DLL')
  tdl.configure({ tdjson, verbosityLevel: 1 })
  version = tdl.execute({ _: 'getOption', name: 'version' })
  console.timeEnd('[probe] load DLL')
  log('execute(getOption version):', JSON.stringify(version))
} catch (e) {
  log('同步 execute 不可用(非致命):', e.message)
}

// ---------- 3. 裸客户端:验证 addon 线程 + update 流 ----------
const client = tdl.createBareClient()

const waitForParams = new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error('15s 内没收到 updateAuthorizationState')),
    15_000
  )
  client.on('update', (u) => {
    if (u._ !== 'updateAuthorizationState') return
    const state = u.authorization_state?._
    log('auth state  :', state)
    if (state === 'authorizationStateWaitTdlibParameters') {
      clearTimeout(timer)
      resolve()
    }
  })
  client.on('error', (e) => {
    clearTimeout(timer)
    reject(e)
  })
})

try {
  await waitForParams
} catch (e) {
  fail(e.message)
}

// 裸客户端允许在未 setTdlibParameters 前直接发请求
try {
  const v = await client.invoke({ _: 'getOption', name: 'version' })
  log('invoke(getOption version):', JSON.stringify(v))
} catch (e) {
  log('invoke 失败(非致命):', e.message)
}

console.log('\n[PASS] tdjson 可加载 · 原生 addon 可运行 · update 流可用 · 无需 api_id\n')
process.exit(0)
