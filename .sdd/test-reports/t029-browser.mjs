import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const BASE = process.env.T029_BASE || 'http://127.0.0.1:5211'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT_DIR = path.resolve(
  'C:\\Users\\慈海客服\\Desktop\\demo\\Develop_Helper\\Projects_Repo\\Customer_Service\\.sdd\\test-reports',
)
const CDP_PORT = Number(process.env.T029_CDP_PORT || 9479)
const DEMO_PASS = process.env.T029_DEMO_PASS || ''
const WRONG_PASS = process.env.T029_WRONG_PASS || 'wrong-password-not-used'

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
    return el.value;
  })()`
}

function assert(cond, label, extra) {
  if (!cond) {
    const detail = extra === undefined ? '' : ` ${JSON.stringify(extra)}`
    throw new Error(`ASSERT FAIL: ${label}${detail}`)
  }
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
  const bodyText = document.body.innerText || '';
  return {
    href: location.href,
    pathname: location.pathname,
    title: h1?.textContent ?? null,
    hasLoggedOutHint: bodyText.includes('当前未登录'),
    hasMock: bodyText.includes('[Mock]'),
    seedHintHas: {
      employee: bodyText.includes('employee'),
      agent: bodyText.includes('agent'),
      specialist: bodyText.includes('specialist'),
      senior: bodyText.includes('senior'),
      supervisor: bodyText.includes('supervisor'),
      after_sales_supervisor: bodyText.includes('after_sales_supervisor'),
      cs_lead: bodyText.includes('cs_lead'),
      logistics_agent: bodyText.includes('logistics_agent'),
      cs_supervisor: bodyText.includes('cs_supervisor'),
      admin: bodyText.includes('admin'),
    },
    formAlert: document.querySelector('[role="alert"]')?.textContent ?? '',
    usernameValue: document.querySelector('#user')?.value ?? '',
    card: cs && cardRect && wrapRect ? {
      width: cs.width,
      padding: cs.padding,
      radius: cs.borderRadius,
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
  const logout = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '退出');
  const nav = [...document.querySelectorAll('.sidebar a')].map((a) => ({
    text: (a.textContent || '').trim(),
    href: a.getAttribute('href'),
    className: a.className,
  }));
  const navText = nav.map((item) => item.text).join('|');
  return {
    href: location.href,
    pathname: location.pathname,
    topbarHeight: topbar ? getComputedStyle(topbar).height : null,
    topbarUser: user?.textContent ?? null,
    hasLogout: Boolean(logout),
    nav,
    navHasTemplate: /模板/.test(navText),
    navHasGray: /灰度/.test(navText),
    navHasTickets: /工单列表/.test(navText),
    navHasKnowledge: /知识库/.test(navText),
    navHasAgent: /客服端/.test(navText),
    navHasEmployee: /员工端/.test(navText),
    mainHeadings: [...(main?.querySelectorAll('h1') ?? [])].map((h) => (h.textContent || '').trim()),
    mainText: (main?.innerText || '').slice(0, 400),
    tokenPresent: Boolean(localStorage.getItem('access_token')),
  };
})()`

async function clickLogin() {
  await evaluate(`(() => {
    const btn = document.querySelector('.btn-primary');
    if (!btn) throw new Error('missing login button');
    btn.click();
    return true;
  })()`)
}

async function loginAs(username, password) {
  await waitFor(`document.querySelector('#user') && document.querySelector('#pass')`)
  await evaluate(fillScript('#user', username))
  await evaluate(fillScript('#pass', password))
  await clickLogin()
}

async function clickNav(label) {
  const clicked = await evaluate(`(() => {
    const link = [...document.querySelectorAll('.sidebar a')].find((a) => (a.textContent || '').trim() === ${JSON.stringify(label)});
    if (!link) return false;
    link.click();
    return true;
  })()`)
  assert(clicked, `sidebar has ${label}`)
}

async function clickLogout() {
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '退出');
    if (!btn) throw new Error('missing logout');
    btn.click();
    return true;
  })()`)
  await waitFor(`location.pathname.includes('/login') && document.body.innerText.includes('当前未登录')`)
}

async function gotoPath(pathname) {
  await evaluate(`location.assign(${JSON.stringify(BASE + pathname)})`)
}

async function main() {
  if (!DEMO_PASS) throw new Error('missing T029_DEMO_PASS')
  await mkdir(OUT_DIR, { recursive: true })
  const userData = await mkdtemp(path.join(os.tmpdir(), 't029-chrome-'))
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
      const { resolve, reject, timer } = pending.get(msg.id)
      clearTimeout(timer)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
    }
  })

  const targets = await waitJson(`http://127.0.0.1:${CDP_PORT}/json/list`)
  const pageTarget = targets.find((t) => t.type === 'page') || targets[0]
  const attached = await send('Target.attachToTarget', { targetId: pageTarget.id, flatten: true })
  sessionId = attached.sessionId
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })

  const evidence = {
    chrome: version.Browser,
    cdpPort: CDP_PORT,
    base: BASE,
    mock: true,
  }

  await send('Page.navigate', { url: `${BASE}/login` })
  await waitFor(`document.querySelector('.login-card')`)
  const loginOpen = await evaluate(collectLogin)
  evidence.loginOpen = loginOpen
  evidence.loginOpenShot = await screenshot('t029-login.png')
  assert(loginOpen.pathname === '/login' || loginOpen.pathname === '/login/', 'open login path', loginOpen.pathname)
  assert(loginOpen.hasLoggedOutHint, 'shows 当前未登录')
  assert(loginOpen.hasMock, 'login mock mark')
  assert(loginOpen.card?.centerDelta < 8, 'login card centered', loginOpen.card)
  assert(loginOpen.h1?.fontSize === '20px', 'UI-01 title 20px', loginOpen.h1)
  assert(loginOpen.h1?.fontWeight === '600', 'UI-01 title 600', loginOpen.h1)
  assert(loginOpen.primary?.backgroundColor === 'rgb(29, 78, 137)', 'primary #1d4e89', loginOpen.primary)
  assert(loginOpen.primary?.height === '40px', 'primary button 40px', loginOpen.primary)
  const missingSeeds = Object.entries(loginOpen.seedHintHas)
    .filter(([, ok]) => !ok)
    .map(([name]) => name)
  assert(missingSeeds.length === 0, 'ten seed usernames visible', missingSeeds)

  await loginAs('employee', WRONG_PASS)
  await waitFor(`(document.querySelector('[role="alert"]')?.textContent || '').includes('[Mock]')`)
  const wrongPass = await evaluate(collectLogin)
  evidence.wrongPass = {
    pathname: wrongPass.pathname,
    formAlert: wrongPass.formAlert,
    usernameKept: wrongPass.usernameValue,
    tokenPresent: wrongPass.tokenPresent,
    hasLoggedOutHint: wrongPass.hasLoggedOutHint,
  }
  evidence.wrongPassShot = await screenshot('t029-wrong-password.png')
  assert(wrongPass.pathname.includes('/login'), 'wrong password stays on login', wrongPass.pathname)
  assert(wrongPass.formAlert.includes('[Mock]'), 'wrong password mock mark', wrongPass.formAlert)
  assert(/用户名或密码/.test(wrongPass.formAlert), 'wrong password failure copy', wrongPass.formAlert)
  assert(wrongPass.usernameValue === 'employee', 'keeps username', wrongPass.usernameValue)
  assert(!wrongPass.tokenPresent, 'no token after wrong password')

  await loginAs('employee', DEMO_PASS)
  await waitFor(`location.pathname === '/employee' && document.querySelector('.session .user')`)
  const employeeHome = await evaluate(collectShell)
  evidence.employeeHome = employeeHome
  evidence.employeeShot = await screenshot('t029-employee.png')
  assert(employeeHome.pathname === '/employee', 'employee lands /employee', employeeHome.pathname)
  assert((employeeHome.topbarUser || '').includes('employee'), 'employee username', employeeHome.topbarUser)
  assert((employeeHome.topbarUser || '').includes('[Mock]'), 'employee mock username', employeeHome.topbarUser)
  assert(employeeHome.hasLogout, 'employee logout')
  assert(employeeHome.topbarHeight === '56px', 'topbar 56px', employeeHome.topbarHeight)
  assert(employeeHome.navHasEmployee, 'employee nav')
  assert(!employeeHome.navHasTemplate && !employeeHome.navHasGray, 'employee has no template/gray nav', employeeHome.nav)
  await gotoPath('/agent')
  await delay(300)
  await waitFor(`location.pathname === '/employee'`)
  const employeeBlockedAgent = await evaluate(collectShell)
  evidence.employeeBlockedAgent = { pathname: employeeBlockedAgent.pathname }
  assert(employeeBlockedAgent.pathname === '/employee', 'employee cannot use /agent', employeeBlockedAgent.pathname)
  await gotoPath('/knowledge')
  await delay(300)
  await waitFor(`location.pathname === '/employee'`)
  const employeeBlockedKb = await evaluate(collectShell)
  evidence.employeeBlockedKb = { pathname: employeeBlockedKb.pathname }
  assert(employeeBlockedKb.pathname === '/employee', 'employee cannot use /knowledge', employeeBlockedKb.pathname)

  await clickLogout()
  const afterEmployeeLogout = await evaluate(collectLogin)
  evidence.afterEmployeeLogout = {
    pathname: afterEmployeeLogout.pathname,
    hasLoggedOutHint: afterEmployeeLogout.hasLoggedOutHint,
    tokenPresent: afterEmployeeLogout.tokenPresent,
  }
  assert(afterEmployeeLogout.hasLoggedOutHint, 'logout back to 当前未登录')
  assert(!afterEmployeeLogout.tokenPresent, 'token dropped on logout')

  await loginAs('agent', DEMO_PASS)
  await waitFor(`location.pathname === '/agent' && document.querySelector('.session .user')`)
  const agentHome = await evaluate(collectShell)
  evidence.agentHome = agentHome
  evidence.agentShot = await screenshot('t029-agent.png')
  assert(agentHome.pathname === '/agent', 'agent lands /agent', agentHome.pathname)
  assert((agentHome.topbarUser || '').includes('agent'), 'agent username', agentHome.topbarUser)
  assert((agentHome.topbarUser || '').includes('[Mock]'), 'agent mock username', agentHome.topbarUser)
  assert(agentHome.hasLogout, 'agent logout')
  assert(agentHome.navHasAgent, 'agent sidebar has 客服端')
  assert(!agentHome.navHasTemplate, 'agent no 模板 nav', agentHome.nav)
  assert(!agentHome.navHasGray, 'agent no 灰度 nav', agentHome.nav)
  assert(!agentHome.navHasKnowledge && !agentHome.navHasTickets, 'agent no admin nav', agentHome.nav)
  await gotoPath('/templates')
  await delay(300)
  await waitFor(`location.pathname === '/agent'`)
  const agentBlockedTemplates = await evaluate(collectShell)
  evidence.agentBlockedTemplates = {
    pathname: agentBlockedTemplates.pathname,
    navHasTemplate: agentBlockedTemplates.navHasTemplate,
    mainHeadings: agentBlockedTemplates.mainHeadings,
  }
  assert(agentBlockedTemplates.pathname === '/agent', 'agent cannot use /templates', agentBlockedTemplates)
  assert(!agentBlockedTemplates.navHasTemplate, 'agent still no template nav after URL attempt')
  await gotoPath('/tickets')
  await delay(300)
  await waitFor(`location.pathname === '/agent'`)
  const agentBlockedTickets = await evaluate(collectShell)
  evidence.agentBlockedTickets = { pathname: agentBlockedTickets.pathname }
  assert(agentBlockedTickets.pathname === '/agent', 'agent cannot use /tickets', agentBlockedTickets.pathname)

  await clickLogout()
  await loginAs('admin', DEMO_PASS)
  await waitFor(`location.pathname === '/knowledge' && document.querySelector('.session .user')`)
  const adminHome = await evaluate(collectShell)
  evidence.adminHome = adminHome
  evidence.adminKnowledgeShot = await screenshot('t029-admin-knowledge.png')
  assert(adminHome.pathname === '/knowledge', 'admin lands /knowledge', adminHome.pathname)
  assert((adminHome.topbarUser || '').includes('admin'), 'admin username', adminHome.topbarUser)
  assert((adminHome.topbarUser || '').includes('[Mock]'), 'admin mock username', adminHome.topbarUser)
  assert(adminHome.hasLogout, 'admin logout')
  assert(adminHome.navHasKnowledge && adminHome.navHasTickets && adminHome.navHasTemplate, 'admin nav entries', adminHome.nav)

  await clickNav('工单列表')
  await waitFor(`location.pathname === '/tickets'`)
  const adminTickets = await evaluate(collectShell)
  evidence.adminTickets = adminTickets
  evidence.adminTicketsShot = await screenshot('t029-admin-tickets.png')
  assert(adminTickets.pathname === '/tickets', 'admin tickets path', adminTickets.pathname)
  assert(adminTickets.mainHeadings.some((h) => h.includes('工单列表')), 'tickets placeholder heading', adminTickets.mainHeadings)
  assert(adminTickets.mainHeadings.some((h) => h.includes('[Mock]')), 'tickets mock mark', adminTickets.mainHeadings)

  await clickNav('模板')
  await waitFor(`location.pathname === '/templates'`)
  const adminTemplates = await evaluate(collectShell)
  evidence.adminTemplates = adminTemplates
  evidence.adminTemplatesShot = await screenshot('t029-admin-templates.png')
  assert(adminTemplates.pathname === '/templates', 'admin templates path', adminTemplates.pathname)
  assert(adminTemplates.mainHeadings.some((h) => /模板/.test(h)), 'templates placeholder heading', adminTemplates.mainHeadings)
  assert(adminTemplates.mainHeadings.some((h) => h.includes('[Mock]')), 'templates mock mark', adminTemplates.mainHeadings)
  assert(/灰度/.test(adminTemplates.mainText) || /模板/.test(adminTemplates.mainText), 'templates placeholder mentions admin config')

  await gotoPath('/employee')
  await delay(300)
  await waitFor(`location.pathname === '/knowledge' || location.pathname === '/templates'`)
  const adminBlockedEmployee = await evaluate(collectShell)
  evidence.adminBlockedEmployee = { pathname: adminBlockedEmployee.pathname }
  assert(
    adminBlockedEmployee.pathname !== '/employee',
    'admin cannot use employee chat',
    adminBlockedEmployee.pathname,
  )

  await clickLogout()
  await loginAs('it-help', DEMO_PASS)
  await waitFor(`location.pathname === '/employee' && document.querySelector('.session .user')`)
  const legacyHelp = await evaluate(collectShell)
  evidence.legacyHelp = {
    pathname: legacyHelp.pathname,
    topbarUser: legacyHelp.topbarUser,
  }
  evidence.legacyHelpShot = await screenshot('t029-it-help.png')
  assert(legacyHelp.pathname === '/employee', 'legacy it-help is employee', legacyHelp.pathname)
  assert((legacyHelp.topbarUser || '').includes('it-help'), 'legacy username', legacyHelp.topbarUser)

  await writeFile(path.join(OUT_DIR, 't029-browser-evidence.json'), JSON.stringify(evidence, null, 2), 'utf8')
  console.log('T029_BROWSER_PASS')
  console.log(JSON.stringify({ checks: Object.keys(evidence), shots: [
    evidence.loginOpenShot,
    evidence.wrongPassShot,
    evidence.employeeShot,
    evidence.agentShot,
    evidence.adminKnowledgeShot,
    evidence.adminTicketsShot,
    evidence.adminTemplatesShot,
    evidence.legacyHelpShot,
  ] }, null, 2))
}

main()
  .catch(async (err) => {
    console.error(err)
    try {
      await screenshot('t029-failure.png')
    } catch {}
    process.exitCode = 1
  })
  .finally(() => {
    try { ws?.close() } catch {}
    try { chromeProc?.kill() } catch {}
  })
