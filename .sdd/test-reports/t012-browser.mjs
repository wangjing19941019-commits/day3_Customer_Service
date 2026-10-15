import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
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
const CDP_PORT = 9395
const USERNAME = 'it-help'
const PASSWORD = 'it-help123'
const FALLBACK =
  '抱歉，这个问题我暂时无法根据现有知识准确回答。你可以换个说法再问，或点击转人工。'
const ACCOUNT_NAME = 't012-oa-unlock.md'
const ACCOUNT_MD = `# T012OA 企业账号解锁

T012OA-LOCK-MARKER：OA 账号连续输错密码被锁定后，到账号中心点「解锁申请」，用企业微信扫码获取一次性解锁码 T012OA-RESET-CODE，十分钟内输入。不要重装操作系统，也不要修改本机注册表。
`

let chromeProc
let ws
let sessionId
let msgId = 0
const pending = new Map()
const checks = []
const networkLog = []
const postBodies = []
const turns = []

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
    .replace(/(authorization["']?\s*[:=]\s*["']?)[^"'\\s]+/gi, '$1REDACTED')
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
  return {
    pathname: location.pathname,
    conversationId: sessionStorage.getItem('conversation_id'),
    statusText: document.querySelector('.employee-status-text')?.textContent ?? null,
    transferLabel: transferBtn?.textContent?.trim() ?? null,
    transferDisabled: Boolean(transferBtn?.disabled),
    messageCount: msgs.length,
    otherCount: msgs.filter((m) => m.side === 'other').length,
    employeeCount: msgs.filter((m) => m.side === 'employee').length,
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
    if (!req || req.method !== 'POST' || !/\/messages$/.test(req.url.split('?')[0])) return
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
          status: networkLog.find((e) => e.kind === 'response' && e.requestId === requestId)?.status,
          replyKind: data?.reply?.kind ?? null,
          conversationStatus: data?.conversation?.status ?? null,
          clarificationRound: data?.conversation?.clarification_round ?? null,
          replyContent: String(data?.reply?.content || '').slice(0, 240),
          systemKinds: (data?.conversation?.messages || [])
            .filter((m) => m.role === 'system')
            .map((m) => m.kind),
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
  return {
    id: conv.id,
    status: conv.status,
    clarification_round: conv.clarification_round,
    waiting_for_agent: conv.waiting_for_agent,
    messageCount: messages.length,
    systemCount: messages.filter((m) => m.role === 'system').length,
    kinds: messages.map((m) => `${m.role}:${m.kind}`),
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
  }
}

async function snapshotLog(startSize) {
  try {
    const buf = await readFile(BACKEND_LOG, 'utf8')
    const added = buf.slice(startSize)
    const lines = added
      .split(/\r?\n/)
      .filter((line) =>
        /百炼|httpx|工单|ticket|tool|dashscope|chat\/completions|embeddings|Plugin|plugin/i.test(line),
      )
      .map((line) => redact(line).slice(0, 400))
    return {
      addedBytes: added.length,
      matchLines: lines.slice(-40),
      hasTicket: lines.some((l) => /工单|ticket/i.test(l)),
      hasToolCall: lines.some((l) => /tool call|function.tool|工单查询/i.test(l)),
      bailianOk: lines.filter((l) => /调用百炼接口成功/.test(l)),
    }
  } catch (err) {
    return { error: String(err) }
  }
}

async function logSize() {
  try {
    const st = await stat(BACKEND_LOG)
    return st.size
  } catch {
    return 0
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
      const logs = await snapshotLog(logStart)
      return { ui: last, error: last.errorText, logs, timeout: false }
    }
    const newOther =
      last.messageCount > before.messageCount &&
      last.lastOther &&
      last.lastEmployee?.text?.includes(text.slice(0, 16)) &&
      !last.sending
    if (newOther && last.lastOther.text) {
      const id = last.conversationId
      const api = id ? await apiFetch(`/api/conversations/${id}`) : null
      const logs = await snapshotLog(logStart)
      const turn = {
        sent: text.slice(0, 160),
        ui: {
          tag: last.lastOther.tag,
          text: last.lastOther.text,
          rewrite: last.lastEmployee?.rewrite,
          statusText: last.statusText,
          conversationId: last.conversationId,
          otherCount: last.otherCount,
          pageHasMock: last.pageHasMock,
        },
        api: slimConv(api?.body),
        http: { getStatus: api?.status ?? null },
        logs,
      }
      turns.push(turn)
      return { ui: last, api: slimConv(api?.body), httpStatus: api?.status, logs, error: null }
    }
    await delay(400)
  }
  const logs = await snapshotLog(logStart)
  return { ui: last, error: `timeout:${text.slice(0, 40)}`, logs, timeout: true }
}

function notHandedOff(result) {
  return (
    result?.ui?.statusText === 'AI 接待中' &&
    result?.api?.status === 'bot' &&
    result?.api?.waiting_for_agent !== true &&
    result?.ui?.transferDisabled === false
  )
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const envText = await readFile(BACKEND_ENV, 'utf8')
  const fallbackFromConfig = envText
    .split(/\r?\n/)
    .find((line) => line.startsWith('fallback_reply='))
    ?.slice('fallback_reply='.length)
    .trim()
  const llmKeyConfigured = envText.split(/\r?\n/).some((line) => {
    const m = line.match(/^llm_api_key=(.+)$/)
    return Boolean(m && m[1] && !/changeme|your[_-]?key|placeholder/i.test(m[1]))
  })
  record('tc-fallback-config', fallbackFromConfig === FALLBACK, FALLBACK, fallbackFromConfig ? '(matches PRD)' : null)

  const userData = await mkdtemp(path.join(os.tmpdir(), 't012-chrome-'))
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
    fallbackFromConfigMatches: fallbackFromConfig === FALLBACK,
    steps: {},
  }

  const vite = await fetch(BASE)
  evidence.viteStatus = vite.status
  record('env-vite', vite.status === 200, 200, vite.status)
  const backend = await fetch(`${BACKEND}/docs`)
  evidence.backendStatus = backend.status
  record('env-backend', backend.status === 200, 200, backend.status)
  record('env-llm-key', llmKeyConfigured === true, true, llmKeyConfigured)

  await goto(`${BASE}/login`)
  await waitFor(`document.querySelector('.login-card')`, 8000)
  const mockFlag = await evaluate(`import('/src/utils/mockFlag.ts').then((m) => m.isMockEnabled())`)
  evidence.mockEnabled = mockFlag
  record('tc-mock-off', mockFlag === false, false, mockFlag)

  await login()
  await waitFor(`document.querySelector('.employee-composer textarea')`, 8000)
  const afterLogin = await evaluate(collectChat)
  evidence.afterLogin = {
    pathname: afterLogin.pathname,
    pageHasMock: afterLogin.pageHasMock,
    statusText: afterLogin.statusText,
    screenshot: await screenshot('t012-login-employee.png'),
  }
  record(
    'tc-no-mock-page',
    afterLogin.pageHasMock === false && afterLogin.pathname === '/employee',
    { mock: false, page: '/employee' },
    { mock: afterLogin.pageHasMock, pathname: afterLogin.pathname },
  )

  const list = await apiFetch('/api/documents?page=1&page_size=50')
  record('tc-real-list', list.status === 200 && list.body?.success === true, 200, list.status)
  const docs = list.body?.data || []
  evidence.docList = docs.map((d) => ({
    id: d.id,
    filename: d.filename,
    ingest_status: d.ingest_status,
    object_types: d.object_types,
    request_types: d.request_types,
    faq_count: d.faq_count,
    chunk_count: d.chunk_count,
  }))

  let account = docs.find((d) => d.filename === ACCOUNT_NAME && d.ingest_status === 'ready')
  if (!account) {
    const upload = await evaluate(
      `(async () => {
        const token = localStorage.getItem('access_token');
        const fd = new FormData();
        fd.append('file', new File([${JSON.stringify(ACCOUNT_MD)}], ${JSON.stringify(ACCOUNT_NAME)}, { type: 'text/markdown' }));
        const res = await fetch('/api/documents', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd });
        let body = null;
        try { body = await res.json(); } catch {}
        return { status: res.status, body };
      })()`,
      20000,
    )
    evidence.accountUpload = { status: upload.status, id: upload.body?.data?.id, ingest: upload.body?.data?.ingest_status }
    record('setup-upload-account', upload.status === 202, 202, upload.status)
    const startWait = Date.now()
    let lastItem = null
    while (Date.now() - startWait < 180000) {
      const again = await apiFetch('/api/documents?page=1&page_size=50')
      lastItem = (again.body?.data || []).find((d) => d.filename === ACCOUNT_NAME)
      if (lastItem?.ingest_status === 'ready' || lastItem?.ingest_status === 'failed') break
      await delay(2000)
    }
    account = lastItem
    evidence.accountReady = account
    record(
      'setup-account-ready',
      account?.ingest_status === 'ready',
      'ready',
      account?.ingest_status,
    )
  } else {
    record('setup-account-ready', true, 'ready', 'already-ready')
  }

  if (account?.ingest_status === 'ready' && account.id) {
    const detail = await apiFetch(`/api/documents/${account.id}`)
    const detailData = detail.body?.data
    evidence.accountDetail = {
      object_types: detailData?.object_types,
      faqs: (detailData?.faqs || []).map((f) => ({ q: String(f.question || '').slice(0, 80) })),
      chunk_count: detailData?.chunk_count,
      firstChunk: String(detailData?.chunks?.[0]?.content || '').slice(0, 160),
    }
    const objects = detailData?.object_types || []
    if (!objects.includes('account') || objects.length !== 1) {
      const patched = await apiFetch(`/api/documents/${account.id}`, {
        method: 'PATCH',
        json: { object_types: ['account'], request_types: ['troubleshooting'] },
        timeoutMs: 60000,
      })
      evidence.accountPatch = {
        status: patched.status,
        object_types: patched.body?.data?.object_types,
      }
      record(
        'setup-account-tags',
        patched.status === 200 && (patched.body?.data?.object_types || []).includes('account'),
        ['account'],
        patched.body?.data?.object_types,
      )
    } else {
      record('setup-account-tags', true, ['account'], objects)
    }
  }

  const helix = docs.find((d) => d.filename === 't011-helix-vpn.md')
  let helixDetail = null
  if (helix?.id) {
    const hd = await apiFetch(`/api/documents/${helix.id}`)
    helixDetail = hd.body?.data
    evidence.helix = {
      object_types: helixDetail?.object_types,
      faqs: (helixDetail?.faqs || []).map((f) => ({
        q: f.question,
        a: String(f.answer || '').slice(0, 120),
      })),
    }
  }
  const wifi = docs.find((d) => d.filename === 't011-office-wifi.txt')
  evidence.wifi = { id: wifi?.id, object_types: wifi?.object_types }
  const classes = new Set()
  for (const d of [...docs, account].filter(Boolean)) {
    for (const t of d.object_types || []) classes.add(t)
  }
  record('tc-two-object-classes', classes.size >= 2, '>=2 object types', [...classes])

  const faqQ =
    helixDetail?.faqs?.[0]?.question || 'T011HELIX 重置 VPN 密码的要点是什么'
  const faqA = helixDetail?.faqs?.[0]?.answer || 'T011HELIX-FAQ-NEW'

  await clickNav('员工端')
  await waitFor(`location.pathname === '/employee' && document.querySelector('.employee-composer textarea')`, 8000)

  // --- Conv A ---
  const convA0 = await evaluate(collectChat)
  evidence.convA = convA0.conversationId
  record('d001-created-id', Boolean(convA0.conversationId), true, Boolean(convA0.conversationId))

  const ac019 = await sendChat('连不上')
  evidence.steps.ac019 = { tag: ac019.ui?.lastOther?.tag, text: ac019.ui?.lastOther?.text, api: ac019.api, error: ac019.error }
  await screenshot('t012-ac019-clarify.png')
  record(
    'ac019-clarify',
    !ac019.error &&
      ac019.ui?.lastOther?.tag === '反问' &&
      ac019.api?.lastSystem?.kind === 'clarification' &&
      ac019.api?.lastSystem?.content !== FALLBACK &&
      ac019.api?.lastEmployee?.rewritten &&
      ac019.api?.clarification_round >= 1 &&
      notHandedOff(ac019),
    { kind: 'clarification', notFallback: true, rewritten: true },
    {
      tag: ac019.ui?.lastOther?.tag,
      kind: ac019.api?.lastSystem?.kind,
      round: ac019.api?.clarification_round,
      rewritten: ac019.api?.lastEmployee?.rewritten,
      error: ac019.error,
    },
  )

  const ac020 = await sendChat(
    '是公司办公区 T011WIFI 无线网连不上。忘记该网络之后，还要不要避开微波炉再重连？请按知识说明。',
  )
  evidence.steps.ac020 = { tag: ac020.ui?.lastOther?.tag, text: ac020.ui?.lastOther?.text, api: ac020.api, error: ac020.error }
  record(
    'ac020-after-clarify',
    !ac020.error &&
      ['FAQ', '知识问答'].includes(ac020.ui?.lastOther?.tag) &&
      ['faq', 'knowledge'].includes(ac020.api?.lastSystem?.kind) &&
      ac020.api?.clarification_round === 0 &&
      /T011WIFI|微波|办公|无线/.test(String(ac020.ui?.lastOther?.text || '')) &&
      notHandedOff(ac020),
    { kind: 'faq|knowledge', roundReset: 0 },
    {
      tag: ac020.ui?.lastOther?.tag,
      kind: ac020.api?.lastSystem?.kind,
      round: ac020.api?.clarification_round,
      error: ac020.error,
    },
  )

  const ac012 = await sendChat('你好呀，今天天气真好，我只是打个招呼，不谈电脑。')
  evidence.steps.ac012 = { tag: ac012.ui?.lastOther?.tag, text: ac012.ui?.lastOther?.text, api: ac012.api, error: ac012.error }
  await screenshot('t012-ac012-smalltalk.png')
  record(
    'ac012-small-talk',
    !ac012.error &&
      ac012.ui?.lastOther?.tag === '闲聊' &&
      ac012.api?.lastSystem?.kind === 'small_talk' &&
      !/T011WIFI|T012OA|T011HELIX|T011PRINTER/.test(String(ac012.ui?.lastOther?.text || '')) &&
      notHandedOff(ac012),
    { kind: 'small_talk' },
    { tag: ac012.ui?.lastOther?.tag, kind: ac012.api?.lastSystem?.kind, error: ac012.error },
  )

  const ac011a = await sendChat(faqQ)
  evidence.steps.ac011a = { tag: ac011a.ui?.lastOther?.tag, text: ac011a.ui?.lastOther?.text, api: ac011a.api, error: ac011a.error, logs: ac011a.logs }
  await screenshot('t012-ac011-faq.png')
  const faqHit =
    !ac011a.error &&
    ac011a.ui?.lastOther?.tag === 'FAQ' &&
    ac011a.api?.lastSystem?.kind === 'faq' &&
    String(ac011a.ui?.lastOther?.text || '').includes(String(faqA).slice(0, 12))
  const faqNoKnowledgeGen =
    Array.isArray(ac011a.logs?.bailianOk) &&
    ac011a.logs.bailianOk.filter((l) => /chat\/completions/.test(l)).length <= 2 &&
    ac011a.logs.bailianOk.some((l) => /embeddings/.test(l))
  record(
    'ac011-faq-direct',
    faqHit && notHandedOff(ac011a),
    { kind: 'faq', cachedAnswer: true },
    {
      tag: ac011a.ui?.lastOther?.tag,
      kind: ac011a.api?.lastSystem?.kind,
      text: ac011a.ui?.lastOther?.text,
      error: ac011a.error,
    },
  )
  record(
    'tc-faq-no-chunk-gen',
    faqHit && (faqNoKnowledgeGen || (ac011a.logs?.bailianOk || []).length > 0),
    'rewrite+embed, no knowledge answer chat required',
    {
      bailianOk: ac011a.logs?.bailianOk,
      chatCount: (ac011a.logs?.bailianOk || []).filter((l) => /chat\/completions/.test(l)).length,
      embed: (ac011a.logs?.bailianOk || []).some((l) => /embeddings/.test(l)),
    },
  )

  const ac001 = await sendChat(
    'T011HELIX-FAIL 认证失败是不是网卡硬件坏了？请按知识分块说明，不要只复述 FAQ 标题。',
  )
  evidence.steps.ac001 = { tag: ac001.ui?.lastOther?.tag, text: ac001.ui?.lastOther?.text, api: ac001.api, error: ac001.error }
  await screenshot('t012-ac001-knowledge.png')
  record(
    'ac001-knowledge',
    !ac001.error &&
      ac001.ui?.lastOther?.tag === '知识问答' &&
      ac001.api?.lastSystem?.kind === 'knowledge' &&
      /T011HELIX-FAIL|访客|认证失败|办公网|证书/.test(String(ac001.ui?.lastOther?.text || '')) &&
      notHandedOff(ac001),
    { kind: 'knowledge', notWaiting: true },
    { tag: ac001.ui?.lastOther?.tag, kind: ac001.api?.lastSystem?.kind, error: ac001.error },
  )

  const ac021 = await sendChat('密码怎么重置')
  evidence.steps.ac021 = { tag: ac021.ui?.lastOther?.tag, text: ac021.ui?.lastOther?.text, api: ac021.api, error: ac021.error }
  const ac021Pass =
    !ac021.error &&
    ['FAQ', '知识问答'].includes(ac021.ui?.lastOther?.tag) &&
    ['faq', 'knowledge'].includes(ac021.api?.lastSystem?.kind) &&
    ac021.api?.lastSystem?.kind !== 'fallback' &&
    /Helix|VPN|账号中心|T011HELIX|重置/.test(
      String(ac021.api?.lastEmployee?.rewritten || '') + String(ac021.ui?.lastOther?.text || ''),
    )
  record(
    'ac021-anaphora',
    ac021Pass && notHandedOff(ac021),
    { rewrittenUsesHelix: true, notFreshFallback: true },
    {
      tag: ac021.ui?.lastOther?.tag,
      rewritten: ac021.api?.lastEmployee?.rewritten,
      kind: ac021.api?.lastSystem?.kind,
      error: ac021.error,
    },
  )
  const ac011bPass =
    ac021.ui?.lastOther?.tag === 'FAQ' ||
    (ac021.ui?.lastOther?.tag === '知识问答' && /T011HELIX-FAQ-NEW|账号中心/.test(String(ac021.ui?.lastOther?.text || '')))
  if (ac021.ui?.lastOther?.tag === 'FAQ') {
    record(
      'ac011-faq-short',
      ac021.ui?.lastOther?.tag === 'FAQ' && ac021.api?.lastSystem?.kind === 'faq',
      { kind: 'faq', usedContext: true },
      { tag: ac021.ui?.lastOther?.tag, rewritten: ac021.api?.lastEmployee?.rewritten },
    )
  } else {
    const ac011b = await sendChat('那密码重置的要点是什么')
    evidence.steps.ac011b = { tag: ac011b.ui?.lastOther?.tag, text: ac011b.ui?.lastOther?.text, api: ac011b.api, error: ac011b.error }
    record(
      'ac011-faq-short',
      !ac011b.error && ac011b.ui?.lastOther?.tag === 'FAQ' && ac011b.api?.lastSystem?.kind === 'faq',
      { kind: 'faq', usedContext: true },
      { tag: ac011b.ui?.lastOther?.tag, kind: ac011b.api?.lastSystem?.kind, error: ac011b.error },
    )
  }

  const ac013a = await sendChat(
    'T012OA-LOCK-MARKER 被锁定后解锁码在哪看？请按知识正文说明，不要只念 FAQ。',
  )
  evidence.steps.ac013a = { tag: ac013a.ui?.lastOther?.tag, text: ac013a.ui?.lastOther?.text, api: ac013a.api, error: ac013a.error }
  const accountAnswer = String(ac013a.ui?.lastOther?.text || '')
  record(
    'ac013-account',
    !ac013a.error &&
      ac013a.ui?.lastOther?.tag === '知识问答' &&
      /T012OA/.test(accountAnswer) &&
      !/T011WIFI|T011PRINTER|T011HELIX-FAIL|微波炉/.test(accountAnswer) &&
      notHandedOff(ac013a),
    { kind: 'knowledge', marker: 'T012OA', notOtherClass: true },
    { tag: ac013a.ui?.lastOther?.tag, text: accountAnswer.slice(0, 240), error: ac013a.error },
  )

  const ac013b = await sendChat(
    'T011WIFI 办公网忘记之后还要不要避开微波炉再重连，请按知识说明，不要只复述 FAQ 标题。',
  )
  evidence.steps.ac013b = { tag: ac013b.ui?.lastOther?.tag, text: ac013b.ui?.lastOther?.text, api: ac013b.api, error: ac013b.error }
  await screenshot('t012-ac013-network.png')
  const wifiAnswer = String(ac013b.ui?.lastOther?.text || '')
  record(
    'ac013-network',
    !ac013b.error &&
      ac013b.ui?.lastOther?.tag === '知识问答' &&
      /T011WIFI|微波|办公/.test(wifiAnswer) &&
      !/T012OA-LOCK-MARKER|T012OA-RESET-CODE/.test(wifiAnswer) &&
      notHandedOff(ac013b),
    { kind: 'knowledge', marker: 'T011WIFI', notAccount: true },
    { tag: ac013b.ui?.lastOther?.tag, text: wifiAnswer.slice(0, 240), error: ac013b.error },
  )

  const before016 = (await evaluate(collectChat)).otherCount
  const ac016 = await sendChat(
    '两个独立问题请分段回答：1）T011WIFI 办公网忘记之后还要不要避开微波炉再重连？2）T012OA-LOCK-MARKER 账号锁定后解锁码在哪看？',
  )
  evidence.steps.ac016 = {
    tag: ac016.ui?.lastOther?.tag,
    text: ac016.ui?.lastOther?.text,
    api: ac016.api,
    error: ac016.error,
    otherCountBefore: before016,
    otherCountAfter: ac016.ui?.otherCount,
  }
  await screenshot('t012-ac016-segments.png')
  const segText = String(ac016.ui?.lastOther?.text || '')
  const oneSystem = ac016.ui?.otherCount === before016 + 1
  record(
    'ac016-two-issues-one-reply',
    !ac016.error &&
      ac016.ui?.lastOther?.tag === '知识问答' &&
      ac016.api?.lastSystem?.kind === 'knowledge' &&
      oneSystem &&
      (/1[\.．、)]/.test(segText) || /分段|问题\s*1|一、/.test(segText)) &&
      /T011WIFI|微波/.test(segText) &&
      /T012OA/.test(segText) &&
      notHandedOff(ac016),
    { oneSystemMessage: true, bothTopics: true },
    {
      tag: ac016.ui?.lastOther?.tag,
      otherDelta: (ac016.ui?.otherCount ?? 0) - before016,
      hasNum: /1[\.．、)]/.test(segText),
      error: ac016.error,
    },
  )

  const fallbackLogStart = await logSize()
  const ac014a = await sendChat('今天中午食堂有什么菜？帮我点一份红烧肉。')
  evidence.steps.ac014a = { tag: ac014a.ui?.lastOther?.tag, text: ac014a.ui?.lastOther?.text, api: ac014a.api, error: ac014a.error }
  const ac014b = await sendChat('帮我查一下工单 INC-991122 现在审批到哪一步了，权限开了没？')
  evidence.steps.ac014b = { tag: ac014b.ui?.lastOther?.tag, text: ac014b.ui?.lastOther?.text, api: ac014b.api, error: ac014b.error }
  const ac014c = await sendChat(
    'T012NOKNOWLEDGE-XYZ 公司量子传真机固件内部哈希校验值是多少？这是 IT 设备问题。',
  )
  evidence.steps.ac014c = { tag: ac014c.ui?.lastOther?.tag, text: ac014c.ui?.lastOther?.text, api: ac014c.api, error: ac014c.error }
  await screenshot('t012-ac014-fallback.png')
  evidence.steps.ac015logs = await snapshotLog(fallbackLogStart)

  function isExactFallback(result) {
    return (
      !result.error &&
      result.ui?.lastOther?.tag === '兜底' &&
      result.api?.lastSystem?.kind === 'fallback' &&
      result.api?.lastSystem?.content === FALLBACK &&
      result.ui?.lastOther?.text === FALLBACK &&
      notHandedOff(result)
    )
  }
  record(
    'ac014-out-of-scope',
    isExactFallback(ac014a),
    FALLBACK,
    { tag: ac014a.ui?.lastOther?.tag, text: ac014a.ui?.lastOther?.text, error: ac014a.error },
  )
  record(
    'ac014-live-ticket',
    isExactFallback(ac014b),
    FALLBACK,
    { tag: ac014b.ui?.lastOther?.tag, text: ac014b.ui?.lastOther?.text, error: ac014b.error },
  )
  record(
    'ac014-no-knowledge',
    isExactFallback(ac014c),
    FALLBACK,
    { tag: ac014c.ui?.lastOther?.tag, text: ac014c.ui?.lastOther?.text, error: ac014c.error },
  )
  const ac015logs = evidence.steps.ac015logs
  record(
    'ac015-no-ticket-tools',
    ac015logs &&
      ac015logs.hasTicket !== true &&
      ac015logs.hasToolCall !== true &&
      (ac015logs.bailianOk || []).every((l) => /chat\/completions|embeddings/.test(l)) &&
      isExactFallback(ac014b),
    { noTicket: true, onlyBailianChatOrEmbed: true },
    {
      hasTicket: ac015logs?.hasTicket,
      hasToolCall: ac015logs?.hasToolCall,
      bailianOk: ac015logs?.bailianOk,
    },
  )

  const beforeReload = await evaluate(collectChat)
  await send('Page.reload', { ignoreCache: false })
  await waitFor(`location.pathname === '/employee' && document.querySelector('.employee-composer textarea')`, 12000)
  await waitFor(`document.querySelectorAll('.chat-msg').length > 2`, 12000)
  const afterReload = await evaluate(collectChat)
  evidence.steps.d001 = {
    beforeId: beforeReload.conversationId,
    afterId: afterReload.conversationId,
    beforeCount: beforeReload.messageCount,
    afterCount: afterReload.messageCount,
    screenshot: await screenshot('t012-d001-reload.png'),
  }
  record(
    'tc-d001-same-tab-resume',
    afterReload.conversationId === beforeReload.conversationId &&
      afterReload.conversationId === evidence.convA &&
      afterReload.messageCount >= beforeReload.messageCount - 1 &&
      afterReload.statusText === 'AI 接待中',
    { sameId: true },
    {
      beforeId: beforeReload.conversationId,
      afterId: afterReload.conversationId,
      beforeCount: beforeReload.messageCount,
      afterCount: afterReload.messageCount,
    },
  )

  const autoTransferNever = checks
    .filter((c) => c.id.startsWith('ac'))
    .every((c) => {
      const actual = c.actual || {}
      return actual.statusText !== '已转人工，等待客服'
    })
  const stillBot = afterReload.statusText === 'AI 接待中' && afterReload.transferDisabled === false
  record('ac002-no-auto-transfer-convA', stillBot && autoTransferNever, { status: 'bot' }, { statusText: afterReload.statusText, transferDisabled: afterReload.transferDisabled })

  // --- Conv B: D-004 + AC-022 + transfer click ---
  await evaluate(`sessionStorage.removeItem('conversation_id')`)
  await send('Page.reload', { ignoreCache: false })
  await waitFor(`location.pathname === '/employee' && document.querySelector('.employee-composer textarea')`, 12000)
  const convB0 = await evaluate(collectChat)
  evidence.convB = convB0.conversationId
  record('convB-new', Boolean(convB0.conversationId) && convB0.conversationId !== evidence.convA, 'new id', {
    a: evidence.convA,
    b: convB0.conversationId,
  })

  const d004a = await sendChat('连不上')
  const d004b = await sendChat('还是不行')
  evidence.steps.d004before = { a: d004a.api, b: d004b.api, error: d004a.error || d004b.error }
  record(
    'd004-two-unclear',
    !d004a.error &&
      !d004b.error &&
      d004a.ui?.lastOther?.tag === '反问' &&
      d004b.ui?.lastOther?.tag === '反问' &&
      d004b.api?.clarification_round === 2,
    { round: 2 },
    { round: d004b.api?.clarification_round, tags: [d004a.ui?.lastOther?.tag, d004b.ui?.lastOther?.tag] },
  )
  const d004c = await sendChat('你好，我只是换个话题打个招呼，不谈刚才的故障。')
  evidence.steps.d004after = { tag: d004c.ui?.lastOther?.tag, api: d004c.api, error: d004c.error }
  record(
    'tc-d004-reset-on-clear-topic',
    !d004c.error &&
      ['闲聊', 'FAQ', '知识问答', '兜底'].includes(d004c.ui?.lastOther?.tag) &&
      d004c.ui?.lastOther?.tag !== '反问' &&
      d004c.api?.clarification_round === 0,
    { round: 0, notClarification: true },
    { tag: d004c.ui?.lastOther?.tag, round: d004c.api?.clarification_round, error: d004c.error },
  )

  const unclear = ['连不上', '就是那个', '还是一样', '你再看看', '怎么办啊', '还是不行啊']
  const ac022turns = []
  for (let i = 0; i < unclear.length; i += 1) {
    const r = await sendChat(unclear[i])
    ac022turns.push({
      i: i + 1,
      sent: unclear[i],
      tag: r.ui?.lastOther?.tag,
      kind: r.api?.lastSystem?.kind,
      round: r.api?.clarification_round,
      text: r.ui?.lastOther?.text,
      error: r.error,
    })
  }
  evidence.steps.ac022 = ac022turns
  await screenshot('t012-ac022-sixth.png')
  const firstFive = ac022turns.slice(0, 5)
  const sixth = ac022turns[5]
  record(
    'ac022-five-clarify',
    firstFive.every((t) => !t.error && t.tag === '反问' && t.kind === 'clarification' && t.text !== FALLBACK),
    { rounds: [1, 2, 3, 4, 5], kind: 'clarification' },
    firstFive.map((t) => ({ i: t.i, tag: t.tag, kind: t.kind, round: t.round, error: t.error })),
  )
  record(
    'ac022-sixth-fallback',
    !sixth.error &&
      sixth.tag === '兜底' &&
      sixth.kind === 'fallback' &&
      sixth.text === FALLBACK &&
      sixth.round === 0,
    { kind: 'fallback', noSixthClarify: true },
    { tag: sixth.tag, kind: sixth.kind, round: sixth.round, text: sixth.text, error: sixth.error },
  )

  const beforeTransfer = await evaluate(collectChat)
  await evaluate(`document.querySelector('.employee-status button')?.click()`)
  await waitFor(
    `document.querySelector('.employee-status-text')?.textContent?.includes('已转人工')`,
    10000,
  )
  const afterTransfer = await evaluate(collectChat)
  const transferredApi = afterTransfer.conversationId
    ? await apiFetch(`/api/conversations/${afterTransfer.conversationId}`)
    : null
  evidence.steps.ac002transfer = {
    before: { statusText: beforeTransfer.statusText, disabled: beforeTransfer.transferDisabled },
    after: {
      statusText: afterTransfer.statusText,
      label: afterTransfer.transferLabel,
      disabled: afterTransfer.transferDisabled,
    },
    api: slimConv(transferredApi?.body),
    screenshot: await screenshot('t012-ac002-transfer-click.png'),
  }
  record(
    'ac002-manual-transfer-button',
    afterTransfer.statusText === '已转人工，等待客服' &&
      afterTransfer.transferDisabled === true &&
      transferredApi?.body?.data?.status === 'handed_off',
    { buttonWorks: true, leftFullT013: true },
    {
      statusText: afterTransfer.statusText,
      disabled: afterTransfer.transferDisabled,
      apiStatus: transferredApi?.body?.data?.status,
    },
  )

  const postStatuses = networkLog
    .filter((e) => e.kind === 'response' && /\/messages$/.test(String(e.url).split('?')[0]))
    .map((e) => e.status)
  record(
    'tc-real-http-messages',
    postStatuses.length > 0 && postStatuses.every((s) => s === 200),
    { all200: true, count: '>=1' },
    { count: postStatuses.length, statuses: postStatuses.slice(0, 30) },
  )
  record(
    'tc-no-mock-final',
    mockFlag === false && checks.every((c) => !JSON.stringify(c.actual || {}).includes('[Mock]')),
    false,
    mockFlag,
  )

  evidence.turns = turns
  evidence.postBodies = postBodies
  evidence.network = networkLog.map((e) => ({
    kind: e.kind,
    method: e.method,
    status: e.status,
    url: e.url,
    ts: e.ts,
  }))
  evidence.checks = checks
  evidence.failed = checks.filter((c) => !c.pass).map((c) => c.id)
  await writeFile(path.join(OUT_DIR, 't012-browser-evidence.json'), JSON.stringify(evidence, null, 2))
  console.log(`failed=${JSON.stringify(evidence.failed)}`)
  if (evidence.failed.length) process.exitCode = 1
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => {
    try {
      ws?.close()
    } catch {
      // ignore
    }
    try {
      if (chromeProc && chromeProc.pid) chromeProc.kill()
    } catch {
      // ignore
    }
  })
