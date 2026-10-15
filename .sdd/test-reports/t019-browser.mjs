import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const BASE = process.env.T019_BASE || 'http://127.0.0.1:5203'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT_DIR = path.resolve(
  'C:\\Users\\慈海客服\\Desktop\\demo\\Develop_Helper\\Projects_Repo\\Customer_Service\\.sdd\\test-reports',
)
const CDP_PORT = Number(process.env.T019_CDP_PORT || 9449)
const FALLBACK =
  '抱歉，这个问题我暂时无法根据现有知识准确回答。你可以换个说法再问，或点击转人工。'
const CLARIFY = '请问是哪件商品？例如连衣裙、耳机，还是订单和发票问题。'
const DRESS_REWRITE = '询问该连衣裙是否支持退货'
const APPAREL_KNOWLEDGE = '服饰美妆支持七天无理由退货，需商品完好'
const DEMO_USER = process.env.T019_DEMO_USER || 'it-help'
const DEMO_PASS = process.env.T019_DEMO_PASS || ''

let chromeProc
let ws
let sessionId
let msgId = 0
const pending = new Map()

function send(method, params = {}) {
  const id = ++msgId
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`CDP timeout: ${method}`))
    }, 20000)
    pending.set(id, { resolve, reject, timer })
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    ws.send(JSON.stringify(payload))
  })
}

async function waitJson(url, timeoutMs = 20000) {
  const start = Date.now()
  let lastErr
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return await res.json()
      lastErr = new Error(`${url} -> ${res.status}`)
    } catch (err) {
      lastErr = err
    }
    await delay(200)
  }
  throw lastErr ?? new Error(`timeout waiting ${url}`)
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (result.exceptionDetails) {
    const text = result.exceptionDetails.text || result.exceptionDetails.exception?.description
    throw new Error(`eval failed: ${text}\n${expression}`)
  }
  return result.result?.value
}

async function waitFor(expression, timeoutMs = 12000) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeoutMs) {
    last = await evaluate(`Boolean(${expression})`)
    if (last) return last
    await delay(100)
  }
  throw new Error(`waitFor timeout (${timeoutMs}ms): ${expression}; last=${JSON.stringify(last)}`)
}

async function screenshot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  await writeFile(path.join(OUT_DIR, name), Buffer.from(data, 'base64'))
  return name
}

function fillScript(selector, value) {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error('missing ' + ${JSON.stringify(selector)});
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    desc.set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.value.length;
  })()`
}

const collectChat = `(() => {
  const status = document.querySelector('.employee-status-text');
  const transfer = [...document.querySelectorAll('.employee-status button')].at(0);
  const empty = document.querySelector('.employee-empty');
  const bodyText = document.body.innerText || '';
  const msgs = [...document.querySelectorAll('.chat-msg')].map((n) => ({
    side: n.classList.contains('employee') ? 'employee' : 'other',
    tag: n.querySelector('.chat-msg-tag')?.textContent ?? null,
    text: n.querySelector('.chat-bubble')?.textContent ?? '',
    rewrite: n.querySelector('.chat-rewrite')?.textContent ?? null,
    alignSelf: getComputedStyle(n).alignSelf,
  }));
  const composer = document.querySelector('.employee-composer');
  const messages = document.querySelector('.employee-messages');
  const composerRect = composer?.getBoundingClientRect();
  const empBubble = document.querySelector('.chat-msg.employee .chat-bubble');
  const sysBubble = document.querySelector('.chat-msg.other .chat-bubble');
  const empCs = empBubble ? getComputedStyle(empBubble) : null;
  const sysCs = sysBubble ? getComputedStyle(sysBubble) : null;
  const emptyCs = empty ? getComputedStyle(empty) : null;
  return {
    href: location.href,
    pathname: location.pathname,
    statusText: status?.textContent ?? null,
    transferText: transfer?.textContent?.trim() ?? null,
    transferDisabled: transfer ? transfer.disabled : null,
    emptyText: empty?.textContent ?? null,
    emptyColor: emptyCs?.color ?? null,
    emptyFontSize: emptyCs?.fontSize ?? null,
    hasItEmpty: bodyText.includes('描述你的 IT 问题'),
    hasShoppingEmpty: bodyText.includes('描述你的购物问题'),
    pageHasMock: bodyText.includes('[Mock]'),
    messageCount: msgs.length,
    messages: msgs,
    systemTags: msgs.filter((m) => m.side === 'other').map((m) => m.tag),
    otherCount: msgs.filter((m) => m.side === 'other').length,
    lastEmployee: msgs.filter((m) => m.side === 'employee').at(-1) ?? null,
    lastOther: msgs.filter((m) => m.side === 'other').at(-1) ?? null,
    conversationId: sessionStorage.getItem('conversation_id'),
    topbarUser: document.querySelector('.session .user')?.textContent ?? null,
    composerPinGap: composerRect ? window.innerHeight - composerRect.bottom : null,
    composerFlexShrink: composer ? getComputedStyle(composer).flexShrink : null,
    employeeBubble: empCs ? { backgroundColor: empCs.backgroundColor, color: empCs.color } : null,
    systemBubble: sysCs ? { backgroundColor: sysCs.backgroundColor, color: sysCs.color } : null,
  };
})()`

async function sendChat(text) {
  const before = await evaluate(`document.querySelectorAll('.chat-msg').length`)
  await evaluate(fillScript('.employee-composer textarea', text))
  await evaluate(`document.querySelector('.employee-composer button[type="submit"]').click()`)
  await waitFor(`document.querySelectorAll('.chat-msg').length > ${before}`)
  await waitFor(
    `document.querySelector('.employee-composer textarea') && !document.querySelector('.employee-composer textarea').disabled`,
  )
  return evaluate(collectChat)
}

function assert(cond, label, extra) {
  if (!cond) {
    const detail = extra === undefined ? '' : ` ${JSON.stringify(extra)}`
    throw new Error(`ASSERT FAIL: ${label}${detail}`)
  }
}

async function main() {
  if (!DEMO_PASS) {
    throw new Error('missing T019_DEMO_PASS')
  }
  await mkdir(OUT_DIR, { recursive: true })
  const userData = await mkdtemp(path.join(os.tmpdir(), 't019-chrome-'))
  chromeProc = spawn(
    CHROME,
    [
      `--remote-debugging-port=${CDP_PORT}`,
      '--remote-allow-origins=*',
      `--user-data-dir=${userData}`,
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--window-size=1440,900',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  const version = await waitJson(`http://127.0.0.1:${CDP_PORT}/json/version`)
  const wsUrl = version.webSocketDebuggerUrl
  if (!wsUrl) throw new Error('no CDP websocket')

  ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('ws error')), { once: true })
  })
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data))
    if (msg.id && pending.has(msg.id)) {
      const item = pending.get(msg.id)
      clearTimeout(item.timer)
      pending.delete(msg.id)
      if (msg.error) item.reject(new Error(JSON.stringify(msg.error)))
      else item.resolve(msg.result)
    }
  })

  const created = await send('Target.createTarget', { url: 'about:blank' })
  const attached = await send('Target.attachToTarget', { targetId: created.targetId, flatten: true })
  sessionId = attached.sessionId
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })

  async function goto(url) {
    const nav = send('Page.navigate', { url })
    await Promise.race([send('Page.loadEventFired').catch(() => null), delay(3000)])
    await nav
  }

  const evidence = {
    mock: true,
    base: BASE,
    viewport: '1440x900',
    cdpPort: CDP_PORT,
    chrome: version.Browser,
    userDataDir: userData,
    steps: {},
    failed: [],
  }

  try {
    const health = await fetch(BASE)
    evidence.viteStatus = health.status
    evidence.viteUrl = BASE
    assert(health.status === 200, 'vite 5203 HTTP 200', health.status)

    await goto(`${BASE}/employee`)
    await waitFor(`document.querySelector('.login-card') || document.querySelector('.employee-chat')`)
    const onLogin = await evaluate(`Boolean(document.querySelector('.login-card'))`)
    evidence.landedOnLogin = onLogin
    if (onLogin) {
      await evaluate(fillScript('#user', DEMO_USER))
      await evaluate(fillScript('#pass', DEMO_PASS))
      await evaluate(`document.querySelector('button[type="submit"]').click()`)
    }
    await waitFor(`document.querySelector('.employee-chat') && location.pathname === '/employee'`)
    await waitFor(
      `document.querySelector('.employee-empty') && document.querySelector('.employee-empty').textContent.includes('购物问题')`,
    )

    const empty = await evaluate(collectChat)
    evidence.steps.empty = {
      pathname: empty.pathname,
      emptyText: empty.emptyText,
      statusText: empty.statusText,
      transferText: empty.transferText,
      transferDisabled: empty.transferDisabled,
      hasItEmpty: empty.hasItEmpty,
      hasShoppingEmpty: empty.hasShoppingEmpty,
      pageHasMock: empty.pageHasMock,
      topbarUser: empty.topbarUser,
      conversationId: empty.conversationId,
      emptyColor: empty.emptyColor,
      emptyFontSize: empty.emptyFontSize,
      composerPinGap: empty.composerPinGap,
    }
    await screenshot('t019-empty.png')
    try {
      assert(empty.pathname === '/employee', 'pathname /employee', empty.pathname)
      assert(
        empty.emptyText === '[Mock] 描述你的购物问题',
        'empty helper shopping + Mock',
        empty.emptyText,
      )
      assert(!empty.hasItEmpty, 'no IT empty copy', empty.hasItEmpty)
      assert(empty.hasShoppingEmpty, 'shopping empty visible')
      assert(empty.pageHasMock, '[Mock] present')
      assert(empty.statusText?.includes('AI 接待中'), 'status AI 接待中', empty.statusText)
      assert(empty.transferText === '转人工', 'transfer available', empty.transferText)
      assert(empty.transferDisabled === false, 'transfer enabled')
      assert(empty.emptyColor === 'rgb(92, 107, 122)', 'empty TextMuted', empty.emptyColor)
      assert(empty.emptyFontSize === '14px', 'empty 14px', empty.emptyFontSize)
    } catch (err) {
      evidence.failed.push({ id: 'TC-01', error: String(err.message) })
    }

    const vague = await sendChat('能不能退')
    evidence.steps.vague = {
      lastEmployee: vague.lastEmployee,
      lastOther: vague.lastOther,
      systemTags: vague.systemTags,
      hasItEmpty: vague.hasItEmpty,
    }
    await screenshot('t019-clarify.png')
    try {
      assert(vague.lastEmployee?.text?.includes('能不能退'), 'vague original visible')
      assert(
        Boolean(vague.lastEmployee?.rewrite?.includes('当前问法缺少商品或订单对象')),
        'vague rewrite',
        vague.lastEmployee?.rewrite,
      )
      assert(vague.lastOther?.tag === '反问', 'clarification tag', vague.lastOther)
      assert(vague.lastOther?.text?.includes(CLARIFY), 'clarification copy', vague.lastOther?.text)
      assert(!vague.lastOther?.text?.includes(FALLBACK), 'not fallback')
      assert(!vague.hasItEmpty, 'still no IT empty copy')
    } catch (err) {
      evidence.failed.push({ id: 'TC-02a', error: String(err.message) })
    }

    const dress = await sendChat('这件连衣裙能退吗')
    evidence.steps.dress = {
      lastEmployee: dress.lastEmployee,
      lastOther: dress.lastOther,
      employeeAlign: dress.lastEmployee?.alignSelf,
      otherAlign: dress.lastOther?.alignSelf,
      employeeBubble: dress.employeeBubble,
      systemBubble: dress.systemBubble,
      composerPinGap: dress.composerPinGap,
      composerFlexShrink: dress.composerFlexShrink,
    }
    await screenshot('t019-dress.png')
    try {
      assert(dress.lastEmployee?.text?.includes('这件连衣裙能退吗'), 'dress original')
      assert(
        Boolean(dress.lastEmployee?.rewrite?.includes(DRESS_REWRITE)),
        'dress rewrite UI-02',
        dress.lastEmployee?.rewrite,
      )
      assert(dress.lastOther?.tag === '知识问答', 'knowledge tag', dress.lastOther)
      assert(
        dress.lastOther?.text?.includes(APPAREL_KNOWLEDGE),
        'apparel knowledge UI-02',
        dress.lastOther?.text,
      )
      assert(dress.lastEmployee?.alignSelf === 'flex-end', 'employee right')
      assert(dress.lastOther?.alignSelf === 'flex-start', 'system left')
      assert(dress.employeeBubble?.color === 'rgb(255, 255, 255)', 'employee white text')
      assert(
        dress.employeeBubble?.backgroundColor === 'rgb(29, 78, 137)',
        'employee primary',
        dress.employeeBubble,
      )
      assert(Number(dress.composerPinGap) <= 2, 'composer pinned', dress.composerPinGap)
    } catch (err) {
      evidence.failed.push({ id: 'TC-02b', error: String(err.message) })
    }

    await evaluate(`document.querySelector('.employee-status button').click()`)
    await waitFor(
      `document.querySelector('.employee-status-text') && document.querySelector('.employee-status-text').textContent.includes('已转人工')`,
    )
    const handed = await evaluate(collectChat)
    evidence.steps.handoff = {
      statusText: handed.statusText,
      transferText: handed.transferText,
      transferDisabled: handed.transferDisabled,
      otherCount: handed.otherCount,
      messageCount: handed.messageCount,
    }
    const otherBeforeSend = handed.otherCount
    const afterHandoffSend = await sendChat('你好')
    evidence.steps.afterHandoff = {
      lastEmployee: afterHandoffSend.lastEmployee,
      lastOther: afterHandoffSend.lastOther,
      otherCount: afterHandoffSend.otherCount,
      otherBeforeSend,
      systemTags: afterHandoffSend.systemTags,
      statusText: afterHandoffSend.statusText,
    }
    await screenshot('t019-handoff.png')
    try {
      assert(
        handed.statusText?.includes('已转人工，等待客服'),
        'handoff status',
        handed.statusText,
      )
      assert(handed.transferDisabled === true, 'transfer disabled after handoff')
      assert(handed.transferText === '已转人工', 'transfer button label', handed.transferText)
      assert(afterHandoffSend.lastEmployee?.text?.includes('你好'), 'post-handoff employee visible')
      assert(
        afterHandoffSend.otherCount === otherBeforeSend,
        'no extra system auto-reply after handoff',
        { otherBeforeSend, otherAfter: afterHandoffSend.otherCount, lastOther: afterHandoffSend.lastOther },
      )
      assert(
        afterHandoffSend.lastOther?.tag !== '闲聊' && afterHandoffSend.lastOther?.tag !== 'FAQ',
        'no bot auto kind after handoff',
        afterHandoffSend.lastOther,
      )
    } catch (err) {
      evidence.failed.push({ id: 'TC-02c', error: String(err.message) })
    }

    evidence.pass = evidence.failed.length === 0
    await writeFile(path.join(OUT_DIR, 't019-browser-evidence.json'), JSON.stringify(evidence, null, 2))
    console.log(JSON.stringify({ pass: evidence.pass, failed: evidence.failed, cdpPort: CDP_PORT }, null, 2))
    if (!evidence.pass) process.exitCode = 1
  } finally {
    try {
      if (ws) ws.close()
    } catch {}
    if (chromeProc && !chromeProc.killed) chromeProc.kill()
  }
}

main().catch(async (err) => {
  console.error(String(err && err.stack ? err.stack : err))
  try {
    await writeFile(
      path.join(OUT_DIR, 't019-browser-evidence.json'),
      JSON.stringify({ pass: false, error: String(err && err.message ? err.message : err) }, null, 2),
    )
  } catch {}
  try {
    if (ws) ws.close()
  } catch {}
  if (chromeProc && !chromeProc.killed) chromeProc.kill()
  process.exit(1)
})
