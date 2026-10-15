import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..', '..')
const BASE = 'http://127.0.0.1:5220'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT_DIR = HERE
const CDP_PORT = 9580
const USER_FILE = 't045-user-visible.md'
const AGENT_FILE = 't045-agent-only.md'
const RISK_FILE = 't045-high-risk.md'
const AGENT_TOKEN = 'T045_AGENT_INTERNAL_STEP_NEVER_TO_USER'
const USER_TOKEN = 'T045_USER_VISIBLE_SEVEN_DAY_RETURN'
const RISK_TOKEN = 'T045_HIGH_RISK_COMPENSATION_TOKEN'
const FROM_VALUE = '2026-07-03T09:15'
const TO_VALUE = '2026-11-28T18:40'
const RESTORE_FROM = '2026-09-01T00:00'
const RESTORE_TO = '2027-03-22T23:59'
const USER_SCRIPT = '未拆封的手机支持七天无理由退货'
const HOLD_MS = 10000

let chromeProc
let ws
let sessionId
let msgId = 0
const pending = new Map()
const checks = []
const apiHits = []

function record(id, pass, expected, actual) {
  checks.push({ id, pass: Boolean(pass), expected, actual })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id}`)
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
    {
      expression,
      returnByValue: true,
      awaitPromise: true,
    },
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

async function waitFor(expression, timeoutMs = 15000) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeoutMs) {
    last = await evaluate(`Boolean(${expression})`)
    if (last) return last
    await delay(150)
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
    return el.value;
  })()`
}

function clickTextScript(selector, text) {
  return `(() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const el = nodes.find((n) => (n.textContent || '').includes(${JSON.stringify(text)}));
    if (!el) throw new Error('missing click target ' + ${JSON.stringify(text)});
    el.click();
    return true;
  })()`
}

async function readSharedPassword() {
  const text = await readFile(path.join(ROOT, 'backend', '.env'), 'utf8')
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('shared_password=')) return line.slice('shared_password='.length)
  }
  throw new Error('shared_password missing')
}

async function collectPage() {
  return evaluate(`(async () => ({
    pathname: location.pathname,
    topbarUser: document.querySelector('.session .user')?.textContent ?? null,
    nav: [...document.querySelectorAll('.sidebar a')].map((a) => a.textContent.trim()),
    pageHasMock: (document.body.innerText || '').includes('[Mock]'),
    mockEnabled: await import('/src/utils/mockFlag.ts').then((m) => m.isMockEnabled()),
    saveMessage: document.querySelector('.kb-detail .hint')?.textContent?.trim() ?? null,
    fromValue: document.querySelector('input[aria-label="生效开始时间"]')?.value ?? null,
    toValue: document.querySelector('input[aria-label="生效结束时间"]')?.value ?? null,
    visibility: document.querySelector('input[name="kb-visibility"]:checked')?.value ?? null,
    visibilityLabel: document.querySelector('.kb-visibility')?.innerText ?? null,
    selectedRow: document.querySelector('.kb-row.selected .kb-row-title')?.textContent?.trim() ?? null,
    chunkCount: document.querySelectorAll('.kb-chunk').length,
    chunkText: [...document.querySelectorAll('.kb-chunk-body')].map((n) => n.textContent).join('\\n').slice(0, 400),
    knowledgeCards: [...document.querySelectorAll('.knowledge-card')].map((n) => n.innerText).join('\\n---\\n').slice(0, 1200),
    lastOther: [...document.querySelectorAll('.chat-msg.other .chat-bubble')].map((n) => n.textContent).slice(-1)[0] || '',
    lastKind: [...document.querySelectorAll('.chat-msg.other .chat-msg-tag')].map((n) => n.textContent).slice(-1)[0] || '',
  }))()`)
}

async function collectKnowledge() {
  return evaluate(`(async () => {
    const cards = [...document.querySelectorAll('.knowledge-card')];
    const panel = document.querySelector('.work-block')?.innerText || '';
    return {
      mockEnabled: await import('/src/utils/mockFlag.ts').then((m) => m.isMockEnabled()),
      pageHasMock: (document.body.innerText || '').includes('[Mock]'),
      cardCount: cards.length,
      filenames: cards.map((c) => c.getAttribute('data-filename')),
      visibilities: cards.map((c) => c.getAttribute('data-visibility')),
      hasRiskFile: cards.some((c) => (c.getAttribute('data-filename') || '').includes(${JSON.stringify(RISK_FILE)})),
      hasAgentFile: cards.some((c) => (c.getAttribute('data-filename') || '').includes(${JSON.stringify(AGENT_FILE)})),
      hasRiskToken: panel.includes(${JSON.stringify(RISK_TOKEN)}),
      hasAgentToken: panel.includes(${JSON.stringify(AGENT_TOKEN)}),
      emptyHint: [...document.querySelectorAll('.work-block .hint')].map((n) => n.textContent).join('\\n'),
      panelExcerpt: panel.slice(0, 800),
    };
  })()`)
}

async function login(username, password) {
  await send('Page.navigate', { url: `${BASE}/login` })
  await waitFor(`document.querySelector('.login-card') && document.querySelector('#user')`, 10000)
  await evaluate(fillScript('#user', username))
  await evaluate(fillScript('#pass', password))
  await evaluate(`document.querySelector('button[type="submit"]').click()`)
  await waitFor(`location.pathname !== '/login' && document.querySelector('.app')`, 15000)
}

async function logout() {
  await evaluate(`document.querySelector('.session button')?.click()`)
  await waitFor(`location.pathname === '/login' && document.querySelector('.login-card')`, 10000)
}

async function openKnowledgeDoc(filename) {
  if ((await evaluate(`location.pathname`)) !== '/knowledge') {
    await send('Page.navigate', { url: `${BASE}/knowledge` })
    await waitFor(`location.pathname === '/knowledge'`, 10000)
  }
  await waitFor(
    `[...document.querySelectorAll('.kb-row-title')].some((n) => n.textContent.includes(${JSON.stringify(filename)}))`,
    20000,
  )
  await evaluate(`(() => {
    const row = [...document.querySelectorAll('.kb-row')].find((btn) =>
      (btn.querySelector('.kb-row-title')?.textContent || '').includes(${JSON.stringify(filename)})
    );
    if (!row) throw new Error('missing row ' + ${JSON.stringify(filename)});
    row.click();
    return true;
  })()`)
  await waitFor(
    `document.querySelector('.kb-row.selected .kb-row-title')?.textContent.includes(${JSON.stringify(filename)}) && document.querySelectorAll('.kb-chunk').length > 0 && Boolean(document.querySelector('.kb-chunk-body')?.textContent?.trim()) && Boolean(document.querySelector('input[aria-label="生效开始时间"]'))`,
    20000,
  )
  await delay(200)
}

function patchOkSince(beforeHits) {
  const recent = apiHits.slice(beforeHits)
  const req = recent.find((h) => h.type === 'request' && h.method === 'PATCH' && h.path.includes('/api/documents/'))
  if (!req) return false
  return recent.some(
    (h) =>
      h.type === 'response' &&
      h.path.includes('/api/documents/') &&
      h.status === 200 &&
      (!h.requestId || !req.requestId || h.requestId === req.requestId),
  )
}

async function saveVisibility() {
  const beforeHits = apiHits.length
  await evaluate(clickTextScript('button', '保存可见范围和生效时间'))
  const start = Date.now()
  while (Date.now() - start < 20000) {
    if (patchOkSince(beforeHits)) {
      await delay(250)
      return
    }
    await delay(150)
  }
  throw new Error('visibility save did not complete')
}

async function sendEmployee(text, timeoutMs = 90000) {
  const before = await evaluate(`document.querySelectorAll('.chat-msg.other').length`)
  await evaluate(fillScript('.employee-composer textarea', text))
  await evaluate(`document.querySelector('.employee-composer button[type="submit"]').click()`)
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const info = await evaluate(`({
      sending: Boolean(document.querySelector('.employee-composer button[disabled]')),
      other: document.querySelectorAll('.chat-msg.other').length,
      btn: document.querySelector('.employee-composer button[type="submit"]')?.textContent || '',
    })`)
    if (!info.sending && info.other > before) {
      await delay(250)
      break
    }
    await delay(250)
  }
  return evaluate(`({
    text: document.querySelector('.employee-chat')?.innerText || '',
    lastOther: [...document.querySelectorAll('.chat-msg.other .chat-bubble')].map((n) => n.textContent).slice(-1)[0] || '',
    lastKind: [...document.querySelectorAll('.chat-msg.other .chat-msg-tag')].map((n) => n.textContent).slice(-1)[0] || '',
    otherCount: document.querySelectorAll('.chat-msg.other').length,
    pageHasMock: (document.body.innerText || '').includes('[Mock]'),
  })`)
}

function suggestionHitsSince(beforeHits, query) {
  return apiHits.slice(beforeHits).filter((h) => {
    if (!h.path.includes('knowledge-suggestions')) return false
    if (query) {
      const encoded = encodeURIComponent(query)
      return h.path.includes(`q=${encoded}`) || h.path.includes(`q=${query}`)
    }
    return true
  })
}

async function searchAndHold(query, expect) {
  await waitFor(`document.querySelector('#agent-knowledge-search')`, 15000)
  await evaluate(`document.querySelector('#agent-knowledge-search')?.scrollIntoView({ block: 'center' })`)
  await evaluate(fillScript('#agent-knowledge-search', query))
  const beforeHits = apiHits.length
  await evaluate(`document.querySelector('.knowledge-search button')?.click()`)
  const start = Date.now()
  let appeared = null
  while (Date.now() - start < 45000) {
    const searched = suggestionHitsSince(beforeHits, query).some((h) => h.type === 'response')
    const snap = await collectKnowledge()
    if (searched) {
      appeared = snap
      const hasFile = Boolean(expect.file && (snap.filenames || []).includes(expect.file))
      const hasToken = !expect.token || (snap.panelExcerpt || '').includes(expect.token)
      if (hasFile && hasToken) break
      if (Date.now() - start > 5000) break
    }
    await delay(250)
  }
  const appearedShot = await screenshot(expect.screenshot)
  const holdStart = Date.now()
  let dropped = null
  while (Date.now() - holdStart < HOLD_MS) {
    const snap = await collectKnowledge()
    if (expect.file && !snap.filenames?.includes(expect.file)) {
      dropped = snap
      break
    }
    await delay(400)
  }
  const held = dropped || (await collectKnowledge())
  const heldShot = await screenshot(expect.holdScreenshot)
  const searchedReqs = suggestionHitsSince(beforeHits, query).map((h) => ({
    type: h.type,
    path: h.path,
    status: h.status,
  }))
  return { appeared: { ...appeared, screenshot: appearedShot }, held: { ...held, screenshot: heldShot }, dropped: Boolean(dropped), searchedReqs, holdMs: HOLD_MS }
}

function noteNetwork(msg) {
  if (msg.method === 'Network.requestWillBeSent') {
    const req = msg.params?.request
    const url = String(req?.url || '')
    if (!url.includes('/api/')) return
    apiHits.push({
      type: 'request',
      method: req.method,
      path: url.replace(/^https?:\/\/[^/]+/, ''),
      requestId: msg.params.requestId,
    })
    return
  }
  if (msg.method !== 'Network.responseReceived') return
  const res = msg.params?.response
  const url = String(res?.url || '')
  if (!url.includes('/api/')) return
  apiHits.push({
    type: 'response',
    method: res?.requestHeaders?.[':method'] || '',
    path: url.replace(/^https?:\/\/[^/]+/, ''),
    status: res.status,
    requestId: msg.params.requestId,
  })
}

async function main() {
  const password = await readSharedPassword()
  await mkdir(OUT_DIR, { recursive: true })
  const userData = await mkdtemp(path.join(os.tmpdir(), 't045-retest2-chrome-'))
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
    const msg = JSON.parse(event.data)
    if (msg.method) noteNetwork(msg)
    if (msg.id && pending.has(msg.id)) {
      const item = pending.get(msg.id)
      pending.delete(msg.id)
      clearTimeout(item.timer)
      if (msg.error) item.reject(new Error(msg.error.message || JSON.stringify(msg.error)))
      else item.resolve(msg.result)
    }
  })

  const created = await send('Target.createTarget', { url: 'about:blank' })
  const attached = await send('Target.attachToTarget', { targetId: created.targetId, flatten: true })
  sessionId = attached.sessionId
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Network.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })

  const evidence = { base: BASE, cdpPort: CDP_PORT, holdMs: HOLD_MS, checks, apiHits: [] }

  await send('Page.navigate', { url: `${BASE}/login` })
  await waitFor(`document.querySelector('.login-card')`, 10000)
  const loginPage = await collectPage()
  evidence.loginPage = { ...loginPage, screenshot: await screenshot('retest2-login.png') }
  record(
    'tc-mock-off-login',
    loginPage.mockEnabled === false && loginPage.pageHasMock === false,
    { mockEnabled: false, pageHasMock: false },
    { mockEnabled: loginPage.mockEnabled, pageHasMock: loginPage.pageHasMock },
  )

  await login('admin', password)
  await openKnowledgeDoc(USER_FILE)
  await evaluate(fillScript('input[aria-label="生效开始时间"]', FROM_VALUE))
  await evaluate(fillScript('input[aria-label="生效结束时间"]', TO_VALUE))
  await saveVisibility()
  const afterSave = await collectPage()
  evidence.afterSave = { ...afterSave, screenshot: await screenshot('retest2-kb-saved.png') }
  record(
    'ac053-save',
    afterSave.fromValue === FROM_VALUE && afterSave.toValue === TO_VALUE && afterSave.pageHasMock === false,
    { fromValue: FROM_VALUE, toValue: TO_VALUE, mock: false },
    { fromValue: afterSave.fromValue, toValue: afterSave.toValue, mock: afterSave.pageHasMock, selectedRow: afterSave.selectedRow },
  )

  await openKnowledgeDoc(RISK_FILE)
  await openKnowledgeDoc(USER_FILE)
  const reopened = await collectPage()
  evidence.reopened = { ...reopened, screenshot: await screenshot('retest2-kb-reopen.png') }
  record(
    'ac053-reopen',
    reopened.fromValue === FROM_VALUE && reopened.toValue === TO_VALUE && reopened.selectedRow?.includes(USER_FILE) && reopened.chunkCount > 0,
    { fromValue: FROM_VALUE, toValue: TO_VALUE, chunks: true },
    { fromValue: reopened.fromValue, toValue: reopened.toValue, selectedRow: reopened.selectedRow, chunkCount: reopened.chunkCount },
  )

  await evaluate(fillScript('input[aria-label="生效开始时间"]', ''))
  await evaluate(fillScript('input[aria-label="生效结束时间"]', ''))
  await saveVisibility()
  await openKnowledgeDoc(AGENT_FILE)
  await openKnowledgeDoc(USER_FILE)
  const emptied = await collectPage()
  evidence.emptied = { ...emptied, screenshot: await screenshot('retest2-kb-cleared.png') }
  record(
    'ac053-clear-reopen',
    emptied.fromValue === '' && emptied.toValue === '' && emptied.chunkCount > 0,
    { fromValue: '', toValue: '' },
    { fromValue: emptied.fromValue, toValue: emptied.toValue, selectedRow: emptied.selectedRow, chunkCount: emptied.chunkCount },
  )

  await evaluate(fillScript('input[aria-label="生效开始时间"]', RESTORE_FROM))
  await evaluate(fillScript('input[aria-label="生效结束时间"]', RESTORE_TO))
  await evaluate(`(() => {
    const radio = document.querySelector('input[name="kb-visibility"][value="user_visible"]');
    if (!radio) throw new Error('missing user_visible');
    radio.click();
    return true;
  })()`)
  await saveVisibility()
  evidence.restoreUserDates = await collectPage()

  await openKnowledgeDoc(AGENT_FILE)
  const agentDoc = await collectPage()
  evidence.adminAgentDoc = { ...agentDoc, screenshot: await screenshot('retest2-kb-agent-only.png') }
  record(
    'ac059-admin-open-agent-only',
    agentDoc.visibility === 'agent_only' && agentDoc.chunkCount > 0 && (agentDoc.chunkText || '').includes(AGENT_TOKEN) && agentDoc.pageHasMock === false,
    { vis: 'agent_only', hasToken: true, chunks: true },
    { vis: agentDoc.visibility, hasToken: (agentDoc.chunkText || '').includes(AGENT_TOKEN), chunkCount: agentDoc.chunkCount, selected: agentDoc.selectedRow },
  )

  await openKnowledgeDoc(RISK_FILE)
  const riskDoc = await collectPage()
  evidence.adminRiskDoc = { ...riskDoc, screenshot: await screenshot('retest2-kb-high-risk.png') }
  record(
    'ac060-admin-open-high-risk',
    riskDoc.visibility === 'high_risk_human_only' && riskDoc.chunkCount > 0 && (riskDoc.chunkText || '').includes(RISK_TOKEN) && riskDoc.pageHasMock === false,
    { vis: 'high_risk_human_only', hasToken: true, chunks: true },
    { vis: riskDoc.visibility, hasToken: (riskDoc.chunkText || '').includes(RISK_TOKEN), chunkCount: riskDoc.chunkCount, selected: riskDoc.selectedRow },
  )

  await logout()
  await login('employee', password)
  await waitFor(`document.querySelector('.employee-composer textarea')`, 15000)
  const employeeHome = await collectPage()
  evidence.employeeHome = {
    pathname: employeeHome.pathname,
    pageHasMock: employeeHome.pageHasMock,
    mockEnabled: employeeHome.mockEnabled,
    screenshot: await screenshot('retest2-employee.png'),
  }
  record(
    'tc-employee-no-mock',
    employeeHome.mockEnabled === false && employeeHome.pageHasMock === false && employeeHome.pathname === '/employee',
    { mock: false, path: '/employee' },
    { mockEnabled: employeeHome.mockEnabled, pageHasMock: employeeHome.pageHasMock, pathname: employeeHome.pathname },
  )

  const q1 = await sendEmployee('手机退货时坐席要不要先冻结仓内批次码并勾选质检豁免？')
  evidence.q1 = { lastKind: q1.lastKind, lastOther: q1.lastOther, excerpt: (q1.text || '').slice(0, 500) }
  record(
    'ac059-employee-agent-only',
    Boolean(q1.lastOther) && !(q1.lastOther || '').includes(AGENT_TOKEN) && !(q1.text || '').includes(AGENT_TOKEN) && q1.pageHasMock === false,
    { contains_agent_token: false },
    { contains_agent_token: (q1.text || '').includes(AGENT_TOKEN), lastKind: q1.lastKind, lastOther: (q1.lastOther || '').slice(0, 240) },
  )

  const q2 = await sendEmployee('我刚买的手机还没拆封，能七天无理由退货吗？')
  const q2HasScript = (q2.lastOther || '').includes(USER_TOKEN) || (q2.lastOther || '').includes(USER_SCRIPT)
  evidence.q2 = { lastKind: q2.lastKind, lastOther: q2.lastOther, excerpt: (q2.text || '').slice(0, 500) }
  record(
    'ac059-employee-user-visible',
    q2HasScript && !(q2.lastOther || '').includes(AGENT_TOKEN) && !(q2.text || '').includes(AGENT_TOKEN),
    { has_user_script: true, no_internal: true },
    {
      has_user_script: q2HasScript,
      contains_user_token: (q2.lastOther || '').includes(USER_TOKEN),
      contains_agent_token: (q2.text || '').includes(AGENT_TOKEN),
      lastKind: q2.lastKind,
      lastOther: (q2.lastOther || '').slice(0, 240),
    },
  )

  const q3 = await sendEmployee('手机屏幕进液了，会按内部补偿方案赔付吗？')
  evidence.q3 = { lastKind: q3.lastKind, lastOther: q3.lastOther, excerpt: (q3.text || '').slice(0, 500) }
  record(
    'ac060-employee-high-risk',
    Boolean(q3.lastOther) && !(q3.lastOther || '').includes(RISK_TOKEN) && !(q3.text || '').includes(RISK_TOKEN),
    { contains_risk_token: false },
    { contains_risk_token: (q3.text || '').includes(RISK_TOKEN), lastKind: q3.lastKind, lastOther: (q3.lastOther || '').slice(0, 240) },
  )

  await evaluate(clickTextScript('button', '转人工'))
  await waitFor(`(document.body.innerText || '').includes('已转人工')`, 15000)
  evidence.afterTransfer = await collectPage()

  await logout()
  await login('agent', password)
  await waitFor(`location.pathname === '/agent'`, 10000)
  await waitFor(`document.querySelector('.agent-row')`, 15000)
  await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.agent-row')];
    const hit = rows.find((row) => (row.innerText || '').includes('冻结仓内批次码') || (row.innerText || '').includes('七天无理由') || (row.innerText || '').includes('屏幕进液')) || rows[0];
    if (!hit) throw new Error('missing agent row');
    hit.click();
    return hit.innerText.slice(0, 120);
  })()`)
  await waitFor(`document.querySelector('#agent-knowledge-search')`, 15000)
  const agentHome = await collectPage()
  evidence.agentHome = {
    pathname: agentHome.pathname,
    mockEnabled: agentHome.mockEnabled,
    pageHasMock: agentHome.pageHasMock,
    screenshot: await screenshot('retest2-agent.png'),
  }
  record(
    'tc-agent-no-mock',
    agentHome.mockEnabled === false && agentHome.pageHasMock === false,
    { mock: false },
    { mockEnabled: agentHome.mockEnabled, pageHasMock: agentHome.pageHasMock, pathname: agentHome.pathname },
  )

  const agentSearch = await searchAndHold(AGENT_FILE, {
    file: AGENT_FILE,
    token: AGENT_TOKEN,
    screenshot: 'retest2-agent-search.png',
    holdScreenshot: 'retest2-agent-search-hold.png',
  })
  evidence.agentSearch = agentSearch
  const agentAppeared = agentSearch.appeared || {}
  record(
    'ac059-agent-search-internal',
    Boolean(agentAppeared.hasAgentFile) && Boolean(agentAppeared.hasAgentToken) && !agentSearch.dropped,
    { hasToken: true, byFilename: true, held: true },
    {
      hasToken: agentAppeared.hasAgentToken,
      hasFile: agentAppeared.hasAgentFile,
      dropped: agentSearch.dropped,
      filenames: agentAppeared.filenames,
      excerpt: (agentAppeared.panelExcerpt || '').slice(0, 400),
    },
  )

  const riskByFile = await searchAndHold(RISK_FILE, {
    file: RISK_FILE,
    token: RISK_TOKEN,
    screenshot: 'retest2-agent-search-risk-file.png',
    holdScreenshot: 'retest2-agent-search-risk-file-hold.png',
  })
  evidence.riskByFile = riskByFile
  const riskFileOk =
    Boolean(riskByFile.appeared?.hasRiskFile) &&
    Boolean(riskByFile.appeared?.hasRiskToken) &&
    Boolean(riskByFile.held?.hasRiskFile) &&
    Boolean(riskByFile.held?.hasRiskToken) &&
    !riskByFile.dropped
  record(
    'ac060-agent-search-filename',
    riskFileOk,
    { file: RISK_FILE, token: true, held: true },
    {
      appeared: {
        hasRiskFile: riskByFile.appeared?.hasRiskFile,
        hasRiskToken: riskByFile.appeared?.hasRiskToken,
        filenames: riskByFile.appeared?.filenames,
        visibilities: riskByFile.appeared?.visibilities,
        cardCount: riskByFile.appeared?.cardCount,
      },
      held: {
        hasRiskFile: riskByFile.held?.hasRiskFile,
        hasRiskToken: riskByFile.held?.hasRiskToken,
        filenames: riskByFile.held?.filenames,
        visibilities: riskByFile.held?.visibilities,
        cardCount: riskByFile.held?.cardCount,
      },
      dropped: riskByFile.dropped,
      searchedReqs: riskByFile.searchedReqs,
    },
  )

  const riskByBody = await searchAndHold('屏幕进液高风险赔付', {
    file: RISK_FILE,
    token: RISK_TOKEN,
    screenshot: 'retest2-agent-search-risk-body.png',
    holdScreenshot: 'retest2-agent-search-risk-body-hold.png',
  })
  evidence.riskByBody = riskByBody
  const riskBodyOk =
    Boolean(riskByBody.appeared?.hasRiskFile) &&
    Boolean(riskByBody.appeared?.hasRiskToken) &&
    Boolean(riskByBody.held?.hasRiskFile) &&
    Boolean(riskByBody.held?.hasRiskToken) &&
    !riskByBody.dropped
  record(
    'ac060-agent-search-body',
    riskBodyOk,
    { query: '屏幕进液高风险赔付', token: true, held: true },
    {
      appeared: {
        hasRiskFile: riskByBody.appeared?.hasRiskFile,
        hasRiskToken: riskByBody.appeared?.hasRiskToken,
        filenames: riskByBody.appeared?.filenames,
        visibilities: riskByBody.appeared?.visibilities,
        cardCount: riskByBody.appeared?.cardCount,
      },
      held: {
        hasRiskFile: riskByBody.held?.hasRiskFile,
        hasRiskToken: riskByBody.held?.hasRiskToken,
        filenames: riskByBody.held?.filenames,
        visibilities: riskByBody.held?.visibilities,
        cardCount: riskByBody.held?.cardCount,
      },
      dropped: riskByBody.dropped,
      searchedReqs: riskByBody.searchedReqs,
    },
  )
  record(
    'ac060-not-auto-sent-hint',
    (riskByBody.held?.emptyHint || '').includes('不会发给用户') || (riskByFile.held?.emptyHint || '').includes('不会发给用户'),
    { hint: true },
    { hintText: (riskByBody.held?.emptyHint || riskByFile.held?.emptyHint || '').slice(0, 160) },
  )

  await logout()
  await login('employee', password)
  await waitFor(`document.querySelector('.employee-chat')`, 15000)
  const employeeBack = await evaluate(`({
    text: document.querySelector('.employee-chat')?.innerText || '',
    pageHasMock: (document.body.innerText || '').includes('[Mock]'),
  })`)
  evidence.employeeBack = { excerpt: (employeeBack.text || '').slice(0, 600), screenshot: await screenshot('retest2-employee-after-agent.png') }
  record(
    'ac060-employee-still-no-risk',
    !(employeeBack.text || '').includes(RISK_TOKEN) && !(employeeBack.text || '').includes(AGENT_TOKEN),
    { no_internal_auto_send: true },
    {
      contains_risk_token: (employeeBack.text || '').includes(RISK_TOKEN),
      contains_agent_token: (employeeBack.text || '').includes(AGENT_TOKEN),
      excerpt: (employeeBack.text || '').slice(0, 240),
    },
  )

  evidence.apiHits = apiHits
    .filter((h) => h.type === 'response')
    .map((h) => ({ path: h.path, status: h.status }))
    .slice(-120)
  evidence.failed = checks.filter((c) => !c.pass).map((c) => c.id)
  await writeFile(path.join(OUT_DIR, 't045-retest2-browser.json'), JSON.stringify(evidence, null, 2), 'utf8')
  console.log('FAILED', JSON.stringify(evidence.failed))
  if (chromeProc) chromeProc.kill()
  process.exit(evidence.failed.length ? 1 : 0)
}

main().catch(async (err) => {
  console.error(err)
  try {
    await writeFile(
      path.join(OUT_DIR, 't045-retest2-browser.json'),
      JSON.stringify({ error: String(err), checks, failed: checks.filter((c) => !c.pass).map((c) => c.id) }, null, 2),
      'utf8',
    )
  } catch {
    /* ignore */
  }
  if (chromeProc) chromeProc.kill()
  process.exit(1)
})
