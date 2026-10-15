import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const BASE = process.env.T033_BASE || 'http://127.0.0.1:5293'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT_DIR = path.resolve(
  'C:\\Users\\慈海客服\\Desktop\\demo\\Develop_Helper\\Projects_Repo\\Customer_Service\\.sdd\\test-reports',
)
const CDP_PORT = Number(process.env.T033_CDP_PORT || 9473)
const ADMIN_USER = process.env.T033_ADMIN_USER || 'admin'
const AGENT_USER = process.env.T033_AGENT_USER || 'agent'
const DEMO_PASS = process.env.T033_DEMO_PASS || ''
const EMPTY_TEXT = '当前没有符合条件的工单'
const WARNING_RGB = 'rgb(180, 83, 9)'
const DANGER_RGB = 'rgb(180, 35, 24)'
const PRIMARY_SUBTLE = 'rgb(232, 241, 250)'

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
    }, 25000)
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

function assert(cond, label, extra) {
  if (!cond) {
    const detail = extra === undefined ? '' : ` ${JSON.stringify(extra)}`
    throw new Error(`ASSERT FAIL: ${label}${detail}`)
  }
}

const COLLECT_PAGE = `(() => {
  const bodyText = document.body.innerText || ''
  const labels = [...document.querySelectorAll('.tickets-filters label')].map((el) =>
    (el.childNodes[0]?.textContent || '').trim(),
  )
  const statusBtns = [...document.querySelectorAll('.tickets-status button')].map((el) => ({
    text: (el.textContent || '').trim(),
    pressed: el.getAttribute('aria-pressed'),
  }))
  const head = [...document.querySelectorAll('.tickets-head-row span')].map((el) => (el.textContent || '').trim())
  const rows = [...document.querySelectorAll('button.tickets-row:not(.tickets-head-row)')].map((el) => {
    const cells = [...el.querySelectorAll(':scope > span')].map((span) => (span.textContent || '').trim())
    const urgencyEl = el.querySelectorAll(':scope > span')[2]
    const cs = getComputedStyle(el)
    const urgencyCs = urgencyEl ? getComputedStyle(urgencyEl) : null
    return {
      ticketNo: cells[0] || '',
      type: cells[1] || '',
      urgency: cells[2] || '',
      status: cells[3] || '',
      assignee: cells[4] || '',
      updated: cells[5] || '',
      classes: [...el.classList],
      selected: el.classList.contains('selected') || el.getAttribute('aria-pressed') === 'true',
      bg: cs.backgroundColor,
      urgencyColor: urgencyCs?.color ?? null,
      urgencyClass: urgencyEl?.className ?? '',
    }
  })
  const empty = document.querySelector('.tickets-empty')
  const detail = document.querySelector('.tickets-detail')
  const actions = detail
    ? [...detail.querySelectorAll('.tickets-actions button')].map((el) => (el.textContent || '').trim())
    : []
  const progress = detail
    ? [...detail.querySelectorAll('.tickets-progress li')].map((el) => (el.textContent || '').replace(/\\s+/g, ' ').trim())
    : []
  const nav = [...document.querySelectorAll('.sidebar a')].map((el) => ({
    text: (el.textContent || '').trim(),
    href: el.getAttribute('href'),
  }))
  return {
    href: location.href,
    pathname: location.pathname,
    title: document.querySelector('.tickets-head h1')?.textContent ?? null,
    pageName: document.querySelector('.page-name')?.textContent ?? null,
    user: document.querySelector('.session .user')?.textContent ?? null,
    mock: bodyText.includes('[Mock]'),
    labels,
    statusBtns,
    head,
    rows,
    statuses: [...new Set(rows.map((row) => row.status))],
    empty: empty?.textContent?.trim() ?? null,
    emptyVisible: Boolean(empty),
    tableVisible: Boolean(document.querySelector('.tickets-table')),
    detailTitle: detail?.querySelector('h2')?.textContent?.trim() ?? null,
    detailText: detail ? (detail.innerText || '').replace(/\\s+/g, ' ').trim() : null,
    actions,
    progress,
    hasTemplateEditor: /保存新版本|评测集|灰度发布/.test(bodyText),
    nav,
    navHasTickets: nav.some((item) => item.text === '工单列表' || item.href === '/tickets'),
    error: document.querySelector('.error-text')?.textContent ?? null,
  }
})()`

async function main() {
  if (!DEMO_PASS) throw new Error('missing T033_DEMO_PASS')
  await mkdir(OUT_DIR, { recursive: true })
  const userData = await mkdtemp(path.join(os.tmpdir(), 't033-chrome-'))
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
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      const item = pending.get(msg.id)
      pending.delete(msg.id)
      clearTimeout(item.timer)
      if (msg.error) item.reject(new Error(`${msg.error.message || JSON.stringify(msg.error)}`))
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
    await Promise.race([send('Page.loadEventFired').catch(() => null), delay(4000)])
    await nav
  }

  async function login(username) {
    await goto(`${BASE}/login`)
    await waitFor(`document.querySelector('.login-card')`, 10000)
    await evaluate(fillScript('#user', username))
    await evaluate(fillScript('#pass', DEMO_PASS))
    await evaluate(`document.querySelector('button[type="submit"]').click()`)
    await waitFor(`location.pathname !== '/login'`, 10000)
    return evaluate(`({
      pathname: location.pathname,
      user: document.querySelector('.session .user')?.textContent ?? null,
    })`)
  }

  async function logout() {
    await evaluate(`(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '退出')
      if (!btn) throw new Error('missing logout')
      btn.click()
      return true
    })()`)
    await waitFor(`document.querySelector('.login-card')`, 10000)
  }

  async function openTickets() {
    await evaluate(`(() => {
      const link = [...document.querySelectorAll('.sidebar a')].find((el) => (el.textContent || '').trim() === '工单列表')
      if (!link) throw new Error('missing tickets nav')
      link.click()
      return true
    })()`)
    await waitFor(`location.pathname === '/tickets' && document.querySelector('.tickets-page')`, 10000)
    await waitFor(
      `(document.querySelectorAll('button.tickets-row:not(.tickets-head-row)').length > 0) || Boolean(document.querySelector('.tickets-empty'))`,
      10000,
    )
  }

  async function setLabeled(labelText, value, tag = 'input') {
    return evaluate(`(() => {
      const label = [...document.querySelectorAll('.tickets-filters label')].find((el) =>
        (el.childNodes[0]?.textContent || '').trim() === ${JSON.stringify(labelText)},
      )
      if (!label) throw new Error('missing label ' + ${JSON.stringify(labelText)})
      const el = label.querySelector(${JSON.stringify(tag)})
      if (!el) throw new Error('missing control for ' + ${JSON.stringify(labelText)})
      const proto = ${JSON.stringify(tag)} === 'select' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
      const desc = Object.getOwnPropertyDescriptor(proto, 'value')
      desc.set.call(el, ${JSON.stringify(value)})
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return el.value
    })()`)
  }

  async function clickFilter() {
    await evaluate(`document.querySelector('.tickets-filter-actions .btn-primary').click()`)
    await delay(250)
    await waitFor(`!document.querySelector('.tickets-filter-actions .btn-primary')?.disabled`, 8000)
  }

  async function clickReset() {
    await evaluate(`document.querySelector('.tickets-filter-actions .btn-secondary').click()`)
    await delay(250)
    await waitFor(`document.querySelectorAll('button.tickets-row:not(.tickets-head-row)').length > 0`, 8000)
  }

  async function clickStatus(label) {
    await evaluate(`(() => {
      const btn = [...document.querySelectorAll('.tickets-status button')].find((el) => (el.textContent || '').trim() === ${JSON.stringify(label)})
      if (!btn) throw new Error('missing status ' + ${JSON.stringify(label)})
      btn.click()
      return true
    })()`)
    await delay(250)
  }

  async function clickRowContaining(text) {
    await evaluate(`(() => {
      const row = [...document.querySelectorAll('button.tickets-row:not(.tickets-head-row)')].find((el) =>
        (el.textContent || '').includes(${JSON.stringify(text)}),
      )
      if (!row) throw new Error('missing row ' + ${JSON.stringify(text)})
      row.click()
      return (row.textContent || '').replace(/\\s+/g, ' ').trim()
    })()`)
    await waitFor(`document.querySelector('.tickets-detail h2')`, 8000)
    await delay(200)
  }

  const evidence = {
    mock: true,
    base: BASE,
    viewport: '1440x900',
    cdpPort: CDP_PORT,
    chrome: version.Browser,
    userDataDir: userData,
    adminUser: ADMIN_USER,
    agentUser: AGENT_USER,
    steps: {},
    failed: [],
  }

  function record(id, cond, extra) {
    try {
      assert(cond, id, extra)
    } catch (err) {
      evidence.failed.push({ id, error: String(err.message), extra })
    }
  }

  try {
    const health = await fetch(BASE)
    evidence.viteStatus = health.status
    record('vite-200', health.status === 200, health.status)

    const adminLogin = await login(ADMIN_USER)
    evidence.steps.adminLogin = adminLogin
    record('admin-login-not-tickets-home', adminLogin.pathname === '/knowledge' || adminLogin.pathname === '/tickets', adminLogin)
    await openTickets()
    const initial = await evaluate(COLLECT_PAGE)
    evidence.steps.initial = {
      pathname: initial.pathname,
      title: initial.title,
      labels: initial.labels,
      statusBtns: initial.statusBtns.map((item) => item.text),
      head: initial.head,
      rowCount: initial.rows.length,
      statuses: initial.statuses,
      mock: initial.mock,
      nav: initial.nav,
      hasTemplateEditor: initial.hasTemplateEditor,
    }
    evidence.listShot = await screenshot('t033-admin-list.png')
    record('admin-on-tickets', initial.pathname === '/tickets', initial.pathname)
    record('admin-username', /admin/.test(initial.user || ''), initial.user)
    record('mock-label', initial.mock === true && /\[Mock\]/.test(initial.title || ''), initial.title)
    record(
      'filters-visible',
      initial.labels.includes('类型') &&
        initial.labels.includes('紧急程度') &&
        initial.labels.includes('订单号') &&
        initial.labels.includes('用户') &&
        initial.labels.includes('工单号') &&
        initial.labels.includes('开始时间') &&
        initial.labels.includes('结束时间') &&
        initial.statusBtns.some((item) => item.text === '待处理') &&
        initial.statusBtns.some((item) => item.text === '处理中') &&
        initial.statusBtns.some((item) => item.text === '挂起') &&
        initial.statusBtns.some((item) => item.text === '已完成') &&
        initial.statusBtns.some((item) => item.text === '已关闭'),
      { labels: initial.labels, status: initial.statusBtns },
    )
    record(
      'table-columns',
      initial.head.includes('工单号') &&
        initial.head.includes('类型') &&
        initial.head.includes('紧急程度') &&
        initial.head.includes('状态') &&
        initial.head.includes('处理人') &&
        initial.head.includes('更新时间'),
      initial.head,
    )
    record(
      'five-statuses',
      ['待处理', '处理中', '挂起', '已完成', '已关闭'].every((status) => initial.statuses.includes(status)),
      initial.statuses,
    )
    record('no-template-editor', initial.hasTemplateEditor === false, initial.hasTemplateEditor)

    const vip = initial.rows.find((row) => row.urgency === 'VIP')
    const highRisk = initial.rows.find((row) => row.urgency === '高风险' && !row.selected)
    const highRiskAny = initial.rows.find((row) => row.urgency === '高风险')
    evidence.steps.visual = {
      vip,
      highRisk,
      highRiskAny,
    }
    record('vip-row-exists', Boolean(vip), vip)
    record(
      'vip-warning-tint',
      Boolean(vip && /180,\s*83,\s*9/.test(vip.bg) && vip.bg !== DANGER_RGB && vip.bg !== 'rgb(180, 35, 24)'),
      vip,
    )
    record('high-risk-exists', Boolean(highRiskAny), highRiskAny)
    record(
      'high-risk-danger-text',
      Boolean(
        highRiskAny &&
          highRiskAny.urgencyColor === DANGER_RGB &&
          highRiskAny.urgencyClass.includes('danger-text'),
      ),
      highRiskAny,
    )
    const highRiskBgTarget = highRisk || highRiskAny
    record(
      'high-risk-not-full-red-row',
      Boolean(
        highRiskBgTarget &&
          highRiskBgTarget.bg !== DANGER_RGB &&
          !/^rgb\(\s*180,\s*35,\s*24\s*\)$/.test(highRiskBgTarget.bg) &&
          !/180,\s*35,\s*24/.test(highRiskBgTarget.bg),
      ),
      highRiskBgTarget,
    )
    record(
      'high-risk-selected-not-danger-bg',
      !highRiskAny?.selected || highRiskAny.bg === PRIMARY_SUBTLE || !/180,\s*35,\s*24/.test(highRiskAny.bg),
      highRiskAny,
    )

    await clickRowContaining('TKT-20260921-H006')
    const warehouse = await evaluate(COLLECT_PAGE)
    evidence.steps.warehouseProgress = {
      detailTitle: warehouse.detailTitle,
      progress: warehouse.progress,
      detailText: warehouse.detailText,
      hasTemplateEditor: warehouse.hasTemplateEditor,
    }
    evidence.progressShot = await screenshot('t033-readonly-progress.png')
    record('readonly-progress-title', warehouse.detailTitle === '只读进度', warehouse.detailTitle)
    record(
      'warehouse-progress-visible',
      (warehouse.progress || []).some((item) => /仓储|退货/.test(item)),
      warehouse.progress,
    )
    record('progress-no-template', warehouse.hasTemplateEditor === false, warehouse.hasTemplateEditor)

    await clickRowContaining('TKT-20260922-V003')
    const finance = await evaluate(COLLECT_PAGE)
    evidence.steps.financeProgress = {
      progress: finance.progress,
      detailText: finance.detailText,
    }
    record(
      'finance-progress-visible',
      (finance.progress || []).some((item) => /财务|开票/.test(item)),
      finance.progress,
    )

    await clickStatus('挂起')
    const holdFilter = await evaluate(COLLECT_PAGE)
    evidence.steps.statusHold = {
      statuses: holdFilter.statuses,
      count: holdFilter.rows.length,
      empty: holdFilter.empty,
    }
    record(
      'status-hold-only',
      holdFilter.rows.length > 0 && holdFilter.statuses.every((status) => status === '挂起'),
      holdFilter.statuses,
    )
    await clickStatus('全部')
    await waitFor(`document.querySelectorAll('button.tickets-row:not(.tickets-head-row)').length > 2`, 8000)

    await setLabeled('类型', 'return_exchange', 'select')
    await clickFilter()
    const typeFilter = await evaluate(COLLECT_PAGE)
    evidence.steps.typeReturn = {
      types: typeFilter.rows.map((row) => row.type),
      count: typeFilter.rows.length,
    }
    record(
      'type-return-only',
      typeFilter.rows.length > 0 && typeFilter.rows.every((row) => row.type === '退换货'),
      typeFilter.rows.map((row) => row.type),
    )
    await clickReset()

    await setLabeled('紧急程度', 'vip', 'select')
    await clickFilter()
    const urgencyFilter = await evaluate(COLLECT_PAGE)
    evidence.steps.urgencyVip = {
      urgencies: urgencyFilter.rows.map((row) => row.urgency),
      count: urgencyFilter.rows.length,
    }
    record(
      'urgency-vip-only',
      urgencyFilter.rows.length > 0 && urgencyFilter.rows.every((row) => row.urgency === 'VIP'),
      urgencyFilter.rows.map((row) => row.urgency),
    )
    await clickReset()

    await setLabeled('订单号', 'AP20260922021')
    await clickFilter()
    const orderFilter = await evaluate(COLLECT_PAGE)
    evidence.steps.orderNo = {
      count: orderFilter.rows.length,
      tickets: orderFilter.rows.map((row) => row.ticketNo),
      detail: orderFilter.detailText,
    }
    record(
      'order-no-match',
      orderFilter.rows.length === 1 && /A002/.test(orderFilter.rows[0].ticketNo),
      orderFilter.rows,
    )
    await clickReset()

    await setLabeled('用户', '李芳')
    await clickFilter()
    const userFilter = await evaluate(COLLECT_PAGE)
    evidence.steps.userQuery = {
      count: userFilter.rows.length,
      tickets: userFilter.rows.map((row) => row.ticketNo),
      detail: userFilter.detailText,
    }
    record(
      'user-query-match',
      userFilter.rows.length === 1 && /李芳/.test(userFilter.detailText || ''),
      { count: userFilter.rows.length, detail: userFilter.detailText },
    )
    await clickReset()

    await setLabeled('工单号', 'TKT-20260922-A002')
    await clickFilter()
    const ticketFilter = await evaluate(COLLECT_PAGE)
    evidence.steps.ticketNo = {
      count: ticketFilter.rows.length,
      tickets: ticketFilter.rows.map((row) => row.ticketNo),
    }
    record(
      'ticket-no-match',
      ticketFilter.rows.length === 1 && /A002/.test(ticketFilter.rows[0].ticketNo),
      ticketFilter.rows,
    )
    await clickReset()

    await setLabeled('开始时间', '2026-09-23T00:00')
    await setLabeled('结束时间', '2026-09-23T23:59')
    await clickFilter()
    const timeFilter = await evaluate(COLLECT_PAGE)
    evidence.steps.timeRange = {
      count: timeFilter.rows.length,
      tickets: timeFilter.rows.map((row) => row.ticketNo),
      statuses: timeFilter.statuses,
    }
    record(
      'time-range-sep23',
      timeFilter.rows.length >= 1 &&
        timeFilter.rows.every((row) => /20260923/.test(row.ticketNo)) &&
        !timeFilter.rows.some((row) => /2026092[012]/.test(row.ticketNo.replace(/\[Mock\]\s*/, ''))),
      timeFilter.rows.map((row) => row.ticketNo),
    )
    await clickReset()

    await setLabeled('工单号', 'NO-SUCH')
    await clickFilter()
    await waitFor(`Boolean(document.querySelector('.tickets-empty'))`, 8000)
    const emptyState = await evaluate(COLLECT_PAGE)
    evidence.steps.empty = {
      empty: emptyState.empty,
      tableVisible: emptyState.tableVisible,
      rowCount: emptyState.rows.length,
    }
    evidence.emptyShot = await screenshot('t033-empty.png')
    record('empty-text-exact', emptyState.empty === EMPTY_TEXT, emptyState.empty)
    record('empty-hides-table', emptyState.tableVisible === false && emptyState.rows.length === 0, emptyState)

    await clickReset()
    await logout()
    const agentLogin = await login(AGENT_USER)
    evidence.steps.agentLogin = agentLogin
    record('agent-home-agent', agentLogin.pathname === '/agent', agentLogin)

    await goto(`${BASE}/tickets`)
    await delay(400)
    await waitFor(`location.pathname !== '/tickets'`, 8000)
    const agentBlocked = await evaluate(COLLECT_PAGE)
    evidence.steps.agentBlocked = {
      pathname: agentBlocked.pathname,
      nav: agentBlocked.nav,
      navHasTickets: agentBlocked.navHasTickets,
      tableVisible: agentBlocked.tableVisible,
    }
    evidence.agentShot = await screenshot('t033-agent-blocked.png')
    record('agent-not-on-tickets', agentBlocked.pathname === '/agent', agentBlocked.pathname)
    record('agent-no-tickets-nav', agentBlocked.navHasTickets === false, agentBlocked.nav)
    record('agent-no-table', agentBlocked.tableVisible === false, agentBlocked.tableVisible)
  } finally {
    await writeFile(path.join(OUT_DIR, 't033-browser-evidence.json'), JSON.stringify(evidence, null, 2), 'utf8')
    try {
      ws?.close()
    } catch {
      // ignore
    }
    if (chromeProc?.pid) {
      try {
        process.kill(chromeProc.pid)
      } catch {
        // ignore
      }
    }
  }

  if (evidence.failed.length) {
    console.error(JSON.stringify({ ok: false, failed: evidence.failed, steps: Object.keys(evidence.steps) }, null, 2))
    process.exit(1)
  }
  console.log(JSON.stringify({ ok: true, steps: Object.keys(evidence.steps), shots: [evidence.listShot, evidence.progressShot, evidence.emptyShot, evidence.agentShot] }, null, 2))
}

main().catch((err) => {
  console.error(String(err && err.stack ? err.stack : err))
  try {
    if (chromeProc?.pid) process.kill(chromeProc.pid)
  } catch {
    // ignore
  }
  process.exit(1)
})
