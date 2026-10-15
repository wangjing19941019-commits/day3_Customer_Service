import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const BASE = process.env.T031_BASE || 'http://127.0.0.1:5291'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT_DIR = path.resolve(
  'C:\\Users\\慈海客服\\Desktop\\demo\\Develop_Helper\\Projects_Repo\\Customer_Service\\.sdd\\test-reports',
)
const CDP_PORT = Number(process.env.T031_CDP_PORT || 9462)
const EMPLOYEE_USER = process.env.T031_EMPLOYEE_USER || 'it-help'
const AGENT_USER = process.env.T031_AGENT_USER || 'agent'
const DEMO_PASS = process.env.T031_DEMO_PASS || ''

const EXPECTED_KEYS = {
  return_exchange: [
    'order_no',
    'product_info',
    'amount',
    'intent_summary',
    'return_method',
    'return_reason',
    'quantity',
  ],
  address_change: [
    'order_no',
    'product_info',
    'amount',
    'intent_summary',
    'original_address',
    'new_address',
    'recipient_name',
    'phone',
  ],
  invoice: [
    'order_no',
    'product_info',
    'amount',
    'intent_summary',
    'invoice_kind',
    'invoice_title',
    'tax_id',
    'invoice_contact',
  ],
  complaint: [
    'order_no',
    'product_info',
    'amount',
    'intent_summary',
    'complaint_category',
    'incident_summary',
    'user_expectation',
    'need_escalate',
  ],
  fee_dispute: [
    'order_no',
    'product_info',
    'amount',
    'intent_summary',
    'dispute_type',
    'claimed_amount',
    'platform_amount',
    'diff_reason',
  ],
  logistics_exception: [
    'order_no',
    'product_info',
    'amount',
    'intent_summary',
    'tracking_no',
    'exception_type',
    'responsible_party',
    'user_request',
    'compensation_plan',
  ],
}

const TYPE_LABELS = {
  return_exchange: '退换货',
  address_change: '修改地址',
  invoice: '开发票',
  complaint: '投诉维权',
  fee_dispute: '费用争议',
  logistics_exception: '物流异常',
}

const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex',
)

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

const COLLECT_WORKBENCH = `(() => {
  const work = document.querySelector('.agent-work')
  const type = document.getElementById('agent-ticket-type')
  const line = document.getElementById('agent-business-line')
  const confirm = document.querySelector('.confirm-ticket')
  const fields = [...document.querySelectorAll('.agent-work .field')].map((field) => {
    const label = field.querySelector('label')?.textContent?.trim() ?? ''
    const control = field.querySelector('input:not([type="file"]):not([type="radio"]), select, textarea')
    const file = field.querySelector('input[type="file"]')
    const status = field.querySelector('.field-status')
    const statusCs = status ? getComputedStyle(status) : null
    const candidates = [...field.querySelectorAll('.candidate-list button')].map((btn) => ({
      text: (btn.textContent || '').replace(/\\s+/g, ' ').trim(),
      pressed: btn.getAttribute('aria-pressed'),
    }))
    const conflict = field.querySelector('.conflict-row')?.innerText?.replace(/\\s+/g, ' ').trim() ?? null
    return {
      id: control?.id || file?.id || '',
      label,
      tag: control?.tagName || (file ? 'FILE' : null),
      value: control ? control.value : null,
      status: status?.innerText?.replace(/\\s+/g, ' ').trim() ?? null,
      statusColor: statusCs?.color ?? null,
      statusClass: status?.className ?? null,
      candidates,
      conflict,
      attachments: [...field.querySelectorAll('.attach-list li')].map((li) => li.textContent?.trim() ?? ''),
    }
  })
  const polish = document.querySelector('.polish-compare')
  const knowledge = [...document.querySelectorAll('.knowledge-card')].map((card) =>
    (card.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 180),
  )
  return {
    empty: document.querySelector('.agent-work .agent-empty')?.textContent?.trim() ?? null,
    hasForm: Boolean(type),
    typeValue: type?.value ?? null,
    typeOptions: type ? [...type.options].map((opt) => opt.textContent.trim()) : [],
    lineValue: line?.value ?? null,
    confirmDisabled: confirm ? confirm.disabled : null,
    confirmText: confirm?.textContent?.trim() ?? null,
    blockers: [...document.querySelectorAll('.agent-work .hint')].map((el) => el.textContent.trim()),
    extracting: Boolean(document.querySelector('.extract-banner')),
    extractText: document.querySelector('.extract-banner')?.textContent?.trim() ?? null,
    mock: (work?.innerText || '').includes('[Mock]'),
    sendUser: [...document.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === '发给用户'),
    saveTemplate: /保存模板|保存新版本|编辑模板/.test(work?.innerText || ''),
    fields,
    knowledge,
    knowledgeSendHint: [...document.querySelectorAll('.agent-work .hint')].map((el) => el.textContent.trim()),
    polish: polish
      ? {
          text: (polish.innerText || '').replace(/\\s+/g, ' ').trim(),
          hasAdopt: [...polish.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === '采用'),
          hasEdit: [...polish.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === '修改'),
          hasDiscard: [...polish.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === '放弃'),
          hasSaveTemplate: /保存模板|保存新版本/.test(polish.innerText || ''),
          risk: document.querySelector('.polish-risk')?.innerText?.replace(/\\s+/g, ' ').trim() ?? null,
          original: [...polish.querySelectorAll('article p')].map((p) => p.textContent)[0] ?? null,
          polished: [...polish.querySelectorAll('article p')].map((p) => p.textContent)[1] ?? null,
          riskColor: document.querySelector('.polish-risk')
            ? getComputedStyle(document.querySelector('.polish-risk')).color
            : null,
        }
      : null,
    draft: document.getElementById('agent-reply')?.value ?? null,
    layout: {
      work: document.querySelector('.agent-work')?.getBoundingClientRect().toJSON() ?? null,
      thread: document.querySelector('.agent-thread')?.getBoundingClientRect().toJSON() ?? null,
      inboxClass: document.querySelector('.agent-inbox')
        ? getComputedStyle(document.querySelector('.agent-inbox')).flexDirection
        : null,
    },
    bodyHasSaveTemplate: /保存模板/.test(document.body.innerText || ''),
  }
})()`

function fieldByLabel(state, label) {
  return (state.fields || []).find((item) => item.label === label)
}

async function main() {
  if (!DEMO_PASS) throw new Error('missing T031_DEMO_PASS')
  await mkdir(OUT_DIR, { recursive: true })
  const pngPath = path.join(OUT_DIR, 't031-evidence.png')
  await writeFile(pngPath, PNG_BYTES)
  const userData = await mkdtemp(path.join(os.tmpdir(), 't031-chrome-'))
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

  async function newEmployeeConversation() {
    await evaluate(`sessionStorage.removeItem('conversation_id')`)
    await goto(`${BASE}/employee`)
    await waitFor(`document.querySelector('.employee-composer textarea')`, 10000)
  }

  async function waitExtractIdle(timeoutMs = 15000) {
    const start = Date.now()
    let sawExtracting = false
    while (Date.now() - start < timeoutMs) {
      const state = await evaluate(COLLECT_WORKBENCH)
      if (state.extracting) sawExtracting = true
      if (state.hasForm && sawExtracting && !state.extracting) {
        await delay(300)
        return evaluate(COLLECT_WORKBENCH)
      }
      await delay(200)
    }
    return evaluate(COLLECT_WORKBENCH)
  }

  async function selectRowContaining(text) {
    await evaluate(`(() => {
      const row = [...document.querySelectorAll('.agent-row')].find((el) =>
        (el.textContent || '').includes(${JSON.stringify(text)}),
      )
      if (!row) throw new Error('missing row ' + ${JSON.stringify(text)})
      row.click()
      return (row.textContent || '').replace(/\\s+/g, ' ').trim()
    })()`)
    await waitFor(`document.getElementById('agent-ticket-type')`, 10000)
  }

  async function prepareReturnTicket() {
    await setSelect('agent-ticket-type', 'return_exchange')
    await setSelect('agent-business-line', 'digital_3c')
    return waitExtractIdle(15000)
  }

  async function fillField(id, value) {
    await evaluate(fillScript(`#${id}`, value))
    await evaluate(`document.getElementById(${JSON.stringify(id)})?.blur()`)
    await delay(400)
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

  async function clickNamedButton(scope, name) {
    await evaluate(`(() => {
      const root = ${JSON.stringify(scope)} ? document.querySelector(${JSON.stringify(scope)}) : document
      const btn = [...root.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === ${JSON.stringify(name)})
      if (!btn) throw new Error('missing button ' + ${JSON.stringify(name)})
      btn.click()
      return true
    })()`)
  }

  async function uploadEvidenceFile() {
    const { root } = await send('DOM.getDocument', { depth: 1 })
    const { nodeId } = await send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: '#ticket-evidence',
    })
    if (!nodeId) throw new Error('missing evidence input')
    await send('DOM.setFileInputFiles', { nodeId, files: [pngPath] })
  }

  const evidence = {
    mock: true,
    base: BASE,
    viewport: '1440x900',
    cdpPort: CDP_PORT,
    chrome: version.Browser,
    userDataDir: userData,
    employeeUser: EMPLOYEE_USER,
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

    const agentEmptyLogin = await login(AGENT_USER)
    evidence.steps.agentEmptyLogin = agentEmptyLogin
    await waitFor(`location.pathname === '/agent'`)
    const emptyInbox = await evaluate(`({
      pathname: location.pathname,
      empty: document.querySelector('.agent-empty')?.textContent?.trim() ?? null,
      hasForm: Boolean(document.getElementById('agent-ticket-type')),
      mock: (document.body.innerText || '').includes('[Mock]'),
    })`)
    evidence.steps.emptyInbox = emptyInbox
    await screenshot('t031-empty-agent.png')
    record('TC-03a-no-form', !emptyInbox.hasForm && /还没有需要人工处理/.test(emptyInbox.empty || ''), emptyInbox)

    await logout()
    const empLogin = await login(EMPLOYEE_USER)
    evidence.steps.employeeLogin = empLogin
    record('employee-home', empLogin.pathname === '/employee', empLogin)
    await employeeSend('找客服处理售后')
    await employeeTransfer()
    await employeeSend('我昨天买的那个蓝色手机要退，已经超过7天了，金额99元。')
    evidence.steps.afterTransferEmployee = await evaluate(`({
      status: document.querySelector('.employee-status-text')?.textContent?.trim() ?? null,
      transferDisabled: document.querySelector('.employee-status button')?.disabled ?? null,
    })`)
    await screenshot('t031-employee-handoff.png')

    await logout()
    await login(AGENT_USER)
    await waitFor(`document.querySelector('.agent-row')`, 10000)
    await waitFor(`document.getElementById('agent-ticket-type')`, 10000)
    const beforeType = await evaluate(COLLECT_WORKBENCH)
    evidence.steps.beforeType = {
      typeValue: beforeType.typeValue,
      lineValue: beforeType.lineValue,
      confirmDisabled: beforeType.confirmDisabled,
      typeOptions: beforeType.typeOptions,
      mock: beforeType.mock,
    }
    await screenshot('t031-before-type.png')
    record('six-type-options', TYPE_LABELS && beforeType.typeOptions.includes('退换货') && beforeType.typeOptions.includes('物流异常') && beforeType.typeOptions.includes('费用争议') && beforeType.typeOptions.includes('投诉维权') && beforeType.typeOptions.includes('开发票') && beforeType.typeOptions.includes('修改地址'), beforeType.typeOptions)
    record('confirm-disabled-no-type', beforeType.confirmDisabled === true, beforeType)
    record('mock-label', beforeType.mock === true, beforeType)

    const typeKeys = {}
    for (const [value, label] of Object.entries(TYPE_LABELS)) {
      await setSelect('agent-ticket-type', value)
      await delay(400)
      const snap = await evaluate(COLLECT_WORKBENCH)
      const ids = (snap.fields || [])
        .map((item) => item.id.replace(/^ticket-field-/, ''))
        .filter((id) => id && id !== 'ticket-evidence' && id !== 'agent-business-line' && id !== 'agent-ticket-type')
      typeKeys[value] = { label, ids, typeValue: snap.typeValue }
      record(`keys-${value}`, JSON.stringify(ids) === JSON.stringify(EXPECTED_KEYS[value]), { ids, expected: EXPECTED_KEYS[value] })
    }
    evidence.steps.typeKeys = typeKeys
    await screenshot('t031-six-types.png')

    await setSelect('agent-ticket-type', '')
    await delay(300)
    const noType = await evaluate(COLLECT_WORKBENCH)
    evidence.steps.noType = { confirmDisabled: noType.confirmDisabled, typeValue: noType.typeValue }
    record('confirm-disabled-pre-sale', noType.confirmDisabled === true, noType)

    await setSelect('agent-ticket-type', 'return_exchange')
    await setSelect('agent-business-line', '')
    await delay(300)
    const noLine = await evaluate(COLLECT_WORKBENCH)
    evidence.steps.noLine = { confirmDisabled: noLine.confirmDisabled, lineValue: noLine.lineValue }
    record('confirm-disabled-no-line', noLine.confirmDisabled === true, noLine)

    await setSelect('agent-business-line', 'digital_3c')
    await waitFor(`document.querySelector('.extract-banner')`, 8000)
    const extracting = await evaluate(COLLECT_WORKBENCH)
    evidence.steps.extracting = { extracting: extracting.extracting, extractText: extracting.extractText }
    const afterOne = await waitExtractIdle(15000)
    const order = fieldByLabel(afterOne, '订单号')
    const amount = fieldByLabel(afterOne, '相关金额')
    const product = fieldByLabel(afterOne, '商品信息')
    const missing = fieldByLabel(afterOne, '退换原因')
    evidence.steps.oneOrder = {
      order,
      amount,
      product,
      missing,
      confirmDisabled: afterOne.confirmDisabled,
      knowledge: afterOne.knowledge,
      draft: afterOne.draft,
      sendUser: afterOne.sendUser,
    }
    await screenshot('t031-one-order.png')
    record('one-order-autofill', order?.value === 'JD20260922001' && order?.status === '已填', order)
    record('one-order-no-preselect-list', (order?.candidates || []).length === 0, order)
    record('amount-99', amount?.value === '99' && amount?.status === '已填', amount)
    record('product-blue-phone', /蓝色手机/.test(product?.value || ''), product)
    record('filled-green', amount?.statusColor === 'rgb(15, 123, 90)', amount)
    record('missing-red', missing?.status === '缺失' && missing?.statusColor === 'rgb(180, 35, 24)', missing)
    record('knowledge-not-in-draft', (afterOne.draft || '') === '', afterOne.draft)
    record('no-send-to-user', afterOne.sendUser === false, afterOne.knowledgeSendHint)

    await logout()
    await login(EMPLOYEE_USER)
    await employeeSend('其实是88元')
    await logout()
    await login(AGENT_USER)
    await waitFor(`document.getElementById('agent-ticket-type')`, 10000)
    let conflictState = await waitExtractIdle(15000)
    let conflictAmount = fieldByLabel(conflictState, '相关金额')
    if (conflictAmount?.status !== '冲突') {
      await delay(2500)
      conflictState = await waitExtractIdle(8000)
      conflictAmount = fieldByLabel(conflictState, '相关金额')
    }
    evidence.steps.conflict99 = conflictAmount
    await screenshot('t031-amount-conflict.png')
    record('keep-99-conflict', conflictAmount?.value === '99' && conflictAmount?.status === '冲突' && /88/.test(conflictAmount?.conflict || ''), conflictAmount)
    record('conflict-red', conflictAmount?.statusColor === 'rgb(180, 35, 24)', conflictAmount)

    await evaluate(fillScript('#agent-reply', '你这个退不了，超时间了'))
    await evaluate(`document.querySelector('.agent-composer .btn-secondary').click()`)
    await waitFor(`document.querySelector('.polish-compare')`, 10000)
    const polishOk = await evaluate(COLLECT_WORKBENCH)
    evidence.steps.polishOk = polishOk.polish
    await screenshot('t031-polish-compare.png')
    record('polish-compare', Boolean(polishOk.polish?.hasAdopt && polishOk.polish?.hasEdit && polishOk.polish?.original && polishOk.polish?.polished), polishOk.polish)
    record('polish-keeps-7-days', /超过\s*7\s*天/.test(polishOk.polish?.polished || ''), polishOk.polish)
    record('no-template-on-feedback', polishOk.polish?.hasSaveTemplate === false && polishOk.bodyHasSaveTemplate === false, polishOk.polish)

    await evaluate(`(() => {
      const useless = [...document.querySelectorAll('input[name="polish-feedback-rating"]')][1]
      if (useless) useless.click()
      return true
    })()`)
    await evaluate(fillScript('#polish-feedback-comment', '无用，语气仍硬'))
    await clickNamedButton('.polish-feedback', '提交反馈')
    await waitFor(`(document.body.innerText || '').includes('已提交反馈')`, 8000)
    const afterFeedback = await evaluate(COLLECT_WORKBENCH)
    evidence.steps.afterFeedback = {
      done: /已提交反馈/.test(afterFeedback.polish?.text || ''),
      saveTemplate: afterFeedback.bodyHasSaveTemplate,
    }
    record('feedback-no-template-entry', afterFeedback.bodyHasSaveTemplate === false, afterFeedback.afterFeedback)

    const originalDraft = await evaluate(`document.getElementById('agent-reply')?.value`)
    await clickNamedButton('.polish-compare', '放弃')
    await waitFor(`!document.querySelector('.polish-compare')`, 8000)
    const afterDiscard = await evaluate(`document.getElementById('agent-reply')?.value`)
    evidence.steps.discard = { originalDraft, afterDiscard }
    record('discard-keeps-original', afterDiscard === '你这个退不了，超时间了', { originalDraft, afterDiscard })
    await evaluate(`document.querySelector('.agent-composer .btn-primary').click()`)
    await waitFor(`(document.querySelector('#agent-reply')?.value || '') === ''`, 8000)

    await evaluate(fillScript('#agent-reply', '一定全额退，赔500元'))
    await evaluate(`document.querySelector('.agent-composer .btn-secondary').click()`)
    await waitFor(`document.querySelector('.polish-risk')`, 10000)
    const polishBad = await evaluate(COLLECT_WORKBENCH)
    evidence.steps.polishBad = polishBad.polish
    await screenshot('t031-polish-risk.png')
    record('cannot-adopt-promise', polishBad.polish?.hasAdopt === false && Boolean(polishBad.polish?.risk), polishBad.polish)
    record('risk-danger-color', polishBad.polish?.riskColor === 'rgb(180, 35, 24)', polishBad.polish)

    await send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    })
    await delay(400)
    const narrow = await evaluate(COLLECT_WORKBENCH)
    evidence.steps.narrow = narrow.layout
    await screenshot('t031-narrow.png')
    record(
      'narrow-workbench-below',
      Boolean(narrow.layout?.work && narrow.layout?.thread && narrow.layout.work.y >= narrow.layout.thread.y + narrow.layout.thread.height - 8),
      narrow.layout,
    )
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })

    await logout()
    await login(EMPLOYEE_USER)
    const employeeSawOriginal = await evaluate(`(document.body.innerText || '').includes('你这个退不了，超时间了')`)
    evidence.steps.employeeSawOriginal = employeeSawOriginal
    record('employee-got-original', employeeSawOriginal === true, employeeSawOriginal)

    await newEmployeeConversation()
    await employeeSend('找客服')
    await employeeTransfer()
    await employeeSend('昨天有两笔蓝色手机要退')
    await logout()
    await login(AGENT_USER)
    await waitFor(`document.querySelectorAll('.agent-row').length >= 2`, 10000)
    await selectRowContaining('两笔蓝色手机')
    const two = await prepareReturnTicket()
    const twoOrder = fieldByLabel(two, '订单号')
    evidence.steps.twoOrders = twoOrder
    await screenshot('t031-two-orders.png')
    record('two-candidates', twoOrder?.status === '待确认' && twoOrder?.value === '' && (twoOrder?.candidates || []).length === 2, twoOrder)
    record('two-not-preselected', (twoOrder?.candidates || []).every((item) => item.pressed === 'false'), twoOrder)
    record('two-contains-both', (twoOrder?.candidates || []).some((item) => item.text.includes('JD20260922001')) && (twoOrder?.candidates || []).some((item) => item.text.includes('JD20260922002')), twoOrder)
    record('candidate-yellow', twoOrder?.statusColor === 'rgb(180, 83, 9)', twoOrder)

    await logout()
    await login(EMPLOYEE_USER)
    await newEmployeeConversation()
    await employeeSend('找客服')
    await employeeTransfer()
    await employeeSend('这个紫色冰箱查不到订单，要退货')
    await logout()
    await login(AGENT_USER)
    await waitFor(`document.querySelectorAll('.agent-row').length >= 3`, 10000)
    await selectRowContaining('紫色冰箱')
    const zero = await prepareReturnTicket()
    const zeroOrder = fieldByLabel(zero, '订单号')
    evidence.steps.zeroOrder = {
      order: zeroOrder,
      hints: zero.blockers,
    }
    await screenshot('t031-zero-order.png')
    record('zero-missing', zeroOrder?.status === '缺失' && (!zeroOrder.value || zeroOrder.value === ''), zeroOrder)
    record('zero-no-fabricated', !/JD\d+|AP\d+/.test(zeroOrder?.value || ''), zeroOrder)
    record('zero-query-message', (zero.blockers || []).some((text) => text.includes('暂未查到')), zero.blockers)

    await logout()
    await login(EMPLOYEE_USER)
    await newEmployeeConversation()
    await employeeSend('找客服')
    await employeeTransfer()
    await employeeSend('我昨天买的蓝色手机费用争议，主张99元，价保差异不对')
    await logout()
    await login(AGENT_USER)
    await waitFor(`document.querySelectorAll('.agent-row').length >= 4`, 10000)
    await selectRowContaining('费用争议')
    await setSelect('agent-ticket-type', 'fee_dispute')
    await setSelect('agent-business-line', 'digital_3c')
    let fee = await waitExtractIdle(15000)
    evidence.steps.feeBeforeFill = {
      confirmDisabled: fee.confirmDisabled,
      blockers: fee.blockers,
      fields: fee.fields.map((item) => ({ label: item.label, value: item.value, status: item.status })),
    }
    const orderField = fieldByLabel(fee, '订单号')
    if (!orderField?.value) {
      await fillField('ticket-field-order_no', 'JD20260922001')
    }
    const platformField = fieldByLabel(await evaluate(COLLECT_WORKBENCH), '平台核算金额')
    if (!platformField?.value) {
      await fillField('ticket-field-platform_amount', '99')
    }
    for (const item of (await evaluate(COLLECT_WORKBENCH)).fields) {
      if (!item.id.startsWith('ticket-field-')) continue
      if (item.value) continue
      if (item.tag === 'SELECT') {
        await evaluate(`(() => {
          const el = document.getElementById(${JSON.stringify(item.id)})
          if (!el || el.options.length < 2) return false
          el.value = el.options[1].value
          el.dispatchEvent(new Event('change', { bubbles: true }))
          return el.value
        })()`)
        await delay(300)
      } else if (item.tag === 'TEXTAREA' || item.tag === 'INPUT') {
        await fillField(item.id, item.label.includes('金额') ? '99' : '坐席手填')
      }
    }
    fee = await evaluate(COLLECT_WORKBENCH)
    evidence.steps.feeNoShot = {
      confirmDisabled: fee.confirmDisabled,
      blockers: fee.blockers,
      evidenceStatus: fieldByLabel(fee, '证据截图'),
    }
    await screenshot('t031-fee-no-shot.png')
    record('fee-no-shot-blocked', fee.confirmDisabled === true && (fee.blockers || []).some((text) => /证据截图/.test(text)), fee.blockers)

    await uploadEvidenceFile()
    await waitFor(`document.querySelector('.attach-list li')`, 8000)
    const feeShot = await evaluate(COLLECT_WORKBENCH)
    evidence.steps.feeWithShot = {
      confirmDisabled: feeShot.confirmDisabled,
      blockers: feeShot.blockers,
      attachments: fieldByLabel(feeShot, '证据截图'),
    }
    await screenshot('t031-fee-with-shot.png')
    record('fee-with-shot-enabled', feeShot.confirmDisabled === false, {
      confirmDisabled: feeShot.confirmDisabled,
      blockers: feeShot.blockers,
      error: feeShot.fields ? undefined : feeShot,
    })
    if (feeShot.confirmDisabled) {
      const errText = await evaluate(`document.querySelector('.error-text')?.textContent ?? document.querySelector('.confirm-ticket')?.disabled`)
      evidence.steps.feeConfirmBlocked = { errText, blockers: feeShot.blockers }
    } else {
      await evaluate(`document.querySelector('.confirm-ticket').click()`)
      await waitFor(`(document.querySelector('.confirm-ticket')?.textContent || '').includes('已确认')`, 8000)
    }
    const feeConfirmed = await evaluate(COLLECT_WORKBENCH)
    evidence.steps.feeConfirmed = {
      confirmText: feeConfirmed.confirmText,
      typeDisabled: await evaluate(`document.getElementById('agent-ticket-type')?.disabled`),
    }
    record('fee-confirmed', feeConfirmed.confirmText === '已确认', feeConfirmed)
  } finally {
    await writeFile(path.join(OUT_DIR, 't031-browser-evidence.json'), JSON.stringify(evidence, null, 2), 'utf8')
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
  console.log(JSON.stringify({ ok: true, steps: Object.keys(evidence.steps) }, null, 2))
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
