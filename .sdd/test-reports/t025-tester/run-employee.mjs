import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const ROOT = path.resolve(
  'C:\\Users\\慈海客服\\Desktop\\demo\\Develop_Helper\\Projects_Repo\\Customer_Service',
)
const BASE = process.env.T025_TESTER_BASE || 'http://127.0.0.1:5221'
const CHROME = process.env.T025_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT_DIR = path.join(ROOT, '.sdd', 'test-reports', 't025-tester', 'evidence')
const CDP_PORT = Number(process.env.T025_TESTER_CDP_PORT || 9531)
const FALLBACK =
  '抱歉，这个问题我暂时无法根据现有知识准确回答。你可以换个说法再问，或点击转人工。'

function readSharedPassword() {
  const envText = readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8')
  for (const raw of envText.split(/\r?\n/)) {
    if (raw.startsWith('shared_password=')) return raw.slice('shared_password='.length).trim()
  }
  return ''
}

const PASS = process.env.T025_DEMO_PASS || readSharedPassword()

let chromeProc
let ws
let sessionId
let msgId = 0
const pending = new Map()
const checks = []
const failed = []
const apiCalls = []
const requestMeta = new Map()
const createdConversationPosts = []

function send(method, params = {}) {
  const id = ++msgId
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`CDP timeout: ${method}`))
    }, 30000)
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
    throw new Error(`eval failed: ${text}\n${expression.slice(0, 240)}`)
  }
  return result.result?.value
}

async function waitFor(expression, timeoutMs = 15000) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeoutMs) {
    last = await evaluate(`Boolean(${expression})`)
    if (last) return last
    await delay(200)
  }
  throw new Error(`waitFor timeout (${timeoutMs}ms): ${expression}; last=${JSON.stringify(last)}`)
}

async function screenshot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  await writeFile(path.join(OUT_DIR, name), Buffer.from(data, 'base64'))
  return name
}

function record(id, ok, expected, actual) {
  checks.push({ id, ok, expected, actual })
  if (!ok) failed.push({ id, expected, actual })
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
    return el.value;
  })()`
}

const SNAP = `(() => {
  const msgs = [...document.querySelectorAll('.chat-msg')].map((node) => ({
    role: node.classList.contains('employee') ? 'employee' : 'other',
    tag: node.querySelector('.chat-msg-tag')?.textContent?.trim() || null,
    text: node.querySelector('.chat-bubble')?.innerText?.replace(/\\s+/g, ' ').trim() || '',
    rewrite: node.querySelector('.chat-rewrite')?.innerText?.replace(/\\s+/g, ' ').trim() || null,
  }))
  return {
    pathname: location.pathname,
    header: document.querySelector('.user')?.textContent ?? null,
    status: document.querySelector('.employee-status-text')?.textContent ?? null,
    empty: document.querySelector('.employee-empty')?.textContent ?? null,
    mock: (document.body.innerText || '').includes('[Mock]'),
    bodyHasITEmpty: (document.body.innerText || '').includes('描述你的 IT 问题'),
    waiting: (document.body.innerText || '').includes('已转交客服') || (document.body.innerText || '').includes('等待客服'),
    transferDisabled: document.querySelector('.employee-status button')?.disabled ?? null,
    otherCount: document.querySelectorAll('.chat-msg.other').length,
    employeeCount: document.querySelectorAll('.chat-msg.employee').length,
    cid: sessionStorage.getItem('conversation_id'),
    messages: msgs,
  }
})()`

async function pageSnap() {
  return evaluate(SNAP)
}

async function conversationFromPage() {
  return evaluate(`(async () => {
    const token = localStorage.getItem('access_token')
    const cid = sessionStorage.getItem('conversation_id')
    if (!token || !cid) return { error: 'missing token or conversation', cid, hasToken: Boolean(token) }
    const res = await fetch('/api/conversations/' + cid, {
      headers: { Authorization: 'Bearer ' + token },
    })
    const body = await res.json()
    return { http: res.status, cid, success: body.success, data: body.data, error: body.error }
  })()`)
}

async function ticketProbe() {
  return evaluate(`(async () => {
    const token = localStorage.getItem('access_token')
    const cid = sessionStorage.getItem('conversation_id')
    const res = await fetch('/api/conversations/' + cid + '/ticket', {
      headers: { Authorization: 'Bearer ' + token },
    })
    const body = await res.json()
    return { http: res.status, error: body.error, error_code: body.error_code, hasTicketId: Boolean(body.data && body.data.id) }
  })()`)
}

async function pinExistingConversation() {
  await waitFor(`Boolean(sessionStorage.getItem('conversation_id'))`, 20000)
  await delay(700)
  const cid = await evaluate(`sessionStorage.getItem('conversation_id')`)
  await evaluate(`sessionStorage.setItem('conversation_id', ${JSON.stringify(cid)})`)
  await send('Page.reload', { ignoreCache: true })
  await waitFor(
    `location.pathname === '/employee' && sessionStorage.getItem('conversation_id') === ${JSON.stringify(cid)} && (document.querySelector('.employee-empty') || document.querySelector('.chat-msg'))`,
    20000,
  )
  return cid
}

async function newConversation() {
  await evaluate(`sessionStorage.removeItem('conversation_id')`)
  await send('Page.reload', { ignoreCache: true })
  await waitFor(`location.pathname === '/employee' && Boolean(sessionStorage.getItem('conversation_id'))`, 20000)
  return pinExistingConversation()
}

async function visibleSystemCount() {
  const conv = await conversationFromPage()
  const messages = conv?.data?.messages || []
  return messages.filter((m) => m.role === 'system' && m.kind !== 'waiting_for_agent').length
}

async function sendAndWait(text) {
  const beforeDom = await evaluate(`document.querySelectorAll('.chat-msg.other').length`)
  const beforeApi = await visibleSystemCount()
  const cidBefore = await evaluate(`sessionStorage.getItem('conversation_id')`)
  await evaluate(fillScript('textarea', text))
  const clicked = await evaluate(`(() => {
    const btn = document.querySelector('.employee-composer button[type=submit]')
    if (!btn || btn.disabled) return { ok: false, disabled: Boolean(btn?.disabled), label: btn?.textContent || null }
    btn.click()
    return { ok: true, label: btn.textContent }
  })()`)
  if (!clicked?.ok) throw new Error('send button not clicked: ' + JSON.stringify(clicked))
  const start = Date.now()
  while (Date.now() - start < 90000) {
    const now = await evaluate(`({
      other: document.querySelectorAll('.chat-msg.other').length,
      sending: document.querySelector('.employee-composer button')?.textContent || '',
      err: document.querySelector('.employee-composer-error')?.textContent || '',
      cid: sessionStorage.getItem('conversation_id'),
    })`)
    if (now.err) throw new Error('send error: ' + now.err)
    if (now.cid && cidBefore && now.cid !== cidBefore) {
      await evaluate(`sessionStorage.setItem('conversation_id', ${JSON.stringify(cidBefore)})`)
    }
    const apiCount = await visibleSystemCount()
    if ((now.other > beforeDom || apiCount > beforeApi) && now.sending !== '发送中…') return now
    await delay(400)
  }
  throw new Error('send timeout for: ' + text.slice(0, 40))
}

function lastOther(snap) {
  const others = snap.messages.filter((m) => m.role === 'other')
  return others[others.length - 1] || null
}

function stripConv(payload) {
  if (!payload || !payload.data) return payload
  const conv = payload.data
  return {
    http: payload.http,
    cid: payload.cid,
    status: conv.status,
    waiting_for_agent: conv.waiting_for_agent,
    clarification_round: conv.clarification_round,
    messages: (conv.messages || []).map((m) => ({
      id: m.id,
      role: m.role,
      kind: m.kind,
      content: m.content,
      original_content: m.original_content,
      rewritten_content: m.rewritten_content,
    })),
  }
}

async function loginEmployee() {
  await send('Page.navigate', { url: BASE + '/login' })
  await waitFor(`document.querySelector('#user') && document.querySelector('#pass')`, 20000)
  await evaluate(fillScript('#user', 'employee'))
  await evaluate(fillScript('#pass', PASS))
  await evaluate(`document.querySelector('button[type=submit]').click()`)
  await waitFor(`location.pathname === '/employee'`, 20000)
  return pinExistingConversation()
}

function onCdpEvent(message) {
  if (message.method === 'Network.requestWillBeSent') {
    const req = message.params.request
    const url = req.url || ''
    if (!url.includes('/api/')) return
    requestMeta.set(message.params.requestId, {
      url: url.replace(/^https?:\/\/[^/]+/, ''),
      method: req.method,
      ts: Date.now(),
    })
    if (req.method === 'POST' && /\/api\/conversations\/?$/.test(url.replace(/\?.*$/, ''))) {
      createdConversationPosts.push({ url: url.replace(/^https?:\/\/[^/]+/, ''), ts: Date.now() })
    }
  }
  if (message.method === 'Network.responseReceived') {
    const url = message.params.response?.url || ''
    if (!url.includes('/api/')) return
    const meta = requestMeta.get(message.params.requestId) || {}
    apiCalls.push({
      requestId: message.params.requestId,
      url: url.replace(/^https?:\/\/[^/]+/, ''),
      method: meta.method || message.params.response?.requestHeaders?.[':method'] || '',
      status: message.params.response?.status,
      mime: message.params.response?.mimeType,
    })
  }
}

async function main() {
  if (!PASS) throw new Error('missing shared_password')
  await mkdir(OUT_DIR, { recursive: true })
  const tmpProfile = await mkdtemp(path.join(os.tmpdir(), 't025-tester-chrome-'))
  chromeProc = spawn(
    CHROME,
    [
      `--remote-debugging-port=${CDP_PORT}`,
      '--remote-allow-origins=*',
      `--user-data-dir=${tmpProfile}`,
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
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const item = pending.get(message.id)
      pending.delete(message.id)
      clearTimeout(item.timer)
      if (message.error) item.reject(new Error(message.error.message || JSON.stringify(message.error)))
      else item.resolve(message.result)
      return
    }
    onCdpEvent(message)
  })
  const pages = await waitJson(`http://127.0.0.1:${CDP_PORT}/json/list`)
  const page = pages.find((item) => item.type === 'page') || pages[0]
  const attached = await send('Target.attachToTarget', { targetId: page.id, flatten: true })
  sessionId = attached.sessionId
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Network.enable')

  const results = {}
  const sessionIds = {}

  sessionIds.s1 = await loginEmployee()
  const empty = await pageSnap()
  await screenshot('tester-empty.png')
  record(
    'empty-copy',
    empty.empty === '描述你的购物问题' && empty.mock === false && empty.pathname === '/employee',
    'empty 描述你的购物问题, no [Mock], /employee',
    { empty: empty.empty, mock: empty.mock, header: empty.header, status: empty.status, cid: empty.cid },
  )
  record(
    'header-no-mock',
    empty.header === '已登录：employee' && empty.status === 'AI 接待中',
    '已登录：employee / AI 接待中',
    { header: empty.header, status: empty.status },
  )
  results.empty = empty

  await sendAndWait('星海 X1 耳机配合充电盒的总续航是多少小时？充电盒官方颜色是什么？')
  const ac001snap = await pageSnap()
  const ac001conv = stripConv(await conversationFromPage())
  await screenshot('tester-ac001.png')
  const ac001reply = lastOther(ac001snap)
  const ac001ok =
    ac001reply?.tag === '知识问答' &&
    ac001conv.status === 'bot' &&
    ac001conv.waiting_for_agent === false &&
    /48/.test(ac001reply.text) &&
    /星海蓝/.test(ac001reply.text) &&
    !/七天无理由/.test(ac001reply.text) &&
    !ac001snap.waiting &&
    ac001snap.mock === false
  record('AC-001', ac001ok, 'knowledge from 3C tags, 48h/星海蓝, not waiting, no mock', {
    tag: ac001reply?.tag,
    text: ac001reply?.text,
    status: ac001conv.status,
    waiting: ac001conv.waiting_for_agent,
    kinds: ac001conv.messages?.map((m) => m.kind),
  })
  results['AC-001'] = { snap: ac001snap, conv: ac001conv }

  await sendAndWait('云棉连衣裙签收后几天可以无理由退货？吊牌有什么要求？')
  const ac013snap = await pageSnap()
  const ac013conv = stripConv(await conversationFromPage())
  await screenshot('tester-ac013.png')
  const ac013reply = lastOther(ac013snap)
  const ac013ok =
    ac013reply?.tag === '知识问答' &&
    /7/.test(ac013reply.text) &&
    /吊牌/.test(ac013reply.text) &&
    !/只换不修/.test(ac013reply.text) &&
    !/星海蓝/.test(ac013reply.text) &&
    !/蓝牙/.test(ac013reply.text)
  record('AC-013', Boolean(ac013ok && ac001ok), 'fashion answer not using 3C; 3C answer not using fashion', {
    fashionTag: ac013reply?.tag,
    fashionText: ac013reply?.text,
    threeCText: ac001reply?.text,
  })
  results['AC-013'] = { snap: ac013snap, conv: ac013conv }

  const before016Dom = ac013snap.otherCount
  const before016Api = (ac013conv.messages || []).filter((m) => m.role === 'system' && m.kind !== 'waiting_for_agent').length
  await sendAndWait('星海 X1 的蓝牙版本是什么？另外云棉连衣裙的退货时限是几天？')
  const ac016snap = await pageSnap()
  const ac016conv = stripConv(await conversationFromPage())
  await screenshot('tester-ac016.png')
  const ac016reply = lastOther(ac016snap)
  const after016Api = (ac016conv.messages || []).filter((m) => m.role === 'system' && m.kind !== 'waiting_for_agent').length
  const ac016ok =
    ac016reply?.tag === '知识问答' &&
    ac016snap.otherCount === before016Dom + 1 &&
    after016Api === before016Api + 1 &&
    /5\.4|蓝牙/.test(ac016reply.text) &&
    /7/.test(ac016reply.text)
  record('AC-016', ac016ok, 'one knowledge bubble/system message with both answers segmented', {
    otherDelta: ac016snap.otherCount - before016Dom,
    systemDelta: after016Api - before016Api,
    tag: ac016reply?.tag,
    text: ac016reply?.text,
  })
  results['AC-016'] = { snap: ac016snap, conv: ac016conv }

  await sendAndWait('今天天气真好，陪我闲聊两句吧，不谈购物也不问商品')
  const ac012snap = await pageSnap()
  const ac012conv = stripConv(await conversationFromPage())
  await screenshot('tester-ac012.png')
  const ac012reply = lastOther(ac012snap)
  const ac012msg = [...(ac012conv.messages || [])].reverse().find((m) => m.role === 'system')
  const ac012ok =
    ac012reply?.tag === '闲聊' &&
    ac012msg?.kind === 'small_talk' &&
    !/星海 X1/.test(ac012reply.text) &&
    !/云棉连衣裙/.test(ac012reply.text) &&
    ac012reply.text !== FALLBACK
  record('AC-012', ac012ok, 'small_talk kind, not knowledge chunks, not fallback', {
    tag: ac012reply?.tag,
    kind: ac012msg?.kind,
    text: ac012reply?.text,
  })
  results['AC-012'] = { snap: ac012snap, conv: ac012conv }

  const fallbackCases = [
    ['包裹现在到哪了，不要说政策只要当前位置', 'live-location'],
    ['仓库里星海 X1 现在还有多少件库存', 'inventory'],
    ['刚才那笔支付成功了吗', 'payment'],
    ['帮我推导一下广义相对论场方程，这和购物无关', 'out-of-scope'],
  ]
  const fallbackDetails = []
  let fallbackAll = true
  for (const [text, key] of fallbackCases) {
    await sendAndWait(text)
    const snap = await pageSnap()
    const conv = stripConv(await conversationFromPage())
    await screenshot(`tester-ac014-${key}.png`)
    const reply = lastOther(snap)
    const lastSys = [...(conv.messages || [])].reverse().find((m) => m.role === 'system')
    const fabricated = /到了|签收点|已发车|支付成功|库存还有|还剩\d+件/.test(reply?.text || '')
    const ok =
      reply?.text === FALLBACK &&
      lastSys?.kind === 'fallback' &&
      conv.status === 'bot' &&
      conv.waiting_for_agent === false &&
      !snap.waiting &&
      !fabricated
    if (!ok) fallbackAll = false
    fallbackDetails.push({
      key,
      text,
      tag: reply?.tag,
      content: reply?.text,
      kind: lastSys?.kind,
      status: conv.status,
      waiting: conv.waiting_for_agent,
      fabricated,
    })
    results['AC-014-' + key] = { snap, conv }
  }
  const ticket = await ticketProbe()
  record(
    'AC-014',
    fallbackAll && ticket.http === 409 && ticket.hasTicketId === false,
    'fixed fallback, bot status, ticket 409 no row',
    { fallbackDetails, ticket },
  )
  record(
    'AC-015',
    fallbackAll && fallbackDetails.every((item) => item.content === FALLBACK && item.fabricated === false),
    'no fabricated live location/stock/payment',
    fallbackDetails,
  )
  results.ticketProbe = ticket

  sessionIds.s2 = await newConversation()
  const empty2 = await pageSnap()
  record('empty-session-b', empty2.empty === '描述你的购物问题' && empty2.mock === false, 'new session empty copy', {
    empty: empty2.empty,
    mock: empty2.mock,
    cid: empty2.cid,
  })
  await sendAndWait('这件云棉连衣裙退货要不要保留吊牌？')
  await sendAndWait('能退吗')
  const ac021snap = await pageSnap()
  const ac021conv = stripConv(await conversationFromPage())
  await screenshot('tester-ac021.png')
  const ac021reply = lastOther(ac021snap)
  const lastEmployee = [...(ac021conv.messages || [])].reverse().find((m) => m.kind === 'employee_turn')
  const ac021ok =
    ac021reply?.tag === '知识问答' &&
    ac021reply.text !== FALLBACK &&
    /连衣裙|吊牌|7/.test(ac021reply.text + (lastEmployee?.rewritten_content || '')) &&
    Boolean(lastEmployee?.rewritten_content) &&
    lastEmployee.original_content === '能退吗'
  record('AC-021', ac021ok, 'short follow-up completed to 连衣裙 return, rewritten stored', {
    tag: ac021reply?.tag,
    text: ac021reply?.text,
    original: lastEmployee?.original_content,
    rewritten: lastEmployee?.rewritten_content,
  })
  results['AC-021'] = { snap: ac021snap, conv: ac021conv }

  sessionIds.s3 = await newConversation()
  await sendAndWait('能不能退')
  const ac019snap = await pageSnap()
  const ac019conv = stripConv(await conversationFromPage())
  await screenshot('tester-ac019.png')
  const ac019reply = lastOther(ac019snap)
  const ac019emp = [...(ac019conv.messages || [])].reverse().find((m) => m.kind === 'employee_turn')
  const ac019sys = [...(ac019conv.messages || [])].reverse().find((m) => m.role === 'system')
  const ac019ok =
    ac019reply?.tag === '反问' &&
    ac019sys?.kind === 'clarification' &&
    ac019reply.text !== FALLBACK &&
    ac019emp?.original_content === '能不能退' &&
    Boolean(ac019emp?.rewritten_content)
  record('AC-019', ac019ok, 'clarification not fallback/knowledge; original+rewrite stored', {
    tag: ac019reply?.tag,
    kind: ac019sys?.kind,
    text: ac019reply?.text,
    original: ac019emp?.original_content,
    rewritten: ac019emp?.rewritten_content,
  })
  results['AC-019'] = { snap: ac019snap, conv: ac019conv }

  record('no-mock-page', !empty.mock && !ac001snap.mock && !ac019snap.mock, 'no [Mock] on pages', {
    empty: empty.mock,
    ac001: ac001snap.mock,
    ac019: ac019snap.mock,
  })

  const evidence = {
    pass: failed.length === 0,
    failed,
    checks,
    sessionIds,
    createdConversationPosts: createdConversationPosts.length,
    apiCalls: apiCalls.filter((item) => item.url.includes('/api/')),
    results,
    secrets_omitted: true,
  }
  await writeFile(path.join(OUT_DIR, 'tester-browser-evidence.json'), JSON.stringify(evidence, null, 2), 'utf8')
  console.log('TESTER_BROWSER_PASS=' + (failed.length === 0))
  console.log('TESTER_BROWSER_FAILED=' + failed.map((item) => item.id).join(','))
  console.log('TESTER_SESSION_IDS=' + JSON.stringify(sessionIds))
  console.log('TESTER_API_CALLS=' + apiCalls.length)
  if (failed.length) process.exitCode = 1
}

main()
  .catch((err) => {
    console.error('TESTER_BROWSER_FAIL=' + err.message)
    process.exitCode = 1
  })
  .finally(async () => {
    try {
      if (ws) ws.close()
    } catch {}
    try {
      if (chromeProc && chromeProc.pid) chromeProc.kill()
    } catch {}
  })
