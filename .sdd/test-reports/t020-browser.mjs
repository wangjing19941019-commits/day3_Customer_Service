import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const BASE = process.env.T020_BASE || 'http://127.0.0.1:5204'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT_DIR = path.resolve(
  'C:\\Users\\慈海客服\\Desktop\\demo\\Develop_Helper\\Projects_Repo\\Customer_Service\\.sdd\\test-reports',
)
const CDP_PORT = Number(process.env.T020_CDP_PORT || 9450)
const DEMO_USER = process.env.T020_DEMO_USER || 'it-help'
const DEMO_PASS = process.env.T020_DEMO_PASS || ''
const HAND_EDIT = '坐席手改-勿覆盖'
const PRE_SALE_DRAFT = '售前核对一下退货条件。'
const POLISH_RISKY = '可以一定全额退，按七天无理由处理。'
const ORIGINAL_SEND = '改回原稿再发送测试'
const APPAREL_PUSH = '签收后七日内可无理由退货，吊牌完整'
const DIGITAL_PUSH = '以签收后的保修说明为准'
const EMPTY_KNOWLEDGE = '当前没有可推送的政策或流程'
const NO_LINE = '未指定业务线，不套用单一口径'

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

function setSelectScript(selector, value) {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error('missing ' + ${JSON.stringify(selector)});
    const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    desc.set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.value;
  })()`
}

const collectAgent = `(() => {
  const body = document.body.innerText || '';
  const confirm = document.querySelector('.confirm-ticket');
  const typeEl = document.querySelector('#agent-ticket-type');
  const lineEl = document.querySelector('#agent-business-line');
  const banner = document.querySelector('.extract-banner');
  const work = document.querySelector('.agent-work');
  const list = document.querySelector('.agent-list');
  const composer = document.querySelector('#agent-reply');
  const polish = [...document.querySelectorAll('.agent-composer button')].find((b) => /润色/.test(b.textContent || ''));
  const sendBtn = [...document.querySelectorAll('.agent-composer button')].find((b) => /发送/.test(b.textContent || ''));
  const fields = [...document.querySelectorAll('.agent-work .field')].map((n) => {
    const label = n.querySelector('label')?.textContent ?? '';
    const control = n.querySelector('select, textarea, input');
    return {
      label,
      id: control?.id ?? null,
      value: control?.value ?? null,
      disabled: control ? control.disabled : null,
      status: n.querySelector('.field-status')?.textContent ?? null,
    };
  });
  const fieldIds = fields.map((f) => f.id).filter(Boolean);
  const knowledgeCards = [...document.querySelectorAll('.knowledge-card')].map((n) => ({
    tag: n.querySelector('.tag')?.textContent ?? null,
    text: n.textContent ?? '',
  }));
  const msgs = [...document.querySelectorAll('.agent-msg')].map((n) => ({
    side: n.classList.contains('agent-msg-user') ? 'employee' : 'peer',
    tag: n.querySelector('.agent-tag')?.textContent ?? null,
    text: n.querySelector('.agent-bubble')?.textContent ?? '',
  }));
  const workCs = work ? getComputedStyle(work) : null;
  return {
    href: location.href,
    pathname: location.pathname,
    bodyHasMock: body.includes('[Mock]'),
    emptyText: document.querySelector('.agent-empty')?.textContent ?? null,
    listCount: document.querySelectorAll('.agent-row').length,
    listWidth: list ? Math.round(list.getBoundingClientRect().width) : null,
    workWidth: work ? Math.round(work.getBoundingClientRect().width) : null,
    workOverflow: workCs?.overflowY ?? null,
    confirmText: confirm?.textContent?.trim() ?? null,
    confirmDisabled: confirm ? confirm.disabled : null,
    typeValue: typeEl?.value ?? null,
    typeDisabled: typeEl ? typeEl.disabled : null,
    lineValue: lineEl?.value ?? null,
    lineDisabled: lineEl ? lineEl.disabled : null,
    extracting: Boolean(banner),
    extractText: banner?.textContent ?? null,
    fields,
    fieldIds,
    hasReturnMethod: fieldIds.includes('ticket-field-return_method'),
    hasQuantity: fieldIds.includes('ticket-field-quantity'),
    hasInvoiceTitle: fieldIds.includes('ticket-field-invoice_title'),
    hasTaxId: fieldIds.includes('ticket-field-tax_id'),
    productValue: document.querySelector('#ticket-field-product_info')?.value ?? null,
    productStatus: document.querySelector('#ticket-field-product_info')?.parentElement?.querySelector('.field-status')?.textContent ?? null,
    knowledgeCards,
    knowledgeText: knowledgeCards.map((c) => c.text).join('\\n'),
    hasNoLineHint: body.includes(${JSON.stringify(NO_LINE)}),
    hasEmptyKnowledge: body.includes(${JSON.stringify(EMPTY_KNOWLEDGE)}),
    hasSendToUserButton: [...document.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === '发给用户'),
    knowledgeHint: [...document.querySelectorAll('.agent-work .hint')].map((n) => n.textContent),
    draft: composer?.value ?? null,
    composerDisabled: composer ? composer.disabled : null,
    polishDisabled: polish ? polish.disabled : null,
    sendDisabled: sendBtn ? sendBtn.disabled : null,
    messageCount: msgs.length,
    messages: msgs,
    peerTexts: msgs.filter((m) => m.side === 'peer').map((m) => m.text),
    topbarUser: document.querySelector('.session .user')?.textContent ?? null,
  };
})()`

const collectEmployee = `(() => {
  const msgs = [...document.querySelectorAll('.chat-msg')].map((n) => ({
    side: n.classList.contains('employee') ? 'employee' : 'other',
    tag: n.querySelector('.chat-msg-tag')?.textContent ?? null,
    text: n.querySelector('.chat-bubble')?.textContent ?? '',
  }));
  return {
    pathname: location.pathname,
    statusText: document.querySelector('.employee-status-text')?.textContent ?? null,
    messageCount: msgs.length,
    messages: msgs,
    otherTexts: msgs.filter((m) => m.side !== 'employee').map((m) => m.text),
    lastOther: msgs.filter((m) => m.side !== 'employee').at(-1) ?? null,
  };
})()`

function assert(cond, label, extra) {
  if (!cond) {
    const detail = extra === undefined ? '' : ` ${JSON.stringify(extra)}`
    throw new Error(`ASSERT FAIL: ${label}${detail}`)
  }
}

async function main() {
  if (!DEMO_PASS) throw new Error('missing T020_DEMO_PASS')
  await mkdir(OUT_DIR, { recursive: true })
  const userData = await mkdtemp(path.join(os.tmpdir(), 't020-chrome-'))
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
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })

  async function goto(url) {
    const nav = send('Page.navigate', { url })
    await Promise.race([send('Page.loadEventFired').catch(() => null), delay(3000)])
    await nav
  }

  async function clickNav(label) {
    await evaluate(`(() => {
      const link = [...document.querySelectorAll('.sidebar a')].find((a) => a.textContent.trim() === ${JSON.stringify(label)});
      if (!link) throw new Error('missing nav ' + ${JSON.stringify(label)});
      link.click();
      return true;
    })()`)
  }

  const evidence = {
    mock: true,
    base: BASE,
    viewport: '1440x900',
    cdpPort: CDP_PORT,
    chrome: version.Browser,
    userDataDir: userData,
    steps: {},
    failed: [],
  }

  try {
    const health = await fetch(BASE)
    evidence.viteStatus = health.status
    evidence.viteUrl = BASE
    assert(health.status === 200, 'vite 5204 HTTP 200', health.status)

    await goto(`${BASE}/employee`)
    await waitFor(`document.querySelector('.login-card') || document.querySelector('.employee-chat')`)
    if (await evaluate(`Boolean(document.querySelector('.login-card'))`)) {
      await evaluate(fillScript('#user', DEMO_USER))
      await evaluate(fillScript('#pass', DEMO_PASS))
      await evaluate(`document.querySelector('button[type="submit"]').click()`)
    }
    await waitFor(`document.querySelector('.employee-chat') && location.pathname === '/employee'`)

    await clickNav('客服端')
    await waitFor(`location.pathname === '/agent'`)
    await waitFor(`document.querySelector('.agent-inbox')`)
    const emptyAgent = await evaluate(collectAgent)
    evidence.steps.emptyAgent = {
      pathname: emptyAgent.pathname,
      emptyText: emptyAgent.emptyText,
      listCount: emptyAgent.listCount,
      confirmText: emptyAgent.confirmText,
      workWidth: emptyAgent.workWidth,
      topbarUser: emptyAgent.topbarUser,
    }
    await screenshot('t020-agent-empty.png')
    try {
      assert(emptyAgent.pathname === '/agent', 'pathname /agent', emptyAgent.pathname)
      assert(emptyAgent.listCount === 0, 'no untransferred sessions in list', emptyAgent.listCount)
      assert(
        Boolean(emptyAgent.emptyText?.includes('还没有需要人工处理的对话')),
        'empty copy',
        emptyAgent.emptyText,
      )
      assert(!emptyAgent.confirmText, 'no confirm before handoff', emptyAgent.confirmText)
      assert(!emptyAgent.fieldIds?.length, 'no form before handoff', emptyAgent.fieldIds)
    } catch (err) {
      evidence.failed.push({ id: 'TC-02-untransferred-ui', error: String(err.message) })
    }

    await clickNav('员工端')
    await waitFor(`location.pathname === '/employee' && document.querySelector('.employee-composer textarea')`)
    await evaluate(fillScript('.employee-composer textarea', '这件连衣裙能退吗'))
    await evaluate(`document.querySelector('.employee-composer button[type="submit"]').click()`)
    await waitFor(`document.querySelectorAll('.chat-msg').length >= 2`)
    const convId = await evaluate(`sessionStorage.getItem('conversation_id')`)
    evidence.conversationId = convId
    const untransferred409 = await evaluate(`(async () => {
      const id = sessionStorage.getItem('conversation_id');
      const mod = await import('/src/mocks/tickets.ts');
      try {
        mod.handleGetTicket(id);
        return { threw: false };
      } catch (err) {
        return {
          threw: true,
          status: err.status ?? null,
          error_code: err.error_code ?? null,
          message: err.message ?? String(err),
        };
      }
    })()`)
    evidence.steps.untransferred409 = untransferred409
    try {
      assert(untransferred409.threw === true, 'untransferred GET throws')
      assert(untransferred409.status === 409, 'untransferred 409', untransferred409)
      assert(untransferred409.error_code === 'CONFLICT', 'CONFLICT', untransferred409)
      assert(
        String(untransferred409.message).includes('尚未转人工'),
        '409 copy',
        untransferred409.message,
      )
    } catch (err) {
      evidence.failed.push({ id: 'TC-02-untransferred-409', error: String(err.message) })
    }

    await waitFor(`document.querySelector('.employee-status button') && !document.querySelector('.employee-status button').disabled`)
    await evaluate(`document.querySelector('.employee-status button').click()`)
    await waitFor(
      `document.querySelector('.employee-status-text') && document.querySelector('.employee-status-text').textContent.includes('已转人工')`,
    )

    await clickNav('客服端')
    await waitFor(`location.pathname === '/agent'`)
    await waitFor(`document.querySelector('.agent-row')`)
    await waitFor(`document.querySelector('#agent-ticket-type') && document.querySelector('#agent-business-line')`)
    const draft = await evaluate(collectAgent)
    evidence.steps.draft = {
      listCount: draft.listCount,
      confirmDisabled: draft.confirmDisabled,
      typeValue: draft.typeValue,
      lineValue: draft.lineValue,
      hasNoLineHint: draft.hasNoLineHint,
      hasSendToUserButton: draft.hasSendToUserButton,
      knowledgeHint: draft.knowledgeHint,
      listWidth: draft.listWidth,
      workWidth: draft.workWidth,
      bodyHasMock: draft.bodyHasMock,
      topbarUser: draft.topbarUser,
    }
    await screenshot('t020-draft.png')
    try {
      assert(draft.listCount >= 1, 'handed-off session listed', draft.listCount)
      assert(draft.confirmDisabled === true, 'confirm disabled until type+line', draft)
      assert(draft.typeValue === '', 'type empty 售前', draft.typeValue)
      assert(draft.lineValue === '', 'line empty', draft.lineValue)
      assert(draft.hasNoLineHint, 'no-line knowledge hint')
      assert(!draft.hasSendToUserButton, 'no 发给用户 button', draft.knowledgeHint)
      assert(draft.bodyHasMock, '[Mock] visible')
      assert(draft.listWidth === 320, 'left 320px', draft.listWidth)
      assert(draft.workWidth === 360, 'right 360px', draft.workWidth)
      assert(Boolean(draft.topbarUser?.includes('it-help')), 'topbar user', draft.topbarUser)
    } catch (err) {
      evidence.failed.push({ id: 'TC-01-draft', error: String(err.message) })
    }

    await evaluate(fillScript('#agent-reply', PRE_SALE_DRAFT))
    const beforePresaleSend = await evaluate(`document.querySelectorAll('.agent-msg').length`)
    await evaluate(`[...document.querySelectorAll('.agent-composer button')].find((b) => (b.textContent || '').includes('润色')).click()`)
    await waitFor(`document.querySelector('#agent-reply') && document.querySelector('#agent-reply').value.includes('您好')`)
    const polishedPresale = await evaluate(collectAgent)
    evidence.steps.presalePolish = {
      draft: polishedPresale.draft,
      confirmDisabled: polishedPresale.confirmDisabled,
      messageCount: polishedPresale.messageCount,
      beforePresaleSend,
    }
    try {
      assert(polishedPresale.confirmDisabled === true, 'still cannot confirm 售前')
      assert(polishedPresale.messageCount === beforePresaleSend, 'polish does not append agent message', {
        beforePresaleSend,
        after: polishedPresale.messageCount,
      })
      assert(Boolean(polishedPresale.draft?.includes('您好')), 'polish fills composer', polishedPresale.draft)
    } catch (err) {
      evidence.failed.push({ id: 'TC-03-presale-polish', error: String(err.message) })
    }
    await evaluate(`[...document.querySelectorAll('.agent-composer button')].find((b) => (b.textContent || '').includes('发送')).click()`)
    await waitFor(`document.querySelectorAll('.agent-msg').length > ${beforePresaleSend}`)
    const afterPresaleSend = await evaluate(collectAgent)
    evidence.steps.presaleSend = {
      lastPeer: afterPresaleSend.messages.filter((m) => m.side === 'peer').at(-1) ?? null,
      confirmDisabled: afterPresaleSend.confirmDisabled,
    }
    try {
      assert(
        Boolean(afterPresaleSend.messages.filter((m) => m.side === 'peer').at(-1)?.text?.includes('您好')),
        'send uses current polished text',
        afterPresaleSend.messages.filter((m) => m.side === 'peer').at(-1),
      )
      assert(afterPresaleSend.confirmDisabled === true, 'send does not confirm ticket')
    } catch (err) {
      evidence.failed.push({ id: 'TC-03-presale-send', error: String(err.message) })
    }

    await evaluate(setSelectScript('#agent-ticket-type', 'return_exchange'))
    await waitFor(`document.querySelector('.extract-banner')`, 5000)
    const extracting = await evaluate(collectAgent)
    evidence.steps.extracting = {
      extracting: extracting.extracting,
      extractText: extracting.extractText,
      confirmDisabled: extracting.confirmDisabled,
      typeValue: extracting.typeValue,
      lineValue: extracting.lineValue,
      hasReturnMethod: extracting.hasReturnMethod,
      hasQuantity: extracting.hasQuantity,
      hasTaxId: extracting.hasTaxId,
      composerDisabled: extracting.composerDisabled,
    }
    await screenshot('t020-extracting.png')
    try {
      assert(extracting.extracting, 'extracting banner visible')
      assert(
        Boolean(extracting.extractText?.includes('正在根据对话补全')),
        'banner copy',
        extracting.extractText,
      )
      assert(extracting.confirmDisabled === true, 'confirm still disabled without line')
      assert(extracting.hasReturnMethod, 'return fields after type')
      assert(extracting.hasQuantity, 'quantity present')
      assert(!extracting.hasTaxId, 'no tax_id on return')
      assert(extracting.composerDisabled === false, 'GET/extract does not block composer')
    } catch (err) {
      evidence.failed.push({ id: 'TC-01-extract-banner', error: String(err.message) })
    }

    await evaluate(setSelectScript('#agent-business-line', 'digital_3c'))
    await waitFor(
      `document.querySelector('#agent-business-line') && document.querySelector('#agent-business-line').value === 'digital_3c'`,
    )
    await waitFor(
      `document.querySelector('.confirm-ticket') && !document.querySelector('.confirm-ticket').disabled`,
      8000,
    )
    const lineWhileExtract = await evaluate(collectAgent)
    evidence.steps.lineWhileExtract = {
      extracting: lineWhileExtract.extracting,
      confirmDisabled: lineWhileExtract.confirmDisabled,
      lineValue: lineWhileExtract.lineValue,
    }
    try {
      assert(lineWhileExtract.lineValue === 'digital_3c', 'can select line during/after extract')
      assert(lineWhileExtract.confirmDisabled === false, 'confirm enabled after type+line')
    } catch (err) {
      evidence.failed.push({ id: 'TC-01-confirm-gate', error: String(err.message) })
    }

    await waitFor(`!document.querySelector('.extract-banner')`, 12000)
    await waitFor(
      `document.querySelector('#ticket-field-product_info') && document.querySelector('#ticket-field-product_info').value.includes('连衣裙')`,
      12000,
    )
    const filled3c = await evaluate(collectAgent)
    evidence.steps.digital3c = {
      productValue: filled3c.productValue,
      productStatus: filled3c.productStatus,
      knowledgeText: filled3c.knowledgeText,
      extracting: filled3c.extracting,
      confirmDisabled: filled3c.confirmDisabled,
    }
    await screenshot('t020-digital-3c.png')
    try {
      assert(Boolean(filled3c.productValue?.includes('连衣裙')), 'prefill 连衣裙', filled3c.productValue)
      assert(filled3c.productStatus === '已提取', 'status 已提取 not enum', filled3c.productStatus)
      assert(Boolean(filled3c.knowledgeText?.includes(DIGITAL_PUSH)), '3C knowledge', filled3c.knowledgeText)
      assert(!filled3c.knowledgeText?.includes(APPAREL_PUSH), '3C knowledge not apparel', filled3c.knowledgeText)
      assert(!filled3c.extracting, 'banner gone after fill')
    } catch (err) {
      evidence.failed.push({ id: 'TC-01-digital-knowledge', error: String(err.message) })
    }

    await evaluate(setSelectScript('#agent-business-line', 'apparel_beauty'))
    await waitFor(
      `document.querySelector('#agent-business-line').value === 'apparel_beauty'`,
    )
    await waitFor(
      `(document.body.innerText || '').includes(${JSON.stringify(APPAREL_PUSH)})`,
      8000,
    )
    const apparel = await evaluate(collectAgent)
    evidence.steps.apparel = {
      lineValue: apparel.lineValue,
      knowledgeText: apparel.knowledgeText,
    }
    await screenshot('t020-apparel.png')
    try {
      assert(apparel.lineValue === 'apparel_beauty', 'switched to apparel')
      assert(Boolean(apparel.knowledgeText?.includes(APPAREL_PUSH)), 'apparel knowledge', apparel.knowledgeText)
      assert(!apparel.knowledgeText?.includes(DIGITAL_PUSH), 'apparel knowledge not 3C', apparel.knowledgeText)
    } catch (err) {
      evidence.failed.push({ id: 'TC-03-apparel-knowledge', error: String(err.message) })
    }

    await evaluate(setSelectScript('#agent-ticket-type', 'invoice'))
    await waitFor(`document.querySelector('#ticket-field-invoice_title')`, 8000)
    const invoice = await evaluate(collectAgent)
    evidence.steps.invoice = {
      extracting: invoice.extracting,
      hasInvoiceTitle: invoice.hasInvoiceTitle,
      hasTaxId: invoice.hasTaxId,
      hasQuantity: invoice.hasQuantity,
      hasReturnMethod: invoice.hasReturnMethod,
      fieldIds: invoice.fieldIds,
    }
    await screenshot('t020-invoice.png')
    try {
      assert(invoice.hasInvoiceTitle, 'invoice title field')
      assert(invoice.hasTaxId, 'tax_id field')
      assert(!invoice.hasQuantity, 'invoice has no quantity')
      assert(!invoice.hasReturnMethod, 'invoice has no return_method')
    } catch (err) {
      evidence.failed.push({ id: 'TC-01-invoice-fields', error: String(err.message) })
    }

    await evaluate(setSelectScript('#agent-ticket-type', 'return_exchange'))
    await waitFor(`document.querySelector('#ticket-field-return_method')`, 8000)
    await waitFor(`!document.querySelector('.extract-banner')`, 12000)
    const backReturn = await evaluate(collectAgent)
    evidence.steps.backReturn = {
      hasReturnMethod: backReturn.hasReturnMethod,
      hasQuantity: backReturn.hasQuantity,
      hasTaxId: backReturn.hasTaxId,
      hasInvoiceTitle: backReturn.hasInvoiceTitle,
    }
    try {
      assert(backReturn.hasReturnMethod && backReturn.hasQuantity, 'return fields restored')
      assert(!backReturn.hasTaxId && !backReturn.hasInvoiceTitle, 'invoice fields gone')
    } catch (err) {
      evidence.failed.push({ id: 'TC-01-return-fields', error: String(err.message) })
    }

    await evaluate(`document.querySelector('#ticket-field-product_info').focus()`)
    await evaluate(fillScript('#ticket-field-product_info', HAND_EDIT))
    await evaluate(`document.querySelector('#ticket-field-order_no').focus()`)
    await waitFor(
      `document.querySelector('#ticket-field-product_info') && document.querySelector('#ticket-field-product_info').parentElement.querySelector('.field-status')?.textContent === '坐席已改'`,
    )
    const storedAfterEdit = await evaluate(`(() => {
      try {
        const store = JSON.parse(sessionStorage.getItem('mock_tickets') || '{}')
        const ticket = Object.values(store)[0]
        return ticket?.fields?.product_info ?? null
      } catch {
        return null
      }
    })()`)
    await evaluate(setSelectScript('#agent-ticket-type', 'invoice'))
    await waitFor(`document.querySelector('#ticket-field-invoice_title')`, 8000)
    await evaluate(setSelectScript('#agent-ticket-type', 'return_exchange'))
    await waitFor(`document.querySelector('#ticket-field-product_info')`, 8000)
    await waitFor(`!document.querySelector('.extract-banner')`, 12000)
    await delay(500)
    const handEdit = await evaluate(collectAgent)
    evidence.steps.handEdit = {
      productValue: handEdit.productValue,
      productStatus: handEdit.productStatus,
      extracting: handEdit.extracting,
      storedAfterEdit,
    }
    await screenshot('t020-handedit.png')
    try {
      assert(handEdit.productValue === HAND_EDIT, 'hand-edit not overwritten', handEdit.productValue)
      assert(handEdit.productStatus === '坐席已改', 'status 坐席已改', handEdit.productStatus)
      assert(storedAfterEdit?.status === 'agent_edited', 'store persisted agent_edited', storedAfterEdit)
      assert(storedAfterEdit?.value === HAND_EDIT, 'store persisted hand-edit value', storedAfterEdit)
    } catch (err) {
      evidence.failed.push({ id: 'TC-02-agent-edited', error: String(err.message) })
    }

    await evaluate(setSelectScript('#agent-ticket-type', 'complaint'))
    await waitFor(`document.querySelector('#ticket-field-complaint_category')`, 8000)
    await waitFor(
      `(document.body.innerText || '').includes(${JSON.stringify(EMPTY_KNOWLEDGE)})`,
      8000,
    )
    const complaint = await evaluate(collectAgent)
    evidence.steps.complaint = {
      knowledgeCards: complaint.knowledgeCards.length,
      hasEmptyKnowledge: complaint.hasEmptyKnowledge,
      knowledgeText: complaint.knowledgeText,
    }
    await screenshot('t020-complaint.png')
    try {
      assert(complaint.knowledgeCards.length === 0, 'complaint no cards')
      assert(complaint.hasEmptyKnowledge, 'complaint empty copy')
    } catch (err) {
      evidence.failed.push({ id: 'TC-03-complaint-empty', error: String(err.message) })
    }

    await evaluate(setSelectScript('#agent-ticket-type', 'return_exchange'))
    await waitFor(`document.querySelector('#ticket-field-return_method')`, 8000)
    await evaluate(setSelectScript('#agent-business-line', 'apparel_beauty'))
    await waitFor(`document.querySelector('#agent-business-line').value === 'apparel_beauty'`)
    await waitFor(`!document.querySelector('.extract-banner')`, 12000)

    await send('Page.reload', { ignoreCache: true })
    await waitFor(`location.pathname === '/agent' && document.querySelector('#agent-ticket-type')`)
    await waitFor(`document.querySelector('.confirm-ticket')`)
    const afterReload = await evaluate(collectAgent)
    const storedAfterReload = await evaluate(`(() => {
      try {
        const store = JSON.parse(sessionStorage.getItem('mock_tickets') || '{}')
        const ticket = Object.values(store)[0]
        return {
          status: ticket?.status ?? null,
          extract_status: ticket?.extract_status ?? null,
          product: ticket?.fields?.product_info ?? null,
        }
      } catch {
        return null
      }
    })()`)
    evidence.steps.afterReloadDraft = {
      confirmText: afterReload.confirmText,
      typeDisabled: afterReload.typeDisabled,
      typeValue: afterReload.typeValue,
      lineValue: afterReload.lineValue,
      productValue: afterReload.productValue,
      productStatus: afterReload.productStatus,
      storedAfterReload,
    }
    try {
      assert(afterReload.confirmText === '确认工单', 'still draft after reload', afterReload.confirmText)
      assert(afterReload.typeDisabled === false, 'type still editable before confirm')
      assert(afterReload.typeValue === 'return_exchange', 'type persisted', afterReload.typeValue)
      assert(afterReload.productValue === HAND_EDIT, 'hand-edit persisted after reload', {
        ui: afterReload.productValue,
        store: storedAfterReload,
      })
      assert(afterReload.productStatus === '坐席已改', 'reload status 坐席已改', afterReload.productStatus)
    } catch (err) {
      evidence.failed.push({ id: 'TC-02-reload-draft', error: String(err.message) })
    }

    await clickNav('员工端')
    await waitFor(`location.pathname === '/employee'`)
    await waitFor(`document.querySelector('.chat-msg')`)
    const employeeBeforePolish = await evaluate(collectEmployee)
    evidence.steps.employeeBeforePolish = {
      messageCount: employeeBeforePolish.messageCount,
      otherTexts: employeeBeforePolish.otherTexts,
      hasApparelPush: employeeBeforePolish.otherTexts.some((t) => t.includes(APPAREL_PUSH)),
      hasDigitalPush: employeeBeforePolish.otherTexts.some((t) => t.includes(DIGITAL_PUSH)),
    }
    try {
      assert(!employeeBeforePolish.otherTexts.some((t) => t.includes(APPAREL_PUSH)), 'knowledge push not on employee')
      assert(!employeeBeforePolish.otherTexts.some((t) => t.includes(DIGITAL_PUSH)), '3C push not on employee')
    } catch (err) {
      evidence.failed.push({ id: 'TC-03-knowledge-not-employee', error: String(err.message) })
    }

    await clickNav('客服端')
    await waitFor(`location.pathname === '/agent' && document.querySelector('#agent-reply')`)
    await waitFor(`document.querySelectorAll('.agent-msg').length >= 3`)
    const agentMsgBeforeRisky = await evaluate(`document.querySelectorAll('.agent-msg').length`)
    await evaluate(fillScript('#agent-reply', POLISH_RISKY))
    await evaluate(`[...document.querySelectorAll('.agent-composer button')].find((b) => (b.textContent || '').includes('润色')).click()`)
    await waitFor(`document.querySelector('#agent-reply') && document.querySelector('#agent-reply').value.includes('您好')`)
    const polishedRisky = await evaluate(collectAgent)
    evidence.steps.polishRisky = {
      draft: polishedRisky.draft,
      messageCount: polishedRisky.messageCount,
      agentMsgBeforeRisky,
      hasFullRefund: Boolean(polishedRisky.draft?.includes('一定全额退') || polishedRisky.draft?.includes('全额退款')),
    }
    await screenshot('t020-polish.png')
    try {
      assert(polishedRisky.messageCount === agentMsgBeforeRisky, 'polish does not send', {
        agentMsgBeforeRisky,
        after: polishedRisky.messageCount,
      })
      assert(Boolean(polishedRisky.draft?.includes('您好')), 'polish fills composer')
      assert(!polishedRisky.draft?.includes('一定全额退'), 'no 一定全额退', polishedRisky.draft)
      assert(!polishedRisky.draft?.includes('全额退款'), 'no invented 全额退款', polishedRisky.draft)
    } catch (err) {
      evidence.failed.push({ id: 'TC-03-polish-no-refund', error: String(err.message) })
    }

    await clickNav('员工端')
    await waitFor(`location.pathname === '/employee'`)
    const employeeDuringPolish = await evaluate(collectEmployee)
    evidence.steps.employeeDuringPolish = {
      messageCount: employeeDuringPolish.messageCount,
      before: employeeBeforePolish.messageCount,
      lastOther: employeeDuringPolish.lastOther,
    }
    try {
      assert(
        employeeDuringPolish.messageCount === employeeBeforePolish.messageCount,
        'employee unchanged during polish',
        { before: employeeBeforePolish.messageCount, after: employeeDuringPolish.messageCount },
      )
    } catch (err) {
      evidence.failed.push({ id: 'TC-03-polish-not-sent', error: String(err.message) })
    }

    await clickNav('客服端')
    await waitFor(`location.pathname === '/agent' && document.querySelector('#agent-reply')`)
    await evaluate(fillScript('#agent-reply', ORIGINAL_SEND))
    await evaluate(`[...document.querySelectorAll('.agent-composer button')].find((b) => (b.textContent || '').includes('发送')).click()`)
    await waitFor(
      `[...document.querySelectorAll('.agent-bubble')].some((n) => (n.textContent || '').includes(${JSON.stringify(ORIGINAL_SEND)}))`,
    )

    await clickNav('员工端')
    await waitFor(`location.pathname === '/employee'`)
    await waitFor(
      `[...document.querySelectorAll('.chat-bubble')].some((n) => (n.textContent || '').includes(${JSON.stringify(ORIGINAL_SEND)}))`,
      8000,
    )
    const employeeAfterSend = await evaluate(collectEmployee)
    evidence.steps.employeeAfterSend = {
      messageCount: employeeAfterSend.messageCount,
      lastOther: employeeAfterSend.lastOther,
      hasOriginal: employeeAfterSend.otherTexts.some((t) => t.includes(ORIGINAL_SEND)),
      hasApparelPush: employeeAfterSend.otherTexts.some((t) => t.includes(APPAREL_PUSH)),
    }
    await screenshot('t020-employee-after-send.png')
    try {
      assert(employeeAfterSend.lastOther?.text?.includes(ORIGINAL_SEND), 'employee sees current composer text', employeeAfterSend.lastOther)
      assert(employeeAfterSend.lastOther?.tag === '客服' || employeeAfterSend.lastOther?.tag == null || employeeAfterSend.lastOther?.tag === '客服', 'agent tag', employeeAfterSend.lastOther)
      assert(!employeeAfterSend.otherTexts.some((t) => t.includes(APPAREL_PUSH)), 'still no knowledge push on employee')
    } catch (err) {
      evidence.failed.push({ id: 'TC-03-send-current-text', error: String(err.message) })
    }

    await clickNav('客服端')
    await waitFor(`location.pathname === '/agent' && document.querySelector('.confirm-ticket')`)
    await evaluate(`document.querySelector('.confirm-ticket').click()`)
    await waitFor(
      `document.querySelector('.confirm-ticket') && document.querySelector('.confirm-ticket').textContent.includes('已确认')`,
    )
    const confirmed = await evaluate(collectAgent)
    evidence.steps.confirmed = {
      confirmText: confirmed.confirmText,
      confirmDisabled: confirmed.confirmDisabled,
      typeDisabled: confirmed.typeDisabled,
      lineDisabled: confirmed.lineDisabled,
      typeValue: confirmed.typeValue,
      productDisabled: confirmed.fields.find((f) => f.id === 'ticket-field-product_info')?.disabled ?? null,
    }
    await screenshot('t020-confirmed.png')
    try {
      assert(confirmed.confirmText === '已确认', 'confirmed label', confirmed.confirmText)
      assert(confirmed.typeDisabled === true, 'type locked')
      assert(confirmed.lineDisabled === false, 'line still editable')
      assert(
        confirmed.fields.find((f) => f.id === 'ticket-field-product_info')?.disabled === false,
        'fields still editable',
      )
    } catch (err) {
      evidence.failed.push({ id: 'TC-02-confirmed-lock', error: String(err.message) })
    }

    await evaluate(setSelectScript('#agent-business-line', 'digital_3c'))
    await waitFor(`document.querySelector('#agent-business-line').value === 'digital_3c'`)
    await evaluate(fillScript('#ticket-field-quantity', '2'))
    await evaluate(`document.querySelector('#ticket-field-quantity')?.blur()`)
    const afterConfirmEdit = await evaluate(collectAgent)
    const patchType409 = await evaluate(`(async () => {
      const id = sessionStorage.getItem('conversation_id');
      const mod = await import('/src/mocks/tickets.ts');
      try {
        mod.handlePatchTicket(id, { ticket_type: 'invoice' });
        return { threw: false };
      } catch (err) {
        return { threw: true, status: err.status ?? null, error_code: err.error_code ?? null, message: err.message ?? String(err) };
      }
    })()`)
    evidence.steps.afterConfirmEdit = {
      lineValue: afterConfirmEdit.lineValue,
      quantity: afterConfirmEdit.fields.find((f) => f.id === 'ticket-field-quantity')?.value ?? null,
      typeValue: afterConfirmEdit.typeValue,
      typeDisabled: afterConfirmEdit.typeDisabled,
      patchType409,
    }
    try {
      assert(afterConfirmEdit.lineValue === 'digital_3c', 'line editable after confirm')
      assert(afterConfirmEdit.typeValue === 'return_exchange', 'type unchanged', afterConfirmEdit.typeValue)
      assert(patchType409.threw === true && patchType409.status === 409, 'confirmed type patch 409', patchType409)
    } catch (err) {
      evidence.failed.push({ id: 'TC-02-confirmed-editable', error: String(err.message) })
    }

    evidence.pass = evidence.failed.length === 0
    await writeFile(path.join(OUT_DIR, 't020-browser-evidence.json'), JSON.stringify(evidence, null, 2))
    console.log(JSON.stringify({ pass: evidence.pass, failed: evidence.failed, cdpPort: CDP_PORT }, null, 2))
    if (!evidence.pass) process.exitCode = 1
  } finally {
    try {
      if (ws) ws.close()
    } catch {}
    if (chromeProc && !chromeProc.killed) chromeProc.kill()
  }
}

main().catch(async (err) => {
  console.error(String(err && err.stack ? err.stack : err))
  try {
    await writeFile(
      path.join(OUT_DIR, 't020-browser-evidence.json'),
      JSON.stringify({ pass: false, error: String(err && err.message ? err.message : err) }, null, 2),
    )
  } catch {}
  try {
    if (ws) ws.close()
  } catch {}
  if (chromeProc && !chromeProc.killed) chromeProc.kill()
  process.exit(1)
})
