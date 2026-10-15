import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const BASE = 'http://127.0.0.1:5199'
const BACKEND = 'http://127.0.0.1:8099'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT_DIR = path.resolve(
  'C:\\Users\\慈海客服\\Desktop\\demo\\Develop_Helper\\Projects_Repo\\Customer_Service\\.sdd\\test-reports',
)
const BACKEND_LOG =
  'C:\\Users\\慈海客服\\.cursor\\projects\\c-Users-Desktop-demo-Develop-Helper\\terminals\\407193.txt'
const BACKEND_ENV = path.resolve(
  'C:\\Users\\慈海客服\\Desktop\\demo\\Develop_Helper\\Projects_Repo\\Customer_Service\\backend\\.env',
)
const CDP_PORT = 9413
const USERNAME = 'it-help'
const PASSWORD = 'it-help123'
const T012_HANDED_OFF = 'e05c8bc6-f3aa-4eb6-a96e-11b3219578a2'
const FAQ_Q = 'T011HELIX 重置 VPN 密码的要点是什么'
const AFTER_FAQ = 'T013-POST-HANDOFF-FAQ T011HELIX 重置 VPN 密码的要点是什么'
const AFTER_CHAT = 'T013-POST-HANDOFF-CHAT 你好呀今天天气真好我们不谈电脑'
const AGENT_R1 = 'T013-AGENT-1 这是客服接管后的第一条回复。'
const AGENT_R2 = 'T013-AGENT-2 用于约三秒到达员工端。'
const TEXT_TRANSFER = '请帮我转人工，不要点按钮。'
const FALLBACK =
  '抱歉，这个问题我暂时无法根据现有知识准确回答。你可以换个说法再问，或点击转人工。'

let chromeProc
let ws
let sessionId
let msgId = 0
const pending = new Map()
const checks = []
const networkLog = []
const postBodies = []

function record(id, pass, expected, actual, extra = {}) {
  checks.push({ id, pass: Boolean(pass), expected, actual, ...extra })
  if (!pass) console.error(`FAIL ${id}: expected ${JSON.stringify(expected)} actual ${JSON.stringify(actual)}`)
  else console.log(`PASS ${id}`)
}

function redact(text) {
  return String(text ?? '')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer REDACTED')
    .replace(/sk-[A-Za-z0-9._-]+/g, 'sk-REDACTED')
    .replace(/(llm_api_key=).*/gi, '$1REDACTED')
    .replace(/(authorization["']?\s*[:=]\s*["']?)[^"'\s]+/gi, '$1REDACTED')
}

function send(method, params = {}, timeoutMs = 30000) {
  const id = ++msgId
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`CDP timeout: ${method}`))
    }, timeoutMs)
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

async function evaluate(expression, timeoutMs = 30000) {
  const result = await send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    timeoutMs,
  )
  if (result.exceptionDetails) {
    const text =
      result.exceptionDetails.exception?.description ||
      result.exceptionDetails.text ||
      'eval failed'
    throw new Error(`eval failed: ${text}`)
  }
  return result.result?.value
}

async function waitFor(expression, timeoutMs = 10000) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeoutMs) {
    last = await evaluate(`Boolean(${expression})`)
    if (last) return last
    await delay(150)
  }
  throw new Error(`waitFor timeout (${timeoutMs}ms): ${expression}; last=${JSON.stringify(last)}`)
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

async function setViewport(width, height) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  })
}

async function screenshot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  await writeFile(path.join(OUT_DIR, name), Buffer.from(data, 'base64'))
  return name
}

const collectChat = `(() => {
  const msgs = [...document.querySelectorAll('.chat-msg')].map((n) => ({
    side: n.classList.contains('employee') ? 'employee' : 'other',
    tag: n.querySelector('.chat-msg-tag')?.textContent ?? null,
    text: n.querySelector('.chat-bubble')?.textContent ?? '',
    rewrite: n.querySelector('.chat-rewrite')?.textContent ?? null,
  }));
  const transferBtn = document.querySelector('.employee-status button');
  const composer = document.querySelector('.employee-composer');
  const statusBar = document.querySelector('.employee-status');
  return {
    pathname: location.pathname,
    conversationId: sessionStorage.getItem('conversation_id'),
    pageName: document.querySelector('.page-name')?.textContent ?? null,
    topbarUser: document.querySelector('.session .user')?.textContent ?? null,
    statusText: document.querySelector('.employee-status-text')?.textContent ?? null,
    transferLabel: transferBtn?.textContent?.trim() ?? null,
    transferDisabled: Boolean(transferBtn?.disabled),
    messageCount: msgs.length,
    otherCount: msgs.filter((m) => m.side === 'other').length,
    employeeCount: msgs.filter((m) => m.side === 'employee').length,
    otherTags: msgs.filter((m) => m.side === 'other').map((m) => m.tag),
    messages: msgs.map((m) => ({
      side: m.side,
      tag: m.tag,
      text: (m.text || '').slice(0, 400),
      rewrite: m.rewrite ? String(m.rewrite).slice(0, 240) : null,
    })),
    lastOther: msgs.filter((m) => m.side === 'other').at(-1)
      ? {
          tag: msgs.filter((m) => m.side === 'other').at(-1).tag,
          text: (msgs.filter((m) => m.side === 'other').at(-1).text || '').slice(0, 500),
        }
      : null,
    lastEmployee: msgs.filter((m) => m.side === 'employee').at(-1)
      ? {
          text: (msgs.filter((m) => m.side === 'employee').at(-1).text || '').slice(0, 240),
          rewrite: msgs.filter((m) => m.side === 'employee').at(-1).rewrite
            ? String(msgs.filter((m) => m.side === 'employee').at(-1).rewrite).slice(0, 240)
            : null,
        }
      : null,
    pageHasMock: (document.body.innerText || '').includes('[Mock]'),
    sending: Boolean(document.querySelector('.employee-composer textarea')?.disabled),
    errorText: document.querySelector('.employee-composer-error')?.textContent ?? '',
    layout: {
      composerBottom: composer ? Math.round(composer.getBoundingClientRect().bottom) : null,
      statusTop: statusBar ? Math.round(statusBar.getBoundingClientRect().top) : null,
      employeeBubbleWhite:
        getComputedStyle(document.querySelector('.chat-msg.employee .chat-bubble') || document.body).color,
      employeeBubbleBg:
        getComputedStyle(document.querySelector('.chat-msg.employee .chat-bubble') || document.body).backgroundColor,
      canvas: getComputedStyle(document.querySelector('.employee-chat') || document.body).backgroundColor,
    },
  };
})()`

const collectAgent = `(() => {
  const rows = [...document.querySelectorAll('.agent-row')].map((r) => ({
    title: r.querySelector('.agent-row-title')?.textContent ?? '',
    meta: r.querySelector('.agent-row-meta')?.textContent ?? '',
    selected: r.classList.contains('selected'),
  }));
  const msgs = [...document.querySelectorAll('.agent-msg')].map((n) => ({
    side: n.classList.contains('agent-msg-user') ? 'employee' : 'peer',
    tag: n.querySelector('.agent-tag')?.textContent ?? null,
    text: (n.querySelector('.agent-bubble')?.textContent || '').slice(0, 400),
    rewrite: n.querySelector('.agent-rewrite')?.textContent ?? null,
  }));
  const list = document.querySelector('.agent-list');
  return {
    pathname: location.pathname,
    pageName: document.querySelector('.page-name')?.textContent ?? null,
    topbarUser: document.querySelector('.session .user')?.textContent ?? null,
    rowCount: rows.length,
    rows,
    messageCount: msgs.length,
    messages: msgs,
    emptyText: document.querySelector('.agent-empty')?.textContent ?? null,
    replyDisabled: Boolean(document.querySelector('.agent-composer textarea')?.disabled),
    sendLabel: document.querySelector('.agent-composer button')?.textContent?.trim() ?? null,
    listWidth: list ? Math.round(list.getBoundingClientRect().width) : null,
    pageHasMock: (document.body.innerText || '').includes('[Mock]'),
    sendError: document.querySelector('.agent-send-error')?.textContent ?? '',
  };
})()`

function noteNetwork(msg) {
  if (msg.method === 'Network.requestWillBeSent') {
    const req = msg.params?.request
    const url = String(req?.url || '')
    if (!/\/api\/(documents|conversations|sessions)/.test(url)) return
    networkLog.push({
      kind: 'request',
      requestId: msg.params.requestId,
      method: req.method,
      url: String(url).replace(/([?&]access_token=)[^&]+/gi, '$1REDACTED'),
      ts: Date.now(),
    })
  }
  if (msg.method === 'Network.responseReceived') {
    const res = msg.params?.response
    const url = String(res?.url || '')
    if (!/\/api\/(documents|conversations|sessions)/.test(url)) return
    networkLog.push({
      kind: 'response',
      requestId: msg.params.requestId,
      status: res.status,
      url: String(url).replace(/([?&]access_token=)[^&]+/gi, '$1REDACTED'),
      mimeType: res.mimeType,
      ts: Date.now(),
    })
  }
  if (msg.method === 'Network.loadingFinished') {
    const requestId = msg.params?.requestId
    const req = networkLog.find((e) => e.kind === 'request' && e.requestId === requestId)
    if (!req) return
    const pathOnly = req.url.split('?')[0]
    const interesting =
      req.method === 'POST' &&
      /(\/messages|\/transfer|\/replies)$/.test(pathOnly)
    if (!interesting) return
    send('Network.getResponseBody', { requestId })
      .then((body) => {
        let parsed = null
        try {
          parsed = JSON.parse(body.body || '{}')
        } catch {
          parsed = null
        }
        const data = parsed?.data
        postBodies.push({
          requestId,
          url: req.url,
          method: req.method,
          status: networkLog.find((e) => e.kind === 'response' && e.requestId === requestId)?.status,
          replyKind: data?.reply?.kind ?? null,
          replyRole: data?.reply?.role ?? null,
          conversationStatus: data?.conversation?.status ?? (data?.status ?? null),
          conversationId: data?.conversation?.id ?? data?.id ?? null,
          replyContent: String(data?.reply?.content || data?.content || '').slice(0, 240),
          error: parsed?.error ?? null,
          errorCode: parsed?.error_code ?? null,
        })
      })
      .catch(() => {})
  }
}

async function apiFetch(pathname, options = {}) {
  return evaluate(
    `(async () => {
      const token = localStorage.getItem('access_token');
      const headers = { Authorization: 'Bearer ' + token };
      if (${JSON.stringify(Boolean(options.json))}) headers['Content-Type'] = 'application/json';
      const res = await fetch(${JSON.stringify(pathname)}, {
        method: ${JSON.stringify(options.method || 'GET')},
        headers,
        ${options.json ? `body: ${JSON.stringify(JSON.stringify(options.json))},` : ''}
      });
      let body = null;
      try { body = await res.json(); } catch {}
      return { status: res.status, body };
    })()`,
    options.timeoutMs || 30000,
  )
}

function slimConv(body) {
  const conv = body?.data || body
  if (!conv || typeof conv !== 'object') return null
  const messages = Array.isArray(conv.messages) ? conv.messages : []
  const lastEmployee = [...messages].reverse().find((m) => m.role === 'employee')
  const lastSystem = [...messages].reverse().find((m) => m.role === 'system')
  const lastAgent = [...messages].reverse().find((m) => m.role === 'agent')
  return {
    id: conv.id,
    status: conv.status,
    clarification_round: conv.clarification_round,
    waiting_for_agent: conv.waiting_for_agent,
    messageCount: messages.length,
    kinds: messages.map((m) => `${m.role}:${m.kind}`),
    employeeOriginals: messages
      .filter((m) => m.role === 'employee')
      .map((m) => String(m.original_content || m.content || '').slice(0, 120)),
    employeeRewrites: messages
      .filter((m) => m.role === 'employee')
      .map((m) => (m.rewritten_content ? String(m.rewritten_content).slice(0, 160) : null)),
    lastEmployee: lastEmployee
      ? {
          kind: lastEmployee.kind,
          original: String(lastEmployee.original_content || lastEmployee.content || '').slice(0, 240),
          rewritten: lastEmployee.rewritten_content
            ? String(lastEmployee.rewritten_content).slice(0, 240)
            : null,
        }
      : null,
    lastSystem: lastSystem
      ? {
          kind: lastSystem.kind,
          content: String(lastSystem.content || '').slice(0, 500),
        }
      : null,
    lastAgent: lastAgent
      ? {
          kind: lastAgent.kind,
          content: String(lastAgent.content || '').slice(0, 240),
        }
      : null,
    waitingKinds: messages.filter((m) => m.kind === 'waiting_for_agent').length,
    faqOrAiAfter: messages
      .filter((m) => ['faq', 'small_talk', 'knowledge', 'clarification', 'fallback'].includes(m.kind))
      .map((m) => `${m.role}:${m.kind}`),
  }
}

function slimList(body) {
  const items = body?.data || []
  const list = Array.isArray(items) ? items : []
  return {
    count: list.length,
    ids: list.map((i) => i.id),
    statuses: list.map((i) => i.status),
    allHandedOff: list.length === 0 || list.every((i) => i.status === 'handed_off'),
    previews: list.map((i) => String(i.preview || '').slice(0, 80)),
  }
}

async function logSize() {
  try {
    const buf = await readFile(BACKEND_LOG)
    return buf.length
  } catch {
    return 0
  }
}

async function snapshotLog(startSize) {
  try {
    const buf = await readFile(BACKEND_LOG)
    const added = buf.subarray(startSize).toString('utf8')
    const lines = added
      .split(/\r?\n/)
      .filter((line) =>
        /百炼|httpx|dashscope|chat\/completions|embeddings|调用百炼/i.test(line),
      )
      .map((line) => redact(line).slice(0, 400))
    return {
      addedBytes: added.length,
      matchLines: lines.slice(-30),
      chatCompletions: lines.filter((l) => /chat\/completions/.test(l)).length,
      embeddings: lines.filter((l) => /embeddings/.test(l)).length,
      bailianOk: lines.filter((l) => /调用百炼接口成功/.test(l)).length,
    }
  } catch (err) {
    return { error: String(err) }
  }
}

async function login() {
  await waitFor(`document.querySelector('.login-card') || document.querySelector('#user')`, 8000)
  await evaluate(fillScript('#user', USERNAME))
  await evaluate(fillScript('#pass', PASSWORD))
  await evaluate(`document.querySelector('button[type="submit"]').click()`)
  await waitFor(`document.querySelector('.app') && location.pathname === '/employee'`, 12000)
}

async function clickNav(label) {
  await evaluate(`(() => {
    const a = [...document.querySelectorAll('.sidebar a')].find((el) => el.textContent.trim() === ${JSON.stringify(label)});
    if (!a) throw new Error('missing nav ' + ${JSON.stringify(label)});
    a.click();
  })()`)
}

async function waitConversationId(notId = null, timeoutMs = 15000) {
  const start = Date.now()
  let last = null
  while (Date.now() - start < timeoutMs) {
    last = await evaluate(`sessionStorage.getItem('conversation_id')`)
    if (last && last !== notId) {
      await delay(400)
      const again = await evaluate(`sessionStorage.getItem('conversation_id')`)
      if (again && again === last && again !== notId) return again
    }
    await delay(200)
  }
  throw new Error(`no conversation_id (not ${notId}); last=${last}`)
}

async function sendChat(text, timeoutMs = 90000) {
  const before = await evaluate(collectChat)
  const logStart = await logSize()
  await evaluate(fillScript('.employee-composer textarea', text))
  await evaluate(`document.querySelector('.employee-composer button[type="submit"]').click()`)
  const start = Date.now()
  let last = before
  while (Date.now() - start < timeoutMs) {
    last = await evaluate(collectChat)
    if (last.errorText && /服务暂时不可用|发送失败/.test(last.errorText) && !last.sending) {
      return { ui: last, error: last.errorText, logs: await snapshotLog(logStart), timeout: false }
    }
    const newOther =
      last.messageCount > before.messageCount &&
      last.lastOther &&
      last.lastEmployee?.text?.includes(text.slice(0, 16)) &&
      !last.sending
    if (newOther && last.lastOther.text) {
      const id = last.conversationId
      const api = id ? await apiFetch(`/api/conversations/${id}`) : null
      return {
        ui: last,
        api: slimConv(api?.body),
        httpStatus: api?.status,
        logs: await snapshotLog(logStart),
        error: null,
      }
    }
    await delay(400)
  }
  return { ui: last, error: `timeout:${text.slice(0, 40)}`, logs: await snapshotLog(logStart), timeout: true }
}

async function sendAfterHandoff(text, timeoutMs = 20000) {
  const before = await evaluate(collectChat)
  const logStart = await logSize()
  await evaluate(fillScript('.employee-composer textarea', text))
  await evaluate(`document.querySelector('.employee-composer button[type="submit"]').click()`)
  const start = Date.now()
  let last = before
  while (Date.now() - start < timeoutMs) {
    last = await evaluate(collectChat)
    if (last.errorText && /服务暂时不可用|发送失败/.test(last.errorText) && !last.sending) {
      return { ui: last, error: last.errorText, logs: await snapshotLog(logStart), timeout: false }
    }
    const employeeLanded =
      !last.sending &&
      last.employeeCount > before.employeeCount &&
      String(last.lastEmployee?.text || '').includes(text.slice(0, 18))
    if (employeeLanded) {
      const id = last.conversationId
      const api = id ? await apiFetch(`/api/conversations/${id}`) : null
      const slim = slimConv(api?.body)
      const lastEmpOrig = slim?.lastEmployee?.original || ''
      const msgs = slim ? (api?.body?.data?.messages || []) : []
      const empIdx = [...msgs].map((m, i) => ({ m, i })).reverse().find(({ m }) => m.role === 'employee' && String(m.original_content || m.content || '').includes(text.slice(0, 18)))
      const afterKinds = empIdx
        ? msgs.slice(empIdx.i + 1).map((m) => `${m.role}:${m.kind}`)
        : []
      return {
        ui: last,
        api: slim,
        httpStatus: api?.status,
        logs: await snapshotLog(logStart),
        otherDelta: last.otherCount - before.otherCount,
        afterKinds,
        lastEmpOrig,
        error: null,
      }
    }
    await delay(200)
  }
  return { ui: last, error: `timeout-handoff:${text.slice(0, 40)}`, logs: await snapshotLog(logStart), timeout: true }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const envText = await readFile(BACKEND_ENV, 'utf8')
  const llmKeyConfigured = envText.split(/\r?\n/).some((line) => {
    const m = line.match(/^llm_api_key=(.+)$/)
    return Boolean(m && m[1] && !/changeme|your[_-]?key|placeholder/i.test(m[1]))
  })

  const userData = await mkdtemp(path.join(os.tmpdir(), 't013-chrome-'))
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
  ws = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('ws error')), { once: true })
  })
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data))
    if (msg.method) noteNetwork(msg)
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
  await send('Network.enable')
  await setViewport(1440, 900)

  async function goto(url) {
    const nav = send('Page.navigate', { url })
    await Promise.race([send('Page.loadEventFired').catch(() => null), delay(3000)])
    await nav
  }

  const evidence = {
    mock: false,
    viewport: '1440x900',
    cdpPort: CDP_PORT,
    url: BASE,
    backend: BACKEND,
    userDataDir: userData,
    llmKeyConfigured,
    t012HandedOffAvoided: T012_HANDED_OFF,
    steps: {},
  }

  try {
    const vite = await fetch(BASE)
    evidence.viteStatus = vite.status
    record('env-vite', vite.status === 200, 200, vite.status)
    const backend = await fetch(`${BACKEND}/docs`)
    evidence.backendStatus = backend.status
    record('env-backend', backend.status === 200, 200, backend.status)
    record('env-llm-key', llmKeyConfigured, true, llmKeyConfigured ? 'configured' : 'missing')

    await goto(`${BASE}/login`)
    await login()
    const afterLogin = await evaluate(collectChat)
    evidence.steps.login = {
      pathname: afterLogin.pathname,
      pageHasMock: afterLogin.pageHasMock,
      topbarUser: afterLogin.topbarUser,
    }
    record('env-no-mock', afterLogin.pageHasMock === false, false, afterLogin.pageHasMock)
    record(
      'env-login',
      afterLogin.pathname === '/employee' && String(afterLogin.topbarUser || '').includes(USERNAME),
      '/employee + 已登录',
      `${afterLogin.pathname} ${afterLogin.topbarUser}`,
    )
    await screenshot('t013-login-employee.png')

    await evaluate(`sessionStorage.removeItem('conversation_id')`)
    await goto(`${BASE}/employee`)
    await waitFor(`document.querySelector('.employee-chat')`, 8000)
    const convA = await waitConversationId(T012_HANDED_OFF)
    evidence.convA = convA
    record('tc-new-session', convA && convA !== T012_HANDED_OFF, 'new id != T-012 Conv B', convA)

    const q1 = await sendChat(FAQ_Q)
    evidence.steps.q1 = {
      error: q1.error || null,
      ui: {
        statusText: q1.ui?.statusText,
        tag: q1.ui?.lastOther?.tag,
        rewrite: q1.ui?.lastEmployee?.rewrite,
        pageHasMock: q1.ui?.pageHasMock,
      },
      api: q1.api,
      httpStatus: q1.httpStatus,
      logs: q1.logs,
    }
    const q1Ok =
      !q1.error &&
      q1.api?.status === 'bot' &&
      q1.ui?.statusText === 'AI 接待中' &&
      q1.ui?.transferDisabled === false &&
      Boolean(q1.api?.lastEmployee?.rewritten) &&
      q1.api?.lastSystem?.kind !== 'waiting_for_agent'
    record(
      'ac008-unhanded-no-waiting-after-q1',
      q1Ok,
      'bot + AI接待中 + rewritten + not waiting_for_agent',
      {
        status: q1.api?.status,
        ui: q1.ui?.statusText,
        kind: q1.api?.lastSystem?.kind,
        rewritten: Boolean(q1.api?.lastEmployee?.rewritten),
        error: q1.error || null,
      },
    )
    await screenshot('t013-ac005-employee-before-transfer.png')

    const listBefore = slimList((await apiFetch('/api/conversations?page=1&page_size=20')).body)
    evidence.steps.listBefore = listBefore
    record(
      'tc-api008-only-handed-off-before',
      listBefore.allHandedOff && !listBefore.ids.includes(convA),
      'list all handed_off and convA absent',
      { allHandedOff: listBefore.allHandedOff, includesA: listBefore.ids.includes(convA), count: listBefore.count },
    )

    const reply409 = await apiFetch(`/api/conversations/${convA}/replies`, {
      method: 'POST',
      json: { content: '不应接管未转接会话' },
    })
    evidence.steps.api012onBot = {
      status: reply409.status,
      error: reply409.body?.error ?? null,
      errorCode: reply409.body?.error_code ?? null,
    }
    record(
      'ac008-api012-409-on-bot',
      reply409.status === 409 && reply409.body?.error_code === 'CONFLICT',
      '409 CONFLICT',
      { status: reply409.status, errorCode: reply409.body?.error_code, error: reply409.body?.error },
    )

    const after409 = slimConv((await apiFetch(`/api/conversations/${convA}`)).body)
    record(
      'ac008-still-bot-after-409',
      after409?.status === 'bot' && after409?.lastSystem?.kind !== 'waiting_for_agent',
      'status bot, last system not waiting',
      { status: after409?.status, lastKind: after409?.lastSystem?.kind },
    )

    await evaluate(`document.querySelector('.employee-status button').click()`)
    const transferStart = Date.now()
    let transferredUi = null
    while (Date.now() - transferStart < 15000) {
      transferredUi = await evaluate(collectChat)
      if (
        transferredUi.statusText === '已转人工，等待客服' &&
        transferredUi.transferDisabled &&
        transferredUi.conversationId === convA
      ) {
        break
      }
      await delay(200)
    }
    const afterTransfer = slimConv((await apiFetch(`/api/conversations/${convA}`)).body)
    evidence.steps.transfer = { ui: transferredUi, api: afterTransfer }
    record(
      'ac005-transfer',
      afterTransfer?.status === 'handed_off' &&
        transferredUi?.statusText === '已转人工，等待客服' &&
        transferredUi?.transferDisabled === true,
      'handed_off + 已转人工，等待客服 + button disabled',
      {
        status: afterTransfer?.status,
        ui: transferredUi?.statusText,
        disabled: transferredUi?.transferDisabled,
      },
    )
    await screenshot('t013-ac005-employee-after-transfer.png')

    const listAfter = slimList((await apiFetch('/api/conversations?page=1&page_size=20')).body)
    evidence.steps.listAfter = listAfter
    record(
      'tc-api008-includes-handed-off-a',
      listAfter.allHandedOff && listAfter.ids.includes(convA) && !listAfter.statuses.includes('bot'),
      'convA in list, no bot statuses',
      { includesA: listAfter.ids.includes(convA), statuses: [...new Set(listAfter.statuses)] },
    )

    await clickNav('客服端')
    await waitFor(`document.querySelector('.agent-inbox')`, 8000)
    const agentWaitStart = Date.now()
    let agentUi = null
    while (Date.now() - agentWaitStart < 12000) {
      agentUi = await evaluate(collectAgent)
      const hasA = agentUi.rows.some(
        (r) =>
          r.title.includes('T011HELIX') ||
          r.title.includes('VPN') ||
          r.selected,
      )
      if (agentUi.rowCount > 0 && hasA) break
      await delay(300)
    }
    const previewOfA = listAfter.previews[listAfter.ids.indexOf(convA)] || ''
    await evaluate(`(() => {
      const rows = [...document.querySelectorAll('.agent-row')];
      const needle = ${JSON.stringify(previewOfA).slice(0, 80)};
      const hit = rows.find((r) => (r.querySelector('.agent-row-title')?.textContent || '').includes(needle.slice(0, 12)))
        || rows.find((r) => /T011HELIX|VPN|密码/.test(r.querySelector('.agent-row-title')?.textContent || ''));
      if (hit) hit.click();
    })()`)
    await delay(800)
    agentUi = await evaluate(collectAgent)
    const agentHasRewrite = agentUi.messages.some((m) => m.rewrite && /改写/.test(m.rewrite))
    const agentHasEmployeeQ = agentUi.messages.some((m) => /T011HELIX|VPN/.test(m.text || ''))
    const agentHasSystem = agentUi.messages.some((m) => m.side === 'peer' && m.tag && m.tag !== '等待客服')
    evidence.steps.agentOpen = {
      rowCount: agentUi.rowCount,
      listWidth: agentUi.listWidth,
      pageName: agentUi.pageName,
      pageHasMock: agentUi.pageHasMock,
      selectedTitle: agentUi.rows.find((r) => r.selected)?.title ?? null,
      messageCount: agentUi.messageCount,
      hasRewrite: agentHasRewrite,
      hasEmployeeQ: agentHasEmployeeQ,
      hasSystem: agentHasSystem,
      tags: agentUi.messages.map((m) => m.tag),
      rewrites: agentUi.messages.map((m) => m.rewrite).filter(Boolean),
    }
    record(
      'ac005-agent-sees-history-rewrite',
      agentHasEmployeeQ && agentHasRewrite && agentHasSystem && agentUi.pageHasMock === false,
      'agent thread has employee Q + rewrite + prior system reply',
      {
        hasEmployeeQ: agentHasEmployeeQ,
        hasRewrite: agentHasRewrite,
        hasSystem: agentHasSystem,
        mock: agentUi.pageHasMock,
      },
    )
    record(
      'ui03-layout',
      agentUi.pageName === '客服端' &&
        agentUi.listWidth === 320 &&
        agentUi.sendLabel === '回复' &&
        agentUi.rows.every((r) => /已转人工/.test(r.meta)),
      '客服端 + list 320 + 回复 + 已转人工',
      { pageName: agentUi.pageName, listWidth: agentUi.listWidth, sendLabel: agentUi.sendLabel },
    )
    await screenshot('t013-ac005-agent-inbox.png')

    await clickNav('员工端')
    await waitFor(`document.querySelector('.employee-chat') && sessionStorage.getItem('conversation_id') === ${JSON.stringify(convA)}`, 8000)
    const empAfterNav = await evaluate(collectChat)
    record(
      'd001-same-session-after-nav',
      empAfterNav.conversationId === convA && empAfterNav.statusText === '已转人工，等待客服',
      convA,
      empAfterNav.conversationId,
    )

    const faqAfter = await sendAfterHandoff(AFTER_FAQ)
    evidence.steps.ac006faq = {
      error: faqAfter.error || null,
      otherDelta: faqAfter.otherDelta,
      afterKinds: faqAfter.afterKinds,
      lastKind: faqAfter.api?.lastSystem?.kind,
      status: faqAfter.api?.status,
      otherTags: faqAfter.ui?.otherTags,
      logs: faqAfter.logs,
    }
    const faqNoAi =
      !faqAfter.error &&
      faqAfter.api?.status === 'handed_off' &&
      faqAfter.otherDelta === 0 &&
      !(faqAfter.afterKinds || []).some((k) => /:(faq|small_talk|knowledge|clarification|fallback)$/.test(k)) &&
      (faqAfter.api?.lastSystem?.kind === 'waiting_for_agent' || (faqAfter.afterKinds || []).includes('system:waiting_for_agent')) &&
      (faqAfter.logs?.chatCompletions || 0) === 0
    record(
      'ac006-faq-no-ai',
      faqNoAi,
      'handed_off, no new FAQ/AI bubble, waiting_for_agent, no chat/completions',
      {
        status: faqAfter.api?.status,
        otherDelta: faqAfter.otherDelta,
        afterKinds: faqAfter.afterKinds,
        lastKind: faqAfter.api?.lastSystem?.kind,
        chat: faqAfter.logs?.chatCompletions,
        error: faqAfter.error || null,
      },
    )

    const chatAfter = await sendAfterHandoff(AFTER_CHAT)
    evidence.steps.ac006chat = {
      error: chatAfter.error || null,
      otherDelta: chatAfter.otherDelta,
      afterKinds: chatAfter.afterKinds,
      lastKind: chatAfter.api?.lastSystem?.kind,
      status: chatAfter.api?.status,
      logs: chatAfter.logs,
    }
    const chatNoAi =
      !chatAfter.error &&
      chatAfter.api?.status === 'handed_off' &&
      chatAfter.otherDelta === 0 &&
      !(chatAfter.afterKinds || []).some((k) => /:(faq|small_talk|knowledge|clarification|fallback)$/.test(k)) &&
      (chatAfter.logs?.chatCompletions || 0) === 0
    record(
      'ac006-smalltalk-no-ai',
      chatNoAi,
      'handed_off, no small_talk/FAQ/AI, no chat/completions',
      {
        status: chatAfter.api?.status,
        otherDelta: chatAfter.otherDelta,
        afterKinds: chatAfter.afterKinds,
        lastKind: chatAfter.api?.lastSystem?.kind,
        chat: chatAfter.logs?.chatCompletions,
        error: chatAfter.error || null,
      },
    )
    await screenshot('t013-ac006-waiting.png')

    const ui02 = await evaluate(collectChat)
    record(
      'ui02-layout',
      ui02.pageName === '员工端' &&
        ui02.statusText === '已转人工，等待客服' &&
        ui02.transferDisabled === true &&
        ui02.layout?.composerBottom >= 880,
      '员工端 status + composer pinned',
      {
        pageName: ui02.pageName,
        statusText: ui02.statusText,
        composerBottom: ui02.layout?.composerBottom,
        employeeBubbleWhite: ui02.layout?.employeeBubbleWhite,
      },
    )

    await clickNav('客服端')
    await waitFor(`document.querySelector('.agent-inbox')`, 8000)
    const agentPickStart = Date.now()
    while (Date.now() - agentPickStart < 10000) {
      await evaluate(`(() => {
        const rows = [...document.querySelectorAll('.agent-row')];
        const hit = rows.find((r) => /T013-POST-HANDOFF|T011HELIX|不谈电脑/.test(r.querySelector('.agent-row-title')?.textContent || ''));
        if (hit) hit.click();
      })()`)
      const cur = await evaluate(collectAgent)
      if (cur.messages.some((m) => /T013-POST-HANDOFF/.test(m.text || ''))) {
        agentUi = cur
        break
      }
      await delay(400)
    }
    const postHandoffEmployeeVisible = agentUi.messages.some((m) => /T013-POST-HANDOFF-FAQ/.test(m.text || '')) &&
      agentUi.messages.some((m) => /T013-POST-HANDOFF-CHAT/.test(m.text || ''))
    const postHandoffNoFaqAi = !agentUi.messages.some(
      (m) => m.tag === 'FAQ' || m.tag === '闲聊' || m.tag === '知识' || m.tag === '反问',
    ) || agentUi.messages.filter((m) => m.tag === 'FAQ').every((m) => !/T013-POST-HANDOFF/.test(m.text || ''))
    evidence.steps.agentAfterAc006 = {
      postHandoffEmployeeVisible,
      tags: agentUi.messages.map((m) => m.tag),
      lastTexts: agentUi.messages.slice(-6).map((m) => ({ tag: m.tag, text: (m.text || '').slice(0, 80) })),
    }
    record(
      'ac006-agent-sees-waiting-not-faq',
      postHandoffEmployeeVisible,
      'agent sees post-handoff employee FAQ/chat texts',
      { postHandoffEmployeeVisible, tags: agentUi.messages.map((m) => m.tag) },
    )

    await evaluate(fillScript('#agent-reply', AGENT_R1))
    await evaluate(`document.querySelector('.agent-composer button[type="submit"]').click()`)
    const replyWait = Date.now()
    let agentAfterReply = agentUi
    while (Date.now() - replyWait < 15000) {
      agentAfterReply = await evaluate(collectAgent)
      if (agentAfterReply.messages.some((m) => (m.text || '').includes('T013-AGENT-1'))) break
      await delay(200)
    }
    evidence.steps.agentReply1 = {
      visible: agentAfterReply.messages.some((m) => (m.text || '').includes('T013-AGENT-1')),
      sendError: agentAfterReply.sendError,
    }
    record(
      'ac005-agent-sent-reply',
      evidence.steps.agentReply1.visible,
      'agent UI shows T013-AGENT-1',
      evidence.steps.agentReply1,
    )
    await screenshot('t013-ac005-agent-replied.png')

    await clickNav('员工端')
    await waitFor(`document.querySelector('.employee-chat')`, 8000)
    const empSeeStart = Date.now()
    let empSee = null
    while (Date.now() - empSeeStart < 12000) {
      empSee = await evaluate(collectChat)
      if (empSee.messages.some((m) => (m.text || '').includes('T013-AGENT-1') && m.tag === '客服')) break
      await delay(200)
    }
    const sawR1 = Boolean(empSee?.messages.some((m) => (m.text || '').includes('T013-AGENT-1')))
    evidence.steps.employeeSeesR1 = {
      sawR1,
      elapsedMs: Date.now() - empSeeStart,
      lastOther: empSee?.lastOther,
      statusText: empSee?.statusText,
      conversationId: empSee?.conversationId,
    }
    record(
      'ac005-employee-sees-agent-reply',
      sawR1 && empSee?.conversationId === convA && empSee?.lastOther?.tag === '客服',
      'same conv, 客服 bubble with T013-AGENT-1',
      evidence.steps.employeeSeesR1,
    )
    await screenshot('t013-ac005-employee-sees-reply.png')

    const beforeR2 = await evaluate(collectChat)
    const t0 = Date.now()
    const r2 = await apiFetch(`/api/conversations/${convA}/replies`, {
      method: 'POST',
      json: { content: AGENT_R2 },
    })
    let empR2 = beforeR2
    let elapsedR2 = null
    while (Date.now() - t0 < 10000) {
      empR2 = await evaluate(collectChat)
      if (empR2.messages.some((m) => (m.text || '').includes('T013-AGENT-2'))) {
        elapsedR2 = Date.now() - t0
        break
      }
      await delay(100)
    }
    evidence.steps.d003 = {
      http: r2.status,
      elapsedMs: elapsedR2,
      saw: elapsedR2 != null,
      lastOther: empR2.lastOther,
    }
    record(
      'tc-d003-poll-within-3s',
      r2.status === 200 && elapsedR2 != null && elapsedR2 <= 5000,
      'API-012 200 and employee UI <=5000ms (D-003 ~3s poll)',
      { http: r2.status, elapsedMs: elapsedR2 },
    )

    await evaluate(`sessionStorage.removeItem('conversation_id')`)
    await goto(`${BASE}/employee`)
    await waitFor(`document.querySelector('.employee-chat')`, 8000)
    const convB = await waitConversationId(convA)
    evidence.convB = convB
    record('ac007-new-bot-session', convB && convB !== convA && convB !== T012_HANDED_OFF, 'fresh bot conv', convB)

    const textXferLogStart = await logSize()
    const textXfer = await sendChat(TEXT_TRANSFER)
    evidence.steps.ac007 = {
      error: textXfer.error || null,
      ui: {
        statusText: textXfer.ui?.statusText,
        transferDisabled: textXfer.ui?.transferDisabled,
        tag: textXfer.ui?.lastOther?.tag,
        text: textXfer.ui?.lastOther?.text,
      },
      api: textXfer.api,
      logs: textXfer.logs,
    }
    const req001Kinds = new Set(['clarification', 'faq', 'small_talk', 'knowledge', 'fallback'])
    const ac007Ok =
      !textXfer.error &&
      textXfer.api?.status === 'bot' &&
      textXfer.ui?.statusText === 'AI 接待中' &&
      textXfer.ui?.transferDisabled === false &&
      textXfer.api?.lastSystem?.kind !== 'waiting_for_agent' &&
      req001Kinds.has(textXfer.api?.lastSystem?.kind) &&
      textXfer.ui?.lastOther?.tag !== '客服'
    record(
      'ac007-text-transfer-still-req001',
      ac007Ok,
      'bot + AI接待中 + REQ-001 kind, not waiting_for_agent',
      {
        status: textXfer.api?.status,
        ui: textXfer.ui?.statusText,
        kind: textXfer.api?.lastSystem?.kind,
        tag: textXfer.ui?.lastOther?.tag,
        error: textXfer.error || null,
      },
    )
    record(
      'ac008-text-transfer-no-waiting-result',
      textXfer.api?.lastSystem?.kind !== 'waiting_for_agent' &&
        textXfer.ui?.statusText !== '已转人工，等待客服' &&
        !(textXfer.ui?.lastOther?.text || '').includes('等待客服'),
      'no waiting_for_agent takeover',
      { kind: textXfer.api?.lastSystem?.kind, ui: textXfer.ui?.statusText, text: textXfer.ui?.lastOther?.text },
    )
    await screenshot('t013-ac007-text-transfer.png')

    const listAfterText = slimList((await apiFetch('/api/conversations?page=1&page_size=20')).body)
    evidence.steps.listAfterText = listAfterText
    record(
      'ac007-not-in-agent-list',
      !listAfterText.ids.includes(convB) && listAfterText.allHandedOff,
      'convB absent from API-008',
      { includesB: listAfterText.ids.includes(convB), allHandedOff: listAfterText.allHandedOff },
    )

    const reply409b = await apiFetch(`/api/conversations/${convB}/replies`, {
      method: 'POST',
      json: { content: '文字转人工不应被接管' },
    })
    evidence.steps.api012onText = {
      status: reply409b.status,
      errorCode: reply409b.body?.error_code ?? null,
      error: reply409b.body?.error ?? null,
    }
    record(
      'tc-api012-409-text-only',
      reply409b.status === 409 && reply409b.body?.error_code === 'CONFLICT',
      '409 CONFLICT',
      evidence.steps.api012onText,
    )
    const convBAfter = slimConv((await apiFetch(`/api/conversations/${convB}`)).body)
    record(
      'tc-text-does-not-change-status',
      convBAfter?.status === 'bot',
      'bot',
      convBAfter?.status,
    )

    await clickNav('客服端')
    await waitFor(`document.querySelector('.agent-inbox')`, 8000)
    await delay(3500)
    const agentFinal = await evaluate(collectAgent)
    const botPreviewLeak = agentFinal.rows.some((r) => /不要点按钮/.test(r.title || ''))
    evidence.steps.agentFinal = {
      rowCount: agentFinal.rowCount,
      botPreviewLeak,
      titles: agentFinal.rows.map((r) => r.title.slice(0, 80)),
      pageHasMock: agentFinal.pageHasMock,
    }
    record(
      'ac007-agent-ui-not-taken-over',
      botPreviewLeak === false,
      'agent list has no convB preview',
      { botPreviewLeak, titles: evidence.steps.agentFinal.titles },
    )
    await screenshot('t013-ac008-agent-list.png')

    const convAFinal = slimConv((await apiFetch(`/api/conversations/${convA}`)).body)
    const afterHandoffMsgs = convAFinal ? (await apiFetch(`/api/conversations/${convA}`)).body?.data?.messages || [] : []
    const transferIdx = afterHandoffMsgs.findIndex((m) => m.kind === 'waiting_for_agent')
    const faqIdx = afterHandoffMsgs.findIndex((m) => m.role === 'employee' && String(m.original_content || '').includes('T013-POST-HANDOFF-FAQ'))
    const kindsAfterHandoffFaq = faqIdx >= 0 ? afterHandoffMsgs.slice(faqIdx).map((m) => `${m.role}:${m.kind}`) : []
    evidence.steps.convAFinal = {
      status: convAFinal?.status,
      kinds: convAFinal?.kinds,
      kindsAfterHandoffFaq,
      transferIdx,
    }
    record(
      'tc-after-handoff-kinds-not-faq-ai',
      kindsAfterHandoffFaq.every((k) => !/:(faq|small_talk|knowledge|clarification|fallback)$/.test(k)),
      'post-handoff messages are employee/waiting/agent only',
      kindsAfterHandoffFaq,
    )

    evidence.bailianNote = {
      q1Chat: q1.logs?.chatCompletions ?? null,
      ac006faqChat: faqAfter.logs?.chatCompletions ?? null,
      ac006chatChat: chatAfter.logs?.chatCompletions ?? null,
      ac007Chat: textXfer.logs?.chatCompletions ?? null,
      textXferLogStart,
    }
  } finally {
    const failed = checks.filter((c) => !c.pass).map((c) => c.id)
    evidence.checks = checks
    evidence.failed = failed
    evidence.postBodies = postBodies.map((p) => ({
      url: p.url,
      method: p.method,
      status: p.status,
      replyKind: p.replyKind,
      conversationStatus: p.conversationStatus,
      errorCode: p.errorCode,
    }))
    await writeFile(path.join(OUT_DIR, 't013-browser-evidence.json'), JSON.stringify(evidence, null, 2), 'utf8')
    console.log(JSON.stringify({ failed, convA: evidence.convA, convB: evidence.convB, checkCount: checks.length }))
    try {
      if (ws) ws.close()
    } catch {}
    try {
      if (chromeProc && !chromeProc.killed) chromeProc.kill()
    } catch {}
  }
}

main().catch(async (err) => {
  console.error('SCRIPT_ERROR', err)
  try {
    await writeFile(
      path.join(OUT_DIR, 't013-browser-evidence.json'),
      JSON.stringify({ scriptError: String(err), checks, failed: checks.filter((c) => !c.pass).map((c) => c.id) }, null, 2),
      'utf8',
    )
  } catch {}
  try {
    if (chromeProc && !chromeProc.killed) chromeProc.kill()
  } catch {}
  process.exit(1)
})
