import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const BASE = 'http://127.0.0.1:5199'
const BACKEND = 'http://127.0.0.1:8099'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT_DIR = path.resolve(
  'C:\\Users\\慈海客服\\Desktop\\demo\\Develop_Helper\\Projects_Repo\\Customer_Service\\.sdd\\test-reports',
)
const CDP_PORT = 9368
const USERNAME = 'it-help'
const WRONG_PASSWORD = 'wrong-password-t010'

let chromeProc
let ws
let sessionId
let msgId = 0
const pending = new Map()
const checks = []
const sessionNetwork = []

function record(id, pass, expected, actual, extra = {}) {
  checks.push({ id, pass: Boolean(pass), expected, actual, ...extra })
  if (!pass) {
    console.error(`FAIL ${id}: expected ${JSON.stringify(expected)} actual ${JSON.stringify(actual)}`)
  } else {
    console.log(`PASS ${id}`)
  }
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

async function waitFor(expression, timeoutMs = 10000) {
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

async function setViewport(width, height) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  })
}

const collectLogin = `(() => ({
  pathname: location.pathname,
  title: document.querySelector('h1')?.textContent?.trim() ?? null,
  hasLoggedOutHint: (document.body.innerText || '').includes('当前未登录'),
  formError: document.querySelector('[role="alert"]')?.textContent?.trim() ?? '',
  tokenPresent: Boolean(localStorage.getItem('access_token')),
  pageHasMock: (document.body.innerText || '').includes('[Mock]'),
  hasBusinessShell: Boolean(document.querySelector('.app')),
  hasLoginCard: Boolean(document.querySelector('.login-card')),
}))()`

const collectShell = `(() => {
  const nav = [...document.querySelectorAll('.sidebar a')].map((a) => ({
    text: a.textContent.trim(),
    active: a.classList.contains('active') || a.getAttribute('aria-current') === 'page',
  }));
  return {
    pathname: location.pathname,
    title: document.querySelector('.page-name')?.textContent ?? null,
    topbarUser: document.querySelector('.session .user')?.textContent ?? null,
    logoutText: document.querySelector('.session button')?.textContent?.trim() ?? null,
    activeNav: nav.filter((n) => n.active).map((n) => n.text),
    hasEmployee: Boolean(document.querySelector('.employee-chat')),
    hasEmployeeComposer: Boolean(document.querySelector('.employee-composer textarea')),
    hasAgent: Boolean(document.querySelector('.agent-inbox')),
    hasKnowledge: Boolean(document.querySelector('.kb-page')),
    tokenPresent: Boolean(localStorage.getItem('access_token')),
    pageHasMock: (document.body.innerText || '').includes('[Mock]'),
  };
})()`

async function clickNav(label) {
  await evaluate(`(() => {
    const a = [...document.querySelectorAll('.sidebar a')].find((el) => el.textContent.trim() === ${JSON.stringify(label)});
    if (!a) throw new Error('missing nav ' + ${JSON.stringify(label)});
    a.click();
  })()`)
}

async function submitLogin(username, password) {
  await waitFor(`document.querySelector('#user') && document.querySelector('#pass') && document.querySelector('button[type="submit"]')`, 8000)
  await evaluate(fillScript('#user', username))
  await evaluate(fillScript('#pass', password))
  await evaluate(`document.querySelector('button[type="submit"]').click()`)
}

async function logoutAndExpectLogin() {
  await evaluate(`document.querySelector('.session button').click()`)
  await waitFor(`location.pathname === '/login' && document.querySelector('.login-card')`, 8000)
  return evaluate(collectLogin)
}

function noteSessionNetwork(msg) {
  const methodName = msg.method
  if (methodName === 'Network.requestWillBeSent') {
    const req = msg.params?.request
    const url = String(req?.url || '')
    if (!url.includes('/api/sessions')) return
    sessionNetwork.push({
      kind: 'request',
      requestId: msg.params.requestId,
      method: req.method,
      url: url.replace(/([?&]access_token=)[^&]+/gi, '$1REDACTED'),
      hasAuthHeader: Boolean(req.headers?.Authorization || req.headers?.authorization),
    })
  }
  if (methodName === 'Network.responseReceived') {
    const res = msg.params?.response
    const url = String(res?.url || '')
    if (!url.includes('/api/sessions')) return
    sessionNetwork.push({
      kind: 'response',
      requestId: msg.params.requestId,
      status: res.status,
      url: url.replace(/([?&]access_token=)[^&]+/gi, '$1REDACTED'),
      mimeType: res.mimeType,
    })
  }
}

async function corsCheck() {
  const origins = [
    'http://127.0.0.1:5199',
    'http://localhost:5199',
    'http://127.0.0.1:5175',
    'http://localhost:5175',
  ]
  const results = []
  for (const origin of origins) {
    const res = await fetch(`${BACKEND}/api/sessions/current`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    })
    results.push({
      origin,
      status: res.status,
      allowOrigin: res.headers.get('access-control-allow-origin'),
      allowHeaders: res.headers.get('access-control-allow-headers'),
    })
  }
  return results
}

async function noLogoutApiCheck() {
  const deleteRes = await fetch(`${BACKEND}/api/sessions`, { method: 'DELETE' })
  const logoutRes = await fetch(`${BACKEND}/api/logout`, { method: 'POST' })
  return {
    deleteSessions: deleteRes.status,
    postLogout: logoutRes.status,
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const userData = await mkdtemp(path.join(os.tmpdir(), 't010-chrome-'))
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
    if (msg.method) noteSessionNetwork(msg)
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
    steps: [],
  }

  const vite = await fetch(BASE)
  evidence.viteStatus = vite.status
  record('env-vite', vite.status === 200, 200, vite.status)

  const backend = await fetch(`${BACKEND}/docs`)
  evidence.backendStatus = backend.status
  record('env-backend', backend.status === 200, 200, backend.status)

  evidence.cors = await corsCheck()
  record(
    'tc-cors-5199-5175',
    evidence.cors.every((item) => item.allowOrigin === item.origin),
    'CORS allow 5199 and 5175',
    evidence.cors,
  )

  evidence.noLogoutApi = await noLogoutApiCheck()
  record(
    'tc-no-logout-api',
    evidence.noLogoutApi.deleteSessions === 405 && evidence.noLogoutApi.postLogout === 404,
    { deleteSessions: 405, postLogout: 404 },
    evidence.noLogoutApi,
  )

  await goto(`${BASE}/login`)
  await waitFor(`document.querySelector('.login-card')`, 8000)
  const mockFlag = await evaluate(`import('/src/utils/mockFlag.ts').then((m) => m.isMockEnabled())`)
  evidence.mockEnabled = mockFlag
  record('tc-mock-off', mockFlag === false, false, mockFlag)

  const loginStart = await evaluate(collectLogin)
  evidence.loginStart = { ...loginStart, screenshot: await screenshot('t010-login.png') }
  record(
    'tc-login-no-mock',
    loginStart.pathname === '/login' && loginStart.hasLoggedOutHint && loginStart.pageHasMock === false && loginStart.tokenPresent === false,
    { pathname: '/login', 当前未登录: true, mock: false, token: false },
    loginStart,
  )

  await submitLogin(USERNAME, WRONG_PASSWORD)
  await waitFor(`document.querySelector('[role="alert"]') && document.querySelector('[role="alert"]').textContent.trim().length > 0`, 8000)
  const wrong = await evaluate(collectLogin)
  evidence.wrongPassword = { ...wrong, screenshot: await screenshot('t010-wrong-password.png') }
  record(
    'ac010-wrong-password',
    wrong.pathname === '/login' &&
      wrong.hasBusinessShell === false &&
      wrong.tokenPresent === false &&
      wrong.formError.includes('用户名或密码错误') &&
      wrong.pageHasMock === false,
    { stayLogin: true, error: '用户名或密码错误', noToken: true },
    { pathname: wrong.pathname, formError: wrong.formError, tokenPresent: wrong.tokenPresent, hasBusinessShell: wrong.hasBusinessShell },
  )

  const wrongNet = sessionNetwork.filter((item) => item.kind === 'response' && item.url.includes('/api/sessions') && !item.url.includes('/current'))
  evidence.wrongPasswordNetwork = wrongNet
  record(
    'tc-wrong-password-401',
    wrongNet.some((item) => item.status === 401),
    401,
    wrongNet.map((item) => ({ status: item.status, url: item.url })),
  )

  await submitLogin(USERNAME, 'it-help123')
  await waitFor(`document.querySelector('.app') && location.pathname === '/employee'`, 10000)
  await waitFor(`document.querySelector('.employee-chat')`, 8000)
  const employee = await evaluate(collectShell)
  const current = await evaluate(`(async () => {
    const token = localStorage.getItem('access_token');
    if (!token) return { status: 0, username: null, tokenPresent: false };
    const res = await fetch('/api/sessions/current', {
      headers: { Authorization: 'Bearer ' + token },
    });
    const body = await res.json();
    return {
      status: res.status,
      username: body?.data?.username ?? null,
      success: body?.success === true,
      tokenPresent: true,
    };
  })()`)
  evidence.employee = { ...employee, api002: current, screenshot: await screenshot('t010-employee.png') }
  record(
    'ac009-employee',
    employee.pathname === '/employee' &&
      employee.hasEmployee &&
      employee.hasEmployeeComposer &&
      employee.topbarUser === `已登录：${USERNAME}` &&
      employee.logoutText === '退出' &&
      employee.tokenPresent &&
      employee.pageHasMock === false,
    { page: '/employee', topbar: `已登录：${USERNAME}`, logout: '退出' },
    {
      pathname: employee.pathname,
      topbarUser: employee.topbarUser,
      logoutText: employee.logoutText,
      hasEmployee: employee.hasEmployee,
      tokenPresent: employee.tokenPresent,
      pageHasMock: employee.pageHasMock,
    },
  )
  record(
    'tc-api002-topbar',
    current.status === 200 && current.username === USERNAME && employee.topbarUser === `已登录：${current.username}`,
    { status: 200, username: USERNAME },
    current,
  )

  await clickNav('客服端')
  await waitFor(`location.pathname === '/agent' && document.querySelector('.agent-inbox')`, 8000)
  const agent = await evaluate(collectShell)
  evidence.agent = { ...agent, screenshot: await screenshot('t010-agent.png') }
  record(
    'ac009-agent',
    agent.pathname === '/agent' &&
      agent.hasAgent &&
      agent.topbarUser === `已登录：${USERNAME}` &&
      agent.logoutText === '退出' &&
      agent.tokenPresent &&
      agent.pageHasMock === false,
    { page: '/agent', topbar: `已登录：${USERNAME}` },
    {
      pathname: agent.pathname,
      topbarUser: agent.topbarUser,
      logoutText: agent.logoutText,
      hasAgent: agent.hasAgent,
      tokenPresent: agent.tokenPresent,
      pageHasMock: agent.pageHasMock,
    },
  )

  await clickNav('知识库')
  await waitFor(`location.pathname === '/knowledge' && document.querySelector('.kb-page')`, 8000)
  const knowledge = await evaluate(collectShell)
  evidence.knowledge = { ...knowledge, screenshot: await screenshot('t010-knowledge.png') }
  record(
    'ac009-knowledge',
    knowledge.pathname === '/knowledge' &&
      knowledge.hasKnowledge &&
      knowledge.topbarUser === `已登录：${USERNAME}` &&
      knowledge.logoutText === '退出' &&
      knowledge.tokenPresent &&
      knowledge.pageHasMock === false,
    { page: '/knowledge', topbar: `已登录：${USERNAME}` },
    {
      pathname: knowledge.pathname,
      topbarUser: knowledge.topbarUser,
      logoutText: knowledge.logoutText,
      hasKnowledge: knowledge.hasKnowledge,
      tokenPresent: knowledge.tokenPresent,
      pageHasMock: knowledge.pageHasMock,
    },
  )

  const afterLogout = await logoutAndExpectLogin()
  evidence.logout = { ...afterLogout, screenshot: await screenshot('t010-logout.png') }
  record(
    'ac026-logout',
    afterLogout.pathname === '/login' &&
      afterLogout.hasLoggedOutHint &&
      afterLogout.tokenPresent === false &&
      afterLogout.pageHasMock === false,
    { pathname: '/login', 当前未登录: true, token: false },
    afterLogout,
  )

  for (const route of [
    { path: '/employee', shot: 't010-direct-employee.png' },
    { path: '/agent', shot: 't010-direct-agent.png' },
    { path: '/knowledge', shot: 't010-direct-knowledge.png' },
  ]) {
    await goto(`${BASE}${route.path}`)
    await waitFor(`location.pathname === '/login' && document.querySelector('.login-card')`, 8000)
    const blocked = await evaluate(collectLogin)
    evidence[`direct${route.path}`] = { ...blocked, screenshot: await screenshot(route.shot) }
    record(
      `ac026-direct${route.path}`,
      blocked.pathname === '/login' && blocked.hasLoggedOutHint && blocked.tokenPresent === false && blocked.hasBusinessShell === false,
      { redirect: '/login', 当前未登录: true },
      { pathname: blocked.pathname, hasLoggedOutHint: blocked.hasLoggedOutHint, tokenPresent: blocked.tokenPresent, hasBusinessShell: blocked.hasBusinessShell },
    )
  }

  evidence.sessionNetwork = sessionNetwork.map((item) => ({
    kind: item.kind,
    method: item.method,
    status: item.status,
    url: item.url,
    hasAuthHeader: item.hasAuthHeader,
  }))
  const loginPosts = sessionNetwork.filter((item) => item.kind === 'request' && item.method === 'POST' && item.url.includes('/api/sessions'))
  const currentGets = sessionNetwork.filter((item) => item.kind === 'request' && item.method === 'GET' && item.url.includes('/api/sessions/current'))
  record('tc-real-post-sessions', loginPosts.length >= 2, '>=2 real POST /api/sessions', loginPosts.length)
  record('tc-real-get-current', currentGets.length >= 1, '>=1 real GET /api/sessions/current', currentGets.length)

  const anyMock = [loginStart, wrong, employee, agent, knowledge, afterLogout].some((item) => item.pageHasMock)
  record('ac-no-mock', anyMock === false, false, { anyMock })

  evidence.checks = checks
  evidence.failed = checks.filter((c) => !c.pass).map((c) => c.id)
  await writeFile(path.join(OUT_DIR, 't010-browser-evidence.json'), JSON.stringify(evidence, null, 2))
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
