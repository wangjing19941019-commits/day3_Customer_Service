import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const BASE = process.env.T035_BASE || 'http://127.0.0.1:5199'
const CHROME = process.env.T035_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT_DIR = path.resolve(
  'C:\\Users\\慈海客服\\Desktop\\demo\\Develop_Helper\\Projects_Repo\\Customer_Service\\.sdd\\test-reports',
)
const CDP_PORT = Number(process.env.T035_CDP_PORT || 9495)
const EMPLOYEE_USER = 'employee'
const AGENT_USER = 'agent'
const ADMIN_USER = 'admin'
const DEMO_PASS = process.env.T035_DEMO_PASS || ''
const AGENT_PUSH = '签收后七日内可无理由退货，吊牌完整'
const AGENT_ONLY_3C = '以签收后的保修说明为准'

let chromeProc
let ws
let sessionId
let msgId = 0
const pending = new Map()
const checks = []
const failed = []

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
    await delay(150)
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

const COLLECT_WORKBENCH = `(() => {
  const work = document.querySelector('.agent-work')
  const type = document.getElementById('agent-ticket-type')
  const line = document.getElementById('agent-business-line')
  const confirm = document.querySelector('.confirm-ticket')
  const thread = document.querySelector('.agent-thread')
  const list = document.querySelector('.agent-list')
  const composer = document.querySelector('.agent-composer')
  const fields = [...document.querySelectorAll('.agent-work .field')].map((field) => {
    const label = field.querySelector('label')?.textContent?.trim() ?? ''
    const control = field.querySelector('input:not([type="file"]):not([type="radio"]), select, textarea')
    const status = field.querySelector('.field-status')
    const statusCs = status ? getComputedStyle(status) : null
    const candidates = [...field.querySelectorAll('.candidate-list button')].map((btn) => ({
      text: (btn.textContent || '').replace(/\\s+/g, ' ').trim(),
      pressed: btn.getAttribute('aria-pressed'),
    }))
    const conflict = field.querySelector('.conflict-row')?.innerText?.replace(/\\s+/g, ' ').trim() ?? null
    return {
      id: control?.id || '',
      label,
      value: control ? control.value : null,
      status: status?.innerText?.replace(/\\s+/g, ' ').trim() ?? null,
      statusColor: statusCs?.color ?? null,
      candidates,
      conflict,
    }
  })
  const polish = document.querySelector('.polish-compare') || document.querySelector('.polish-risk')
  const knowledge = [...document.querySelectorAll('.knowledge-card')].map((card) =>
    (card.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 220),
  )
  const workRect = work?.getBoundingClientRect()
  const threadRect = thread?.getBoundingClientRect()
  const listRect = list?.getBoundingClientRect()
  const composerRect = composer?.getBoundingClientRect()
  return {
    pathname: location.pathname,
    nav: [...document.querySelectorAll('nav a, .nav a, aside a, .sidebar a')].map((a) =>
      (a.textContent || '').replace(/\\s+/g, ' ').trim(),
    ),
    header: document.querySelector('.session .user')?.textContent ?? document.querySelector('.user')?.textContent ?? null,
    mock: (document.body.innerText || '').includes('[Mock]'),
    typeValue: type?.value ?? null,
    typeDisabled: type ? type.disabled : null,
    typeOptions: type ? [...type.options].map((opt) => opt.textContent.trim()) : [],
    lineValue: line?.value ?? null,
    confirmDisabled: confirm ? confirm.disabled : null,
    confirmText: confirm?.textContent?.trim() ?? null,
    extracting: Boolean(document.querySelector('.extract-banner')),
    extractText: document.querySelector('.extract-banner')?.textContent?.trim() ?? null,
    sendUser: [...document.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === '发给用户'),
    saveTemplate: /保存新版本|编辑模板|灰度/.test(work?.innerText || ''),
    fields,
    knowledge,
    hasApparelPush: knowledge.some((text) => text.includes(${JSON.stringify(AGENT_PUSH)})),
    polish: polish
      ? {
          text: (polish.innerText || '').replace(/\\s+/g, ' ').trim(),
          hasAdopt: [...document.querySelectorAll('.polish-compare button, .polish-risk button, .polish-actions button')].some(
            (b) => (b.textContent || '').trim() === '采用',
          ),
          risk: document.querySelector('.polish-risk')?.innerText?.replace(/\\s+/g, ' ').trim() ?? null,
          riskColor: document.querySelector('.polish-risk')
            ? getComputedStyle(document.querySelector('.polish-risk')).color
            : null,
        }
      : null,
    layout: {
      flex: document.querySelector('.agent-inbox')
        ? getComputedStyle(document.querySelector('.agent-inbox')).flexDirection
        : null,
      listWidth: listRect ? Math.round(listRect.width) : null,
      listHeight: listRect ? Math.round(listRect.height) : null,
      listHeightRatio: listRect ? Number((listRect.height / window.innerHeight).toFixed(2)) : null,
      workWidth: workRect ? Math.round(workRect.width) : null,
      workTop: workRect ? Math.round(workRect.top) : null,
      threadBottom: threadRect ? Math.round(threadRect.bottom) : null,
      workBelowThread: Boolean(workRect && threadRect && workRect.top >= threadRect.bottom - 4),
      pinGap: composerRect ? Math.round(window.innerHeight - composerRect.bottom) : null,
      sameRowPrimary: (() => {
        const confirmBtn = document.querySelector('.confirm-ticket')
        const sendBtn = document.querySelector('.agent-composer .btn-primary')
        if (!confirmBtn || !sendBtn) return false
        const a = confirmBtn.getBoundingClientRect()
        const b = sendBtn.getBoundingClientRect()
        return Math.abs(a.top - b.top) < 8 && confirmBtn.classList.contains('btn-primary') && sendBtn.classList.contains('btn-primary')
      })(),
    },
  }
})()`

function fieldByLabel(state, label) {
  return (state.fields || []).find((item) => (item.label || '').includes(label))
}

async function main() {
  if (!DEMO_PASS) throw new Error('missing T035_DEMO_PASS')
  await mkdir(OUT_DIR, { recursive: true })
  const userData = await mkdtemp(path.join(os.tmpdir(), 't035-chrome-'))
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
      user: document.querySelector('.session .user')?.textContent
        ?? document.querySelector('.user')?.textContent
        ?? null,
      nav: [...document.querySelectorAll('nav a, .nav a, aside a, .sidebar a')].map((a) =>
        (a.textContent || '').replace(/\\s+/g, ' ').trim(),
      ),
      mock: (document.body.innerText || '').includes('[Mock]'),
    })`)
  }

  async function logout() {
    await waitFor(
      `Boolean([...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '退出'))`,
      10000,
    )
    await evaluate(`(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '退出')
      if (!btn) throw new Error('missing logout')
      btn.click()
      return true
    })()`)
    await waitFor(`document.querySelector('.login-card')`, 10000)
  }

  async function employeeSend(text) {
    await waitFor(`document.querySelector('.employee-composer textarea:not([disabled])')`, 10000)
    await evaluate(fillScript('.employee-composer textarea', text))
    await evaluate(`document.querySelector('.employee-composer button[type="submit"]').click()`)
    await waitFor(`(document.querySelector('.employee-composer textarea')?.value || '') === ''`, 10000)
  }

  async function employeeTransfer() {
    await evaluate(`(() => {
      const btn = [...document.querySelectorAll('.employee-status button')].find(Boolean)
      if (!btn) throw new Error('missing transfer')
      btn.click()
      return true
    })()`)
    await waitFor(`(document.body.innerText || '').includes('已转人工')`, 10000)
  }

  async function setSelect(id, value) {
    await evaluate(`(() => {
      const el = document.getElementById(${JSON.stringify(id)})
      if (!el) throw new Error('missing ' + ${JSON.stringify(id)})
      el.value = ${JSON.stringify(value)}
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return el.value
    })()`)
  }

  async function waitExtractIdle(timeoutMs = 15000) {
    const start = Date.now()
    let sawExtracting = false
    let last
    while (Date.now() - start < timeoutMs) {
      last = await evaluate(COLLECT_WORKBENCH)
      if (last.extracting) sawExtracting = true
      if (last.fields?.length && !last.extracting && (sawExtracting || Date.now() - start > 2500)) {
        await delay(300)
        return evaluate(COLLECT_WORKBENCH)
      }
      await delay(200)
    }
    return last ?? evaluate(COLLECT_WORKBENCH)
  }

  async function setViewport(width, height) {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await delay(400)
  }

  const evidence = {
    mock: true,
    base: BASE,
    viewport: '1440x900',
    cdpPort: CDP_PORT,
    chrome: version.Browser,
    userDataDir: userData,
    steps: {},
    failed,
    checks,
  }

  try {
    const health = await fetch(BASE)
    evidence.viteStatus = health.status
    record('vite-200', health.status === 200, 200, health.status)

    await goto(`${BASE}/login`)
    await waitFor(`document.querySelector('.login-card')`, 10000)

    const envelope = await evaluate(`(async () => {
      const { okEnvelope, failEnvelope } = await import('/src/mocks/conversationStore.ts')
      const ok = okEnvelope({ ping: 1 })
      const fail = failEnvelope('x', 'VALIDATION_ERROR')
      const keys = ['success', 'data', 'error', 'error_code', 'message', 'timestamp', 'request_id', 'metadata']
      const okKeys = keys.every((k) => Object.prototype.hasOwnProperty.call(ok, k))
      const failKeys = keys.every((k) => Object.prototype.hasOwnProperty.call(fail, k))
      const extraOk = Object.keys(ok).filter((k) => !keys.includes(k))
      const { isMockEnabled } = await import('/src/utils/mockFlag.ts')
      return {
        mockEnv: isMockEnabled(),
        okKeys,
        failKeys,
        extraOk,
        okSuccess: ok.success === true && ok.error === null && ok.error_code === null && ok.data?.ping === 1,
        failShape: fail.success === false && fail.data === null && fail.error === 'x' && fail.error_code === 'VALIDATION_ERROR',
      }
    })()`)
    evidence.steps.envelope = envelope
    record('envelope-ok', envelope.okKeys && envelope.okSuccess && envelope.extraOk.length === 0, '§二 成功信封', envelope)
    record('envelope-fail', envelope.failKeys && envelope.failShape, '§二 失败信封', envelope)
    record('vite-mock-true', envelope.mockEnv === 'true' || envelope.mockEnv === true, 'VITE_USE_MOCK=true', envelope.mockEnv)

    const emp = await login(EMPLOYEE_USER)
    evidence.steps.employeeLogin = emp
    await screenshot('t035-employee.png')
    record('employee-home', emp.pathname === '/employee', '/employee', emp)
    record('employee-nav', emp.nav.includes('员工端') && !emp.nav.some((t) => /模板|工单列表|知识库/.test(t)), '仅员工端', emp.nav)
    record('employee-mock', emp.mock === true && /\[Mock\]/.test(emp.user || ''), '[Mock] employee', emp.user)

    await employeeSend('找客服')
    await employeeTransfer()
    await employeeSend('昨天有两笔蓝色手机要退')
    evidence.steps.afterTransfer = await evaluate(`({
      status: document.querySelector('.employee-status-text')?.textContent?.trim() ?? null,
      transferDisabled: document.querySelector('.employee-status button')?.disabled ?? null,
    })`)
    record(
      'employee-handoff',
      /已转人工/.test(evidence.steps.afterTransfer.status || '') && evidence.steps.afterTransfer.transferDisabled === true,
      '已转人工且按钮禁用',
      evidence.steps.afterTransfer,
    )

    await logout()
    const agent = await login(AGENT_USER)
    evidence.steps.agentLogin = agent
    record('agent-home', agent.pathname === '/agent', '/agent', agent)
    record(
      'agent-no-template',
      agent.nav.includes('客服端') && !agent.nav.some((t) => /模板|灰度|工单列表|知识库/.test(t)),
      '侧栏无模板',
      agent.nav,
    )
    await waitFor(`Boolean(document.querySelector('.agent-row') || document.getElementById('agent-ticket-type'))`, 10000)
    if (!(await evaluate(`Boolean(document.getElementById('agent-ticket-type'))`))) {
      await evaluate(`document.querySelector('.agent-row')?.click()`)
      await waitFor(`document.getElementById('agent-ticket-type')`, 10000)
    }
    const beforeType = await evaluate(COLLECT_WORKBENCH)
    evidence.steps.beforeType = {
      typeValue: beforeType.typeValue,
      confirmDisabled: beforeType.confirmDisabled,
      typeOptions: beforeType.typeOptions,
      mock: beforeType.mock,
      nav: beforeType.nav,
    }
    await screenshot('t035-agent-no-type.png')
    record('confirm-disabled-no-type', beforeType.confirmDisabled === true, true, beforeType.confirmDisabled)
    record(
      'six-types',
      ['退换货', '修改地址', '开发票', '投诉维权', '费用争议', '物流异常'].every((name) =>
        (beforeType.typeOptions || []).includes(name),
      ),
      '六类选项',
      beforeType.typeOptions,
    )

    await setSelect('agent-ticket-type', 'return_exchange')
    await setSelect('agent-business-line', 'digital_3c')
    const afterExtract = await waitExtractIdle(15000)
    const order = fieldByLabel(afterExtract, '订单号')
    evidence.steps.orderCandidates = {
      order,
      knowledge: afterExtract.knowledge,
      hasApparelPush: afterExtract.hasApparelPush,
      sendUser: afterExtract.sendUser,
      layout: afterExtract.layout,
      statuses: (afterExtract.fields || []).map((f) => ({ label: f.label, status: f.status, value: f.value })),
    }
    await screenshot('t035-order-candidates.png')
    record(
      'order-multi-no-preselect',
      !order?.value &&
        order?.status === '待确认' &&
        (order?.candidates || []).length >= 2 &&
        (order?.candidates || []).every((c) => c.pressed === 'false'),
      '多条候选不预选',
      order,
    )
    record('no-send-to-user', afterExtract.sendUser === false, false, afterExtract.sendUser)
    record(
      'agent-knowledge-push',
      (afterExtract.knowledge || []).some((text) => /保修说明|质保|签收后/.test(text)),
      '坐席知识卡片',
      afterExtract.knowledge,
    )
    record(
      'layout-1440',
      afterExtract.layout?.listWidth === 320 && afterExtract.layout?.workWidth === 360 && afterExtract.layout?.flex === 'row',
      '左320/右360',
      afterExtract.layout,
    )
    record('input-pin-1440', afterExtract.layout?.pinGap != null && afterExtract.layout.pinGap <= 24, '输入钉底', afterExtract.layout)
    record('confirm-send-not-same-row', afterExtract.layout?.sameRowPrimary === false, false, afterExtract.layout)

    await evaluate(fillScript('#agent-reply', '一定全额退，赔500元'))
    await evaluate(`(() => {
      const btn = [...document.querySelectorAll('.agent-composer button')].find((b) => (b.textContent || '').includes('润色'))
      if (!btn) throw new Error('missing polish')
      btn.click()
      return true
    })()`)
    await waitFor(`document.querySelector('.polish-risk')`, 10000)
    const polishBad = await evaluate(COLLECT_WORKBENCH)
    evidence.steps.polishBad = polishBad.polish
    await screenshot('t035-polish-risk.png')
    record(
      'polish-cannot-adopt',
      polishBad.polish?.hasAdopt === false && /不能直接采用/.test(polishBad.polish?.risk || polishBad.polish?.text || ''),
      '无采用 + 合规风险',
      polishBad.polish,
    )
    record('polish-danger', polishBad.polish?.riskColor === 'rgb(180, 35, 24)', '#B42318', polishBad.polish?.riskColor)

    await setViewport(900, 800)
    await delay(500)
    const narrow = await evaluate(COLLECT_WORKBENCH)
    evidence.steps.narrow = narrow.layout
    await screenshot('t035-narrow.png')
    record(
      'narrow-work-below',
      narrow.layout?.flex === 'column' && narrow.layout?.workBelowThread === true,
      '工作台在对话下方',
      narrow.layout,
    )
    record(
      'narrow-list-40vh',
      narrow.layout?.listHeightRatio != null && Math.abs(narrow.layout.listHeightRatio - 0.4) <= 0.05,
      '列表约 40vh',
      narrow.layout,
    )
    record(
      'narrow-pin',
      narrow.layout?.workBelowThread === true &&
        Math.abs((narrow.layout?.workTop ?? 0) - (narrow.layout?.threadBottom ?? 0)) <= 4,
      '窄屏输入在对话列底、工作台在下方',
      narrow.layout,
    )
    await setViewport(1440, 900)

    await logout()
    await login(EMPLOYEE_USER)
    const employeeAfter = await evaluate(`({
      pathname: location.pathname,
      body: (document.body.innerText || ''),
      others: [...document.querySelectorAll('.msg-other, .bubble-other, .chat-msg')].map((el) =>
        (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 160),
      ),
    })`)
    evidence.steps.employeeAfterPush = {
      pathname: employeeAfter.pathname,
      hasAgentPush: employeeAfter.body.includes(AGENT_PUSH) || employeeAfter.body.includes(AGENT_ONLY_3C),
      others: employeeAfter.others,
    }
    await screenshot('t035-employee-after-push.png')
    record(
      'knowledge-not-in-employee',
      employeeAfter.body.includes(AGENT_PUSH) === false &&
        employeeAfter.body.includes(AGENT_ONLY_3C) === false &&
        !(employeeAfter.others || []).some((text) => text.includes(AGENT_PUSH) || text.includes(AGENT_ONLY_3C)),
      '员工对话无坐席推送原文',
      evidence.steps.employeeAfterPush,
    )

    await logout()
    const admin = await login(ADMIN_USER)
    evidence.steps.adminLogin = admin
    await screenshot('t035-admin-knowledge.png')
    record('admin-home', admin.pathname === '/knowledge', '/knowledge', admin)
    record(
      'admin-nav',
      admin.nav.includes('知识库') && admin.nav.includes('工单列表') && admin.nav.includes('模板'),
      '三入口',
      admin.nav,
    )

    await waitFor(`document.querySelector('.kb-row')`, 10000)
    await evaluate(`(() => {
      const row = [...document.querySelectorAll('.kb-row')].find((el) =>
        (el.textContent || '').includes('服饰美妆常见问题.md'),
      )
      if (!row) throw new Error('missing ready doc')
      row.click()
      return true
    })()`)
    await waitFor(`document.querySelector('input[name="kb-visibility"]')`, 10000)
    const visibility = await evaluate(`({
      labels: [...document.querySelectorAll('input[name="kb-visibility"]')].map((el) => ({
        value: el.value,
        text: (el.parentElement?.textContent || '').replace(/\\s+/g, ' ').trim(),
        checked: el.checked,
      })),
      from: document.querySelector('input[aria-label="生效开始时间"]') != null,
      to: document.querySelector('input[aria-label="生效结束时间"]') != null,
      save: [...document.querySelectorAll('button')].some((b) => (b.textContent || '').includes('保存可见范围和生效时间')),
      saveClass: [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('保存可见范围'))?.className ?? null,
      enumLeak: /user_visible|agent_only|high_risk_human_only/.test(document.querySelector('.kb-fieldset')?.innerText || ''),
      mock: (document.body.innerText || '').includes('[Mock]'),
    })`)
    evidence.steps.visibility = visibility
    await screenshot('t035-visibility.png')
    record(
      'visibility-options',
      visibility.labels.some((x) => x.text.includes('用户可见')) &&
        visibility.labels.some((x) => x.text.includes('仅坐席可见')) &&
        visibility.labels.some((x) => x.text.includes('高风险仅人工')) &&
        visibility.from &&
        visibility.to &&
        visibility.save,
      '可见范围+生效时间',
      visibility,
    )
    record('visibility-no-enum', visibility.enumLeak === false, false, visibility.enumLeak)
    record('visibility-secondary', /btn-secondary/.test(visibility.saveClass || ''), '次按钮', visibility.saveClass)

    await evaluate(`(() => {
      const link = [...document.querySelectorAll('a')].find((a) => (a.textContent || '').includes('工单列表'))
      if (!link) throw new Error('missing tickets nav')
      link.click()
      return true
    })()`)
    await waitFor(`location.pathname === '/tickets'`, 10000)
    await waitFor(`document.querySelector('.tickets-table, .tickets-empty, form')`, 10000)
    const ticketsHome = await evaluate(`({
      pathname: location.pathname,
      title: document.querySelector('h1')?.textContent?.trim() ?? null,
      headers: [...document.querySelectorAll('.tickets-head-row span')].map((el) => el.textContent.trim()),
      overflow: {
        body: document.body.scrollWidth,
        inner: window.innerWidth,
        wrap: document.querySelector('.tickets-table-wrap')?.scrollWidth ?? null,
        wrapClient: document.querySelector('.tickets-table-wrap')?.clientWidth ?? null,
      },
      mock: (document.body.innerText || '').includes('[Mock]'),
    })`)
    evidence.steps.ticketsHome = ticketsHome
    await screenshot('t035-tickets.png')
    record('admin-tickets', ticketsHome.pathname === '/tickets' && /工单列表/.test(ticketsHome.title || ''), '/tickets', ticketsHome)
    record(
      'ticket-headers',
      ['工单号', '类型', '紧急程度', '状态', '处理人', '更新时间'].every((name) => ticketsHome.headers.includes(name)),
      '六列',
      ticketsHome.headers,
    )
    record(
      'tickets-no-overflow',
      ticketsHome.overflow.body <= ticketsHome.overflow.inner + 2,
      '无整页溢出',
      ticketsHome.overflow,
    )

    await evaluate(`(() => {
      const labels = [...document.querySelectorAll('label')]
      const lab = labels.find((el) => (el.childNodes[0]?.textContent || el.textContent || '').includes('工单号'))
      const input = lab?.querySelector('input')
      if (!input) throw new Error('missing ticket_no')
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
      desc.set.call(input, 'NO-SUCH')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      return input.value
    })()`)
    await evaluate(`(() => {
      const form = document.querySelector('form')
      const btn = [...form.querySelectorAll('button')].find((b) => (b.textContent || '').includes('筛选'))
      if (!btn) throw new Error('missing filter')
      btn.click()
      return true
    })()`)
    await waitFor(`document.querySelector('.tickets-empty')`, 10000)
    const emptySearch = await evaluate(`({
      empty: document.querySelector('.tickets-empty')?.textContent?.trim() ?? null,
      rows: document.querySelectorAll('.tickets-table tbody tr').length,
    })`)
    evidence.steps.emptySearch = emptySearch
    await screenshot('t035-tickets-empty.png')
    record(
      'tickets-empty-search',
      emptySearch.empty === '当前没有符合条件的工单' || emptySearch.empty === '[Mock] 当前没有符合条件的工单',
      '空搜文案',
      emptySearch,
    )

    await evaluate(`(() => {
      const link = [...document.querySelectorAll('a')].find((a) => (a.textContent || '').trim() === '模板')
      if (!link) throw new Error('missing templates nav')
      link.click()
      return true
    })()`)
    await waitFor(`location.pathname === '/templates'`, 10000)
    await waitFor(`document.querySelector('.tpl-list, .tpl-editor')`, 10000)
    if (!(await evaluate(`Boolean([...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('灰度约 5%')))`))) {
      await evaluate(`document.querySelector('.tpl-row')?.click()`)
      await waitFor(`Boolean([...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('灰度约 5%')))`, 10000)
    }
    const templates = await evaluate(`({
      pathname: location.pathname,
      title: document.querySelector('h1')?.textContent?.trim() ?? null,
      gray: (() => {
        const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('灰度约 5%'))
        return {
          text: btn?.textContent?.trim() ?? null,
          disabled: btn ? btn.disabled : null,
          className: btn?.className ?? null,
        }
      })(),
      reasons: [...document.querySelectorAll('p, .hint, .error-text')]
        .map((el) => el.textContent.trim())
        .filter((t) => /5000|不能开始灰度|不能灰度/.test(t)),
      primary: [...document.querySelectorAll('.tpl-editor .btn-primary')].map((b) => b.textContent.trim()),
      mock: (document.body.innerText || '').includes('[Mock]'),
    })`)
    evidence.steps.templates = templates
    await screenshot('t035-templates.png')
    record('admin-templates', templates.pathname === '/templates' && /模板/.test(templates.title || ''), '/templates', templates)
    record('gray-disabled', templates.gray.disabled === true, true, templates.gray)
    record(
      'gray-reason',
      (templates.reasons || []).some((t) => /5000/.test(t) && /不能灰度|不能开始灰度/.test(t)),
      '评测不足文案',
      templates.reasons,
    )
    record('gray-not-primary', !/btn-primary/.test(templates.gray.className || ''), '灰度是次按钮', templates.gray.className)

    await logout()
    await login(AGENT_USER)
    await waitFor(`location.pathname === '/agent'`, 10000)
    await goto(`${BASE}/templates`)
    await waitFor(`location.pathname === '/agent'`, 10000)
    const agentBlocked = await evaluate(`({
      pathname: location.pathname,
      nav: [...document.querySelectorAll('nav a, .nav a, aside a, .sidebar a')].map((a) =>
        (a.textContent || '').replace(/\\s+/g, ' ').trim(),
      ),
      hasEditor: Boolean(document.querySelector('.tpl-editor')),
    })`)
    evidence.steps.agentBlocked = agentBlocked
    await screenshot('t035-agent-blocked.png')
    record(
      'agent-cannot-open-templates',
      agentBlocked.pathname !== '/templates' && agentBlocked.hasEditor === false,
      '坐席打不开模板',
      agentBlocked,
    )

    evidence.pass = failed.length === 0
  } finally {
    evidence.failed = failed
    evidence.checks = checks
    await writeFile(path.join(OUT_DIR, 't035-browser-evidence.json'), JSON.stringify(evidence, null, 2), 'utf8')
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

  if (failed.length) {
    console.error('FAILS', JSON.stringify(failed, null, 2))
    process.exitCode = 1
  } else {
    console.log('PASS', checks.length, 'checks')
  }
}

main().catch(async (err) => {
  console.error(err)
  process.exitCode = 1
  try {
    if (chromeProc?.pid) process.kill(chromeProc.pid)
  } catch {
    // ignore
  }
})
