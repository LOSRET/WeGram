import { botCommandsAnswer, botSeedByUsername } from '@wegram/mock-fixtures'
import { AppError } from '@wegram/protocol'
import type {
  BotCommandsAnswer,
  CallbackAnswer,
  InlineButtonCallback,
  InlineQueryAnswer,
} from '@wegram/protocol'

import type { Fixture } from './constants'

/**
 * The fake Mini App's page (design doc §9.4). Inline everything so a `data:` URL
 * shows the whole flow offline; the only bridge it needs is
 * `TelegramWebviewProxy`, which the guest preload exposes exactly like Telegram's
 * SDK expects. The page deliberately has no Telegram branding — it is this
 * client's own fixture, not a copy of the bot in the screenshots.
 */
const DEMO_PAGE = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root{color-scheme:light;--bg:#eef2f7;--card:#fff;--ink:#17212b;--muted:#8b98a5;--brand:#2f8cf5;--hot:#ff4d4f}
  *{box-sizing:border-box} html,body{margin:0;min-height:100%}
  body{background:var(--bg);color:var(--ink);font:14px/1.45 'Microsoft YaHei UI','Microsoft YaHei',sans-serif}
  .hero{background:linear-gradient(135deg,#57a8ff,#2f8cf5);color:#fff;padding:20px 16px 24px}
  .hero h1{margin:0;font-size:19px;font-weight:600}
  .hero p{margin:4px 0 0;font-size:12px;opacity:.85}
  .search{display:flex;gap:8px;margin-top:16px}
  .search input{flex:1;min-width:0;border:0;border-radius:10px;padding:10px 12px;font:inherit;font-size:13px;outline:none}
  .search button{border:0;border-radius:10px;background:#fff;color:var(--brand);padding:0 16px;font:inherit;font-weight:600;cursor:pointer}
  .tabs{display:flex;gap:20px;padding:14px 16px 0;background:var(--card);font-size:13px;color:var(--muted)}
  .tabs span{padding-bottom:10px;cursor:pointer}
  .tabs .on{color:var(--brand);font-weight:600;border-bottom:2px solid var(--brand)}
  .card{margin:10px 12px;background:var(--card);border-radius:14px;padding:14px 14px 6px}
  .card h2{margin:0 0 2px;font-size:15px}.card .sub{color:var(--muted);font-size:12px;margin:0 0 10px}
  .row{display:flex;align-items:center;gap:10px;padding:11px 0;border-top:1px solid #f0f2f5;cursor:pointer}
  .row:first-of-type{border-top:0}.num{width:20px;color:var(--brand);font-weight:700;text-align:center}
  .row .txt{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .tag{font-size:10px;color:#fff;background:var(--hot);border-radius:4px;padding:1px 5px}
  .tag.new{background:#ff9f1a}.tag.up{background:var(--brand)}
  .foot{padding:12px 16px 22px;text-align:center}
  .foot button{border:0;border-radius:10px;background:var(--brand);color:#fff;padding:9px 18px;font:inherit;font-size:13px;cursor:pointer}
  #toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%) translateY(20px);background:rgba(0,0,0,.78);color:#fff;border-radius:8px;padding:8px 14px;font-size:12px;opacity:0;transition:.18s;pointer-events:none}
  #toast.on{opacity:1;transform:translateX(-50%) translateY(0)}
</style></head>
<body>
  <header class="hero">
    <h1>WeGram 演示小程序</h1>
    <p>这是 mock 适配器的内置页面，不访问网络。</p>
    <div class="search">
      <input id="q" placeholder="搜索群组、频道或视频" />
      <button id="go">搜索</button>
    </div>
  </header>
  <div class="tabs"><span class="on">热门</span><span>视频</span><span>内容</span></div>
  <section class="card">
    <h2>🔥 正在发生</h2>
    <p class="sub">50 条真实事件线索，点击进入搜索</p>
    <div class="row"><span class="num">1</span><span class="txt">小程序窗口已经打开，⋮ 可以重载或举报</span><span class="tag">热</span></div>
    <div class="row"><span class="num">2</span><span class="txt">点底部按钮会通过 TelegramWebviewProxy 回传数据</span><span class="tag new">新</span></div>
    <div class="row"><span class="num">3</span><span class="txt">主题跟随 WeGram 的浅色 / 深色</span><span class="tag up">升</span></div>
  </section>
  <div class="foot"><button id="send">发送数据给机器人</button></div>
  <div id="toast"></div>
  <script>
    function post(type, data) {
      try { window.TelegramWebviewProxy && window.TelegramWebviewProxy.postEvent(type, JSON.stringify(data || {})); } catch (e) {}
    }
    window.Telegram = { WebApp: {
      ready: function () { post('web_app_ready'); },
      expand: function () { post('web_app_expand'); },
      close: function () { post('web_app_close'); },
      sendData: function (data) { post('web_app_data_send', { data: String(data) }); },
      initData: (location.hash || '').replace(/^#/, ''),
      themeParams: {},
      version: '6.0',
      platform: 'wegram'
    } };
    var toast = document.getElementById('toast');
    function say(text) { toast.textContent = text; toast.classList.add('on'); setTimeout(function () { toast.classList.remove('on'); }, 1600); }
    document.getElementById('go').addEventListener('click', function () { say('这是演示页面，搜索不会发出请求'); });
    document.getElementById('q').addEventListener('keydown', function (e) { if (e.key === 'Enter') { say('这是演示页面，搜索不会发出请求'); } });
    document.getElementById('send').addEventListener('click', function () { window.Telegram.WebApp.sendData(JSON.stringify({ demo: true, at: Date.now() })); say('已通过 WebApp.sendData 发送'); });
    window.Telegram.WebApp.ready();
    window.Telegram.WebApp.expand();
  </script>
</body></html>`

/**
 * The fake bot's endpoints: the commands it publishes, the answer to a pressed
 * inline button, and inline queries (`@username query`, §8.3).
 *
 * The fixture account carries one bot (`WeGram 助手`), so the composer's "/" list,
 * the inline keyboard and the inline picker are exercised without a Telegram
 * account. Its answers are canned — there is no bot server behind it — and they
 * say so.
 *
 * A factory rather than loose functions because an inline query has to remember
 * what it answered: TDLib names a query with an id, and sending a result posts
 * that id plus the result's own id back.
 */
export function createMockBots(fixtures: Map<number, Fixture>) {
  /** queryId → its results (result id → the text the fake sends). */
  const queries = new Map<string, Map<string, string>>()
  let sequence = 0

  /** The fixture bot that owns an @username, or `null` for anything else. */
  const botWithUsername = (username: string): Fixture | null =>
    botSeedByUsername(fixtures, username)

  /**
   * The fixture a Mini App belongs to: by user id (the bot on a button) or by
   * the @username a `t.me` link named. The window only needs its title.
   */
  const fixtureForBot = (input: { botUserId?: number; username?: string }): Fixture | null => {
    if (input.username !== undefined) return botWithUsername(input.username)
    if (input.botUserId === undefined) return null
    for (const fixture of fixtures.values()) {
      if (fixture.chat.userId === input.botUserId) return fixture
    }
    return null
  }

  /** A chat that is not the fixture bot answers "no commands", like TDLib does. */
  const commands = (chatId: number): BotCommandsAnswer =>
    botCommandsAnswer(fixtures.get(chatId) ?? null)

  /**
   * Pressing a callback button in the mock: the fixture's bot answers at once.
   * A button that needs the 2-step password is refused, exactly like the real
   * adapter refuses it — the client has no password prompt.
   */
  const callback = (input: { chatId: number; callback: InlineButtonCallback }): CallbackAnswer => {
    const bot = fixtures.get(input.chatId)?.bot
    if (!bot) throw new AppError('not_implemented', '这个会话不是机器人')
    if (input.callback.type === 'password') {
      throw new AppError('not_implemented', '需要两步验证密码的按钮暂未支持')
    }
    // The fixture's two buttons demo both answers the real adapter can draw: a
    // toast, and an alert the shell shows as a one-button dialog.
    if (input.callback.type === 'data' && input.callback.data === 'alert') {
      return {
        text: '这是一个模拟的机器人弹窗。\n第二行说明换行也会保留。',
        showAlert: true,
      }
    }
    return { text: '机器人收到了这次点击（模拟）' }
  }

  /**
   * `@bot query`: three article results built from the query, so the picker can be
   * walked without a bot server. Only article results exist here — the real
   * adapter also maps photos, stickers, gifs and files.
   */
  const inlineQuery = (input: {
    chatId: number
    username: string
    query: string
    offset?: string
  }): InlineQueryAnswer => {
    const handle = input.username.replace(/^@/, '').trim()
    if (!botWithUsername(handle)) throw new AppError('invalid_payload', `找不到 @${handle}`)
    // One page only: the fixture has three rows and no cursor.
    if (input.offset) return { queryId: '', nextOffset: '', results: [] }
    const query = input.query.trim()
    const echo = query || '你好'
    const rows: Array<{
      id: string
      kind: string
      title: string
      description: string
      text: string
    }> = [
      {
        id: 'echo',
        kind: '文章',
        title: echo,
        description: '把这句话发出去（模拟 inline 结果）',
        text: echo,
      },
      {
        id: 'about',
        kind: '文章',
        title: 'WeGram 助手 · 关于',
        description: '模拟的第二个结果',
        text: 'WeGram 助手：这是一个模拟的 inline 结果。',
      },
      {
        id: 'help',
        kind: '文章',
        title: '/help',
        description: '把命令发给机器人',
        text: '/help',
      },
    ]
    const queryId = `mock-inline-${sequence}`
    sequence += 1
    queries.set(queryId, new Map(rows.map((row) => [row.id, row.text])))
    return {
      queryId,
      nextOffset: '',
      results: rows.map(({ id, kind, title, description }) => ({ id, kind, title, description })),
    }
  }

  /** The text one answered result sends; a stale query id is refused. */
  const inlineResultText = (input: { queryId: string; resultId: string }): string => {
    const text = queries.get(input.queryId)?.get(input.resultId)
    if (text === undefined)
      throw new AppError('invalid_payload', '这个 inline 结果已过期，请重新输入')
    return text
  }

  /**
   * The page the fake's Mini App window opens. It is a `data:` URL on purpose:
   * the demo must render with no network, and it exercises the real guest web
   * view, the preload bridge and the window strip. The script on the page posts
   * through `TelegramWebviewProxy`, the same global Telegram's SDK looks for.
   */
  const demoSignedUrl = (): string =>
    `data:text/html;charset=utf-8,${encodeURIComponent(DEMO_PAGE)}`

  return { commands, callback, inlineQuery, inlineResultText, fixtureForBot, demoSignedUrl }
}
