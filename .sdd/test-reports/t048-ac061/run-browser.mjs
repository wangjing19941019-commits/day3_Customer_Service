import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..', '..')
const BASE = 'http://127.0.0.1:5218'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT_DIR = HERE
const CDP_PORT = 9548

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

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (result.exceptionDetails) {
    const text =
      result.exceptionDetails.exception?.description ||
      result.exceptionDetails.text ||
      'eval failed'
    throw new Error(`eval failed: ${text}`)
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
    return el.value;
  })()`
}

function noteNetwork(msg) {
  if (msg.method !== 'Network.responseReceived') return
  const res = msg.params?.response
  const url = String(res?.url || '')
  if (!url.includes('/api/')) return
  const pathOnly = url.replace(/^https?:\/\/[^/]+/, '')
  if (
    pathOnly.includes('/api/sessions') ||
    pathOnly.includes('/api/prompt-templates') ||
    pathOnly.includes('/api/prompt-template-alerts')
  ) {
    apiHits.push({ url: pathOnly, status: res.status })
  }
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
    title: document.querySelector('h1')?.textContent?.trim() ?? null,
    pageName: document.querySelector('.page-name')?.textContent?.trim() ?? null,
    topbarUser: document.querySelector('.session .user')?.textContent ?? null,
    nav: [...document.querySelectorAll('.sidebar a')].map((a) => a.textContent.trim()),
    hasLoginCard: Boolean(document.querySelector('.login-card')),
    hasTemplateEditor: Boolean(document.querySelector('.tpl-editor')),
    hasSave: (document.body.innerText || '').includes('保存新版本'),
    hasGray: (document.body.innerText || '').includes('灰度约 5%'),
    hasTemplateTitle: (document.body.innerText || '').includes('模板配置'),
    rowCount: document.querySelectorAll('.tpl-row').length,
    listError: document.querySelector('.tpl-list .error-text')?.textContent?.trim() ?? null,
    pageHasMock: (document.body.innerText || '').includes('[Mock]'),
    mockEnabled: await import('/src/utils/mockFlag.ts').then((m) => m.isMockEnabled()),
  }))()`)
}

async function login(username, password) {
  await send('Page.navigate', { url: `${BASE}/login` })
  await waitFor(`document.querySelector('.login-card') && document.querySelector('#user')`, 10000)
  await evaluate(fillScript('#user', username))
  await evaluate(fillScript('#pass', password))
  await evaluate(`document.querySelector('button[type="submit"]').click()`)
  await waitFor(`location.pathname !== '/login' && document.querySelector('.app')`, 12000)
}

async function main() {
  const password = await readSharedPassword()
  await mkdir(OUT_DIR, { recursive: true })
  const userData = await mkdtemp(path.join(os.tmpdir(), 't048-chrome-'))
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
    if (msg.id && pending.has(msg.id)) {
      const item = pending.get(msg.id)
      pending.delete(msg.id)
      clearTimeout(item.timer)
      if (msg.error) item.reject(new Error(msg.error.message || JSON.stringify(msg.error)))
      else item.resolve(msg.result)
    } else {
      noteNetwork(msg)
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

  const evidence = { base: BASE, cdpPort: CDP_PORT }

  await send('Page.navigate', { url: `${BASE}/login` })
  await waitFor(`document.querySelector('.login-card')`, 10000)
  const loginPage = await collectPage()
  evidence.loginPage = { ...loginPage, screenshot: await screenshot('t048-login.png') }
  record(
    'mock-off-login',
    loginPage.mockEnabled === false && loginPage.pageHasMock === false && loginPage.pathname === '/login',
    { mockEnabled: false, pageHasMock: false },
    { mockEnabled: loginPage.mockEnabled, pageHasMock: loginPage.pageHasMock, pathname: loginPage.pathname },
  )

  await login('agent', password)
  const agentHome = await collectPage()
  evidence.agentHome = { ...agentHome, screenshot: await screenshot('t048-agent.png') }
  record(
    'ac061-agent-home',
    agentHome.pathname === '/agent' &&
      agentHome.topbarUser === '已登录：agent' &&
      !agentHome.nav.includes('模板') &&
      agentHome.nav.includes('客服端') &&
      agentHome.pageHasMock === false &&
      agentHome.mockEnabled === false,
    { path: '/agent', nav: ['客服端'], mock: false },
    {
      pathname: agentHome.pathname,
      topbarUser: agentHome.topbarUser,
      nav: agentHome.nav,
      pageHasMock: agentHome.pageHasMock,
      mockEnabled: agentHome.mockEnabled,
    },
  )

  await send('Page.navigate', { url: `${BASE}/templates` })
  await waitFor(`location.pathname === '/agent'`, 8000)
  const agentBlocked = await collectPage()
  evidence.agentBlockedTemplates = {
    ...agentBlocked,
    screenshot: await screenshot('t048-agent-templates-blocked.png'),
  }
  record(
    'ac061-agent-cannot-open-templates',
    agentBlocked.pathname === '/agent' &&
      agentBlocked.hasTemplateEditor === false &&
      agentBlocked.hasSave === false &&
      agentBlocked.hasGray === false,
    { redirected: '/agent', noEditor: true },
    {
      pathname: agentBlocked.pathname,
      hasTemplateEditor: agentBlocked.hasTemplateEditor,
      hasSave: agentBlocked.hasSave,
      hasGray: agentBlocked.hasGray,
    },
  )

  await send('Page.navigate', { url: `${BASE}/tickets` })
  await waitFor(`location.pathname === '/agent'`, 8000)
  const agentTickets = await collectPage()
  evidence.agentBlockedTickets = { ...agentTickets }
  record(
    'ac061-agent-cannot-open-tickets-gray',
    agentTickets.pathname === '/agent' && agentTickets.hasGray === false,
    { redirected: '/agent' },
    { pathname: agentTickets.pathname, hasGray: agentTickets.hasGray },
  )

  const agentApi = await evaluate(`(async () => {
    const token = localStorage.getItem('access_token');
    const res = await fetch('/api/prompt-templates', {
      headers: token ? { Authorization: 'Bearer ' + token } : {},
    });
    const body = await res.json();
    return {
      status: res.status,
      error: body.error ?? null,
      error_code: body.error_code ?? null,
      success: body.success,
    };
  })()`)
  evidence.agentApi403 = agentApi
  record(
    'ac061-agent-api-403',
    agentApi.status === 403 && agentApi.error_code === 'FORBIDDEN',
    { status: 403, error_code: 'FORBIDDEN' },
    agentApi,
  )

  await evaluate(`document.querySelector('.session button').click()`)
  await waitFor(`location.pathname === '/login' && document.querySelector('.login-card')`, 8000)

  await login('admin', password)
  const adminHome = await collectPage()
  evidence.adminHome = { ...adminHome, screenshot: await screenshot('t048-admin-home.png') }
  record(
    'ac061-admin-nav-has-templates',
    adminHome.nav.includes('模板') &&
      adminHome.topbarUser === '已登录：admin' &&
      adminHome.pageHasMock === false &&
      adminHome.mockEnabled === false,
    { navIncludes: '模板', mock: false },
    { nav: adminHome.nav, topbarUser: adminHome.topbarUser, mockEnabled: adminHome.mockEnabled },
  )

  await evaluate(`([...document.querySelectorAll('.sidebar a')].find((a) => a.textContent.trim() === '模板') || { click() { throw new Error('missing 模板') } }).click()`)
  await waitFor(`location.pathname === '/templates' && document.querySelector('.tpl-editor')`, 10000)
  await waitFor(
    `document.querySelector('.tpl-row') || document.querySelector('.tpl-list .error-text')`,
    15000,
  )
  const rowReady = await evaluate(`Boolean(document.querySelector('.tpl-row'))`)
  if (rowReady) {
    await evaluate(`document.querySelector('.tpl-row').click()`)
    await waitFor(`(document.body.innerText || '').includes('保存新版本')`, 8000)
  }
  const adminTemplates = await collectPage()
  evidence.adminTemplates = {
    ...adminTemplates,
    screenshot: await screenshot('t048-admin-templates.png'),
  }
  record(
    'ac061-admin-open-templates',
    adminTemplates.pathname === '/templates' &&
      adminTemplates.hasTemplateTitle &&
      adminTemplates.hasSave &&
      adminTemplates.hasGray &&
      adminTemplates.pageHasMock === false,
    { path: '/templates', canEdit: true, canGray: true, mock: false },
    {
      pathname: adminTemplates.pathname,
      hasTemplateTitle: adminTemplates.hasTemplateTitle,
      hasSave: adminTemplates.hasSave,
      hasGray: adminTemplates.hasGray,
      pageHasMock: adminTemplates.pageHasMock,
    },
  )

  evidence.apiHits = apiHits
  evidence.failed = checks.filter((c) => !c.pass).map((c) => c.id)
  evidence.passed = checks.filter((c) => c.pass).map((c) => c.id)
  await writeFile(path.join(OUT_DIR, 't048-browser-evidence.json'), JSON.stringify({ checks, evidence }, null, 2), 'utf8')
  if (evidence.failed.length) {
    console.error('FAILED', evidence.failed)
    process.exitCode = 1
  } else {
    console.log('ALL_PASS', evidence.passed)
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    try {
      if (ws && ws.readyState === 1) ws.close()
    } catch {}
    try {
      if (chromeProc && !chromeProc.killed) chromeProc.kill()
    } catch {}
  })
