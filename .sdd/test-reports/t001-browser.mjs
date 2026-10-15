import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const BASE = 'http://127.0.0.1:5199'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT_DIR = path.resolve('C:\\Users\\慈海客服\\Desktop\\demo\\Develop_Helper\\Projects_Repo\\Customer_Service\\.sdd\\test-reports')
const CDP_PORT = 9333

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
    }, 15000)
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

async function waitFor(expression, timeoutMs = 8000) {
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

const collectLogin = `(() => {
  const card = document.querySelector('.login-card');
  const wrap = document.querySelector('.login-wrap');
  const h1 = card?.querySelector('h1');
  const btn = document.querySelector('.btn-primary');
  const cardRect = card?.getBoundingClientRect();
  const wrapRect = wrap?.getBoundingClientRect();
  const cs = card ? getComputedStyle(card) : null;
  const h1cs = h1 ? getComputedStyle(h1) : null;
  const btncs = btn ? getComputedStyle(btn) : null;
  const bodycs = getComputedStyle(document.body);
  const fieldErrors = [...document.querySelectorAll('.field .error-text')].map((n) => n.textContent);
  return {
    href: location.href,
    pathname: location.pathname,
    title: h1?.textContent ?? null,
    bodyText: document.body.innerText,
    hasLoggedOutHint: (document.body.innerText || '').includes('当前未登录'),
    fieldErrors,
    formAlert: document.querySelector('[role="alert"]')?.textContent ?? '',
    card: cs && cardRect && wrapRect ? {
      width: cs.width,
      padding: cs.padding,
      radius: cs.borderRadius,
      shadow: cs.boxShadow,
      centerDelta: Math.abs((cardRect.left + cardRect.width / 2) - (wrapRect.left + wrapRect.width / 2)),
      verticalInView: cardRect.top >= 0 && cardRect.bottom <= window.innerHeight + 1,
    } : null,
    h1: h1cs ? { fontSize: h1cs.fontSize, fontWeight: h1cs.fontWeight, lineHeight: h1cs.lineHeight } : null,
    primary: btncs ? { backgroundColor: btncs.backgroundColor, height: btncs.height } : null,
    canvas: bodycs.backgroundColor,
    tokenPresent: Boolean(localStorage.getItem('access_token')),
  };
})()`

const collectShell = `(() => {
  const topbar = document.querySelector('.topbar');
  const main = document.querySelector('main');
  const user = document.querySelector('.session .user');
  const logout = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '退出');
  const nav = [...document.querySelectorAll('.sidebar a')].map((a) => ({
    text: a.textContent.trim(),
    href: a.getAttribute('href'),
    className: a.className,
    ariaCurrent: a.getAttribute('aria-current'),
  }));
  return {
    href: location.href,
    pathname: location.pathname,
    bodyText: document.body.innerText,
    topbarHeight: topbar ? getComputedStyle(topbar).height : null,
    topbarUser: user?.textContent ?? null,
    hasLogout: Boolean(logout),
    nav,
    mainHeadings: [...(main?.querySelectorAll('h1') ?? [])].map((h) => h.textContent.trim()),
    mainChildCount: main ? main.children.length : 0,
    tokenPresent: Boolean(localStorage.getItem('access_token')),
    tokenKeyIsAccessToken: Object.prototype.hasOwnProperty.call(localStorage, 'access_token') || localStorage.getItem('access_token') != null,
  };
})()`

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const userData = await mkdtemp(path.join(os.tmpdir(), 't001-chrome-'))
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
  await send('Network.enable')

  const evidence = { mock: true, viewport: '1440x900', steps: [] }

  async function goto(url) {
    const nav = send('Page.navigate', { url })
    await Promise.race([
      send('Page.loadEventFired').catch(() => null),
      delay(3000),
    ])
    await nav
  }

  // TC-02 / TC-03: unauthenticated /employee -> login
  await goto(`${BASE}/employee`)
  await waitFor(`document.querySelector('.login-card')`)
  const unauthDirect = await evaluate(collectLogin)
  evidence.steps.push({
    id: 'unauth-employee',
    screenshot: await screenshot('t001-unauth-employee.png'),
    ...unauthDirect,
    bodyText: undefined,
  })
  evidence.unauthDirect = {
    pathname: unauthDirect.pathname,
    hasLoggedOutHint: unauthDirect.hasLoggedOutHint,
    tokenPresent: unauthDirect.tokenPresent,
    title: unauthDirect.title,
  }

  // visual
  evidence.visualLogin = {
    canvas: unauthDirect.canvas,
    card: unauthDirect.card,
    h1: unauthDirect.h1,
    primary: unauthDirect.primary,
    hasLoggedOutHint: unauthDirect.hasLoggedOutHint,
    hasMockOnPage: (await evaluate(`document.body.innerText`)).includes('[Mock]'),
  }

  // empty submit
  await evaluate(`document.querySelector('button[type="submit"]').click()`)
  await waitFor(`document.querySelectorAll('.field .error-text').length > 0`)
  const emptySubmit = await evaluate(collectLogin)
  evidence.emptySubmit = {
    pathname: emptySubmit.pathname,
    fieldErrors: emptySubmit.fieldErrors,
    formAlert: emptySubmit.formAlert,
    screenshot: await screenshot('t001-empty-submit.png'),
  }

  // wrong password
  await evaluate(fillScript('#user', 'it-help'))
  await evaluate(fillScript('#pass', 'wrong-password'))
  await evaluate(`document.querySelector('button[type="submit"]').click()`)
  await waitFor(`(document.querySelector('[role="alert"]')?.textContent || '').includes('密码') || (document.querySelector('[role="alert"]')?.textContent || '').includes('错误') || (document.querySelector('[role="alert"]')?.textContent || '').includes('不正确')`)
  const wrong = await evaluate(collectLogin)
  evidence.wrongPassword = {
    pathname: wrong.pathname,
    formAlert: wrong.formAlert,
    usernameKept: await evaluate(`document.querySelector('#user')?.value`),
    tokenPresent: wrong.tokenPresent,
    screenshot: await screenshot('t001-wrong-password.png'),
  }

  // correct login
  await evaluate(fillScript('#user', 'it-help'))
  await evaluate(fillScript('#pass', 'it-help123'))
  await evaluate(`document.querySelector('button[type="submit"]').click()`)
  await waitFor(`document.querySelector('.topbar') && location.pathname === '/employee'`)
  const loggedIn = await evaluate(collectShell)
  evidence.loggedIn = {
    pathname: loggedIn.pathname,
    topbarHeight: loggedIn.topbarHeight,
    topbarUser: loggedIn.topbarUser,
    hasLogout: loggedIn.hasLogout,
    nav: loggedIn.nav,
    mainHeadings: loggedIn.mainHeadings,
    tokenPresent: loggedIn.tokenPresent,
    screenshot: await screenshot('t001-logged-in-employee.png'),
  }

  // nav mutual exclusion
  async function clickNav(label) {
    await evaluate(`([...document.querySelectorAll('.sidebar a')].find((a) => a.textContent.trim() === ${JSON.stringify(label)})).click()`)
    await waitFor(`location.pathname !== '/login' && document.querySelector('main h1')`)
    return evaluate(collectShell)
  }
  const agent = await clickNav('客服端')
  evidence.navAgent = {
    pathname: agent.pathname,
    mainHeadings: agent.mainHeadings,
    nav: agent.nav,
    screenshot: await screenshot('t001-nav-agent.png'),
  }
  const knowledge = await clickNav('知识库')
  evidence.navKnowledge = {
    pathname: knowledge.pathname,
    mainHeadings: knowledge.mainHeadings,
    nav: knowledge.nav,
    screenshot: await screenshot('t001-nav-knowledge.png'),
  }

  // refresh keeps route + nav
  await goto(`${BASE}/knowledge`)
  await waitFor(`document.querySelector('.topbar') && location.pathname === '/knowledge'`)
  const afterReload = await evaluate(collectShell)
  evidence.afterReload = {
    pathname: afterReload.pathname,
    topbarUser: afterReload.topbarUser,
    nav: afterReload.nav,
    mainHeadings: afterReload.mainHeadings,
    tokenPresent: afterReload.tokenPresent,
    screenshot: await screenshot('t001-reload-knowledge.png'),
  }

  // logout
  await evaluate(`([...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '退出')).click()`)
  await waitFor(`document.querySelector('.login-card')`)
  const afterLogout = await evaluate(collectLogin)
  evidence.afterLogout = {
    pathname: afterLogout.pathname,
    hasLoggedOutHint: afterLogout.hasLoggedOutHint,
    tokenPresent: afterLogout.tokenPresent,
    screenshot: await screenshot('t001-after-logout.png'),
  }

  await goto(`${BASE}/employee`)
  await waitFor(`document.querySelector('.login-card')`)
  const afterLogoutEmployee = await evaluate(collectLogin)
  evidence.afterLogoutEmployee = {
    pathname: afterLogoutEmployee.pathname,
    hasLoggedOutHint: afterLogoutEmployee.hasLoggedOutHint,
    tokenPresent: afterLogoutEmployee.tokenPresent,
  }

  const outFile = path.join(OUT_DIR, 't001-browser-evidence.json')
  await writeFile(outFile, JSON.stringify(evidence, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: true, outFile, summary: {
    unauth: evidence.unauthDirect,
    empty: evidence.emptySubmit,
    wrong: evidence.wrongPassword,
    loggedIn: evidence.loggedIn,
    agent: evidence.navAgent,
    knowledge: evidence.navKnowledge,
    reload: evidence.afterReload,
    logout: evidence.afterLogout,
    logoutEmployee: evidence.afterLogoutEmployee,
    visual: evidence.visualLogin,
  } }, null, 2))
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    try { ws?.close() } catch {}
    try { chromeProc?.kill() } catch {}
    await delay(300)
  })
