import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const BASE = process.env.T021_BASE || 'http://127.0.0.1:5206'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT_DIR = path.resolve(
  'C:\\Users\\慈海客服\\Desktop\\demo\\Develop_Helper\\Projects_Repo\\Customer_Service\\.sdd\\test-reports',
)
const CDP_PORT = Number(process.env.T021_CDP_PORT || 9453)
const DEMO_USER = process.env.T021_DEMO_USER || 'it-help'
const DEMO_PASS = process.env.T021_DEMO_PASS || ''
const DRESS_Q = '这件连衣裙能退吗'
const PRE_SALE_DRAFT = '售前核对一下退货条件。'
const APPAREL_PUSH = '签收后七日内可无理由退货，吊牌完整'
const ENVELOPE_KEYS = [
  'success',
  'data',
  'error',
  'error_code',
  'message',
  'timestamp',
  'request_id',
  'metadata',
]

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

const collectTopbar = `(() => {
  const logout = [...document.querySelectorAll('.session button')].find((b) => /退出/.test(b.textContent || ''));
  const nav = [...document.querySelectorAll('.sidebar a')].map((a) => ({
    text: a.textContent.trim(),
    active: a.classList.contains('active'),
    href: a.getAttribute('href'),
  }));
  return {
    pathname: location.pathname,
    brand: document.querySelector('.topbar-left strong')?.textContent ?? null,
    pageName: document.querySelector('.topbar-left .page-name')?.textContent ?? null,
    user: document.querySelector('.session .user')?.textContent ?? null,
    logout: logout?.textContent?.trim() ?? null,
    logoutClass: logout?.className ?? null,
    nav,
    bodyHasMock: (document.body.innerText || '').includes('[Mock]'),
  };
})()`

const collectKnowledge = `(() => {
  const rows = [...document.querySelectorAll('.kb-row')].map((row) => ({
    filename: row.querySelector('.kb-row-title')?.textContent?.trim() ?? '',
    status: row.querySelector('.kb-row-status')?.textContent?.trim() ?? row.textContent,
  }));
  return {
    pathname: location.pathname,
    rowCount: rows.length,
    filenames: rows.map((r) => r.filename),
    statuses: rows.map((r) => r.status),
    uploadHint: document.querySelector('.kb-upload-hint')?.textContent?.trim() ?? '',
    bodyHasMock: (document.body.innerText || '').includes('[Mock]'),
    topbarUser: document.querySelector('.session .user')?.textContent ?? null,
    logout: [...document.querySelectorAll('.session button')].find((b) => /退出/.test(b.textContent || ''))?.textContent?.trim() ?? null,
  };
})()`

const collectEmployee = `(() => {
  const msgs = [...document.querySelectorAll('.chat-msg')].map((n) => ({
    side: n.classList.contains('employee') ? 'employee' : 'other',
    tag: n.querySelector('.chat-msg-tag')?.textContent ?? null,
    text: n.querySelector('.chat-bubble')?.textContent ?? '',
  }));
  const composer = document.querySelector('.employee-composer');
  const chat = document.querySelector('.employee-chat');
  const cr = composer?.getBoundingClientRect();
  const tr = chat?.getBoundingClientRect();
  return {
    pathname: location.pathname,
    emptyText: document.querySelector('.employee-empty')?.textContent ?? null,
    statusText: document.querySelector('.employee-status-text')?.textContent ?? null,
    transferDisabled: document.querySelector('.employee-status button')?.disabled ?? null,
    transferText: document.querySelector('.employee-status button')?.textContent?.trim() ?? null,
    messageCount: msgs.length,
    messages: msgs,
    otherTexts: msgs.filter((m) => m.side !== 'employee').map((m) => m.text),
    hasItEmpty: (document.body.innerText || '').includes('描述你的 IT 问题'),
    bodyHasMock: (document.body.innerText || '').includes('[Mock]'),
    pinGap: cr && tr ? Math.round(tr.bottom - cr.bottom) : null,
    topbarUser: document.querySelector('.session .user')?.textContent ?? null,
    logout: [...document.querySelectorAll('.session button')].find((b) => /退出/.test(b.textContent || ''))?.textContent?.trim() ?? null,
  };
})()`

const collectAgent = `(() => {
  const body = document.body.innerText || '';
  const confirm = document.querySelector('.confirm-ticket');
  const typeEl = document.querySelector('#agent-ticket-type');
  const lineEl = document.querySelector('#agent-business-line');
  const work = document.querySelector('.agent-work');
  const list = document.querySelector('.agent-list');
  const thread = document.querySelector('.agent-thread');
  const composer = document.querySelector('.agent-composer');
  const polish = [...document.querySelectorAll('.agent-composer button')].find((b) => /润色/.test(b.textContent || ''));
  const sendBtn = [...document.querySelectorAll('.agent-composer button')].find((b) => /发送/.test(b.textContent || ''));
  const knowledgeCards = [...document.querySelectorAll('.knowledge-card')].map((n) => ({
    tag: n.querySelector('.tag')?.textContent ?? null,
    text: n.textContent ?? '',
  }));
  const msgs = [...document.querySelectorAll('.agent-msg')].map((n) => ({
    side: n.classList.contains('agent-msg-user') ? 'employee' : 'peer',
    tag: n.querySelector('.agent-tag')?.textContent ?? null,
    text: n.querySelector('.agent-bubble')?.textContent ?? '',
  }));
  const vl = list?.getBoundingClientRect();
  const vw = work?.getBoundingClientRect();
  const vt = thread?.getBoundingClientRect();
  const vc = composer?.getBoundingClientRect();
  const vconf = confirm?.getBoundingClientRect();
  const vsend = sendBtn?.getBoundingClientRect();
  const sameRow = Boolean(
    vconf && vsend && Math.abs(vconf.top - vsend.top) < 12 && Math.abs(vconf.left - vsend.left) > 40,
  );
  const bothPrimary = Boolean(
    confirm?.classList.contains('btn-primary') && sendBtn?.classList.contains('btn-primary'),
  );
  return {
    href: location.href,
    pathname: location.pathname,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    bodyHasMock: body.includes('[Mock]'),
    emptyText: document.querySelector('.agent-thread .agent-empty')?.textContent ?? null,
    listCount: document.querySelectorAll('.agent-row').length,
    confirmText: confirm?.textContent?.trim() ?? null,
    confirmDisabled: confirm ? confirm.disabled : null,
    confirmClass: confirm?.className ?? null,
    typeValue: typeEl?.value ?? null,
    typeDisabled: typeEl ? typeEl.disabled : null,
    lineValue: lineEl?.value ?? null,
    draft: composer ? document.querySelector('#agent-reply')?.value ?? null : null,
    polishClass: polish?.className ?? null,
    sendClass: sendBtn?.className ?? null,
    knowledgeCards,
    knowledgeText: knowledgeCards.map((c) => c.text).join('\\n'),
    hasApparelPush: knowledgeCards.some((c) => (c.text || '').includes(${JSON.stringify(APPAREL_PUSH)})),
    hasSendToUserButton: [...document.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === '发给用户'),
    messageCount: msgs.length,
    messages: msgs,
    peerTexts: msgs.filter((m) => m.side === 'peer').map((m) => m.text),
    topbarUser: document.querySelector('.session .user')?.textContent ?? null,
    logout: [...document.querySelectorAll('.session button')].find((b) => /退出/.test(b.textContent || ''))?.textContent?.trim() ?? null,
    list: vl ? { w: Math.round(vl.width), h: Math.round(vl.height), top: Math.round(vl.top) } : null,
    work: vw ? { w: Math.round(vw.width), h: Math.round(vw.height), top: Math.round(vw.top), bottom: Math.round(vw.bottom) } : null,
    thread: vt ? { w: Math.round(vt.width), h: Math.round(vt.height), top: Math.round(vt.top), bottom: Math.round(vt.bottom) } : null,
    pinGap: vc && vt ? Math.round(vt.bottom - vc.bottom) : null,
    sameRow,
    bothPrimary,
    sideBySideEqualPrimary: Boolean(
      sameRow &&
        bothPrimary &&
        vconf &&
        vsend &&
        Math.abs(vconf.width - vsend.width) < 48,
    ),
    workBelowThread: Boolean(vw && vt && vw.top >= vt.bottom - 4),
    listHeightRatio: vl ? Number((vl.height / window.innerHeight).toFixed(3)) : null,
  };
})()`

const collectStore = `(() => {
  const convRaw = sessionStorage.getItem('mock_conversations');
  const ticketRaw = sessionStorage.getItem('mock_tickets');
  const convId = sessionStorage.getItem('conversation_id');
  const convs = convRaw ? JSON.parse(convRaw) : {};
  const tickets = ticketRaw ? JSON.parse(ticketRaw) : {};
  const conv = convId ? convs[convId] : null;
  const ticket = convId ? tickets[convId] : null;
  return {
    conversationId: convId,
    convStatus: conv?.status ?? null,
    convMessageCount: conv?.messages?.length ?? 0,
    ticketConversationId: ticket?.conversation_id ?? null,
    ticketStatus: ticket?.status ?? null,
    ticketType: ticket?.ticket_type ?? null,
    sameId: Boolean(convId && ticket && ticket.conversation_id === convId),
  };
})()`

function assert(cond, label, extra) {
  if (!cond) {
    const detail = extra === undefined ? '' : ` ${JSON.stringify(extra)}`
    throw new Error(`ASSERT FAIL: ${label}${detail}`)
  }
}

function missingEnvelopeKeys(env) {
  if (!env || typeof env !== 'object') return ENVELOPE_KEYS.slice()
  return ENVELOPE_KEYS.filter((key) => !(key in env))
}

async function main() {
  if (!DEMO_PASS) throw new Error('missing T021_DEMO_PASS')
  await mkdir(OUT_DIR, { recursive: true })
  const userData = await mkdtemp(path.join(os.tmpdir(), 't021-chrome-'))
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

  async function setViewport(width, height) {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await delay(200)
  }

  const evidence = {
    mock: true,
    base: BASE,
    viewport: '1440x900 then 900x800',
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
    assert(health.status === 200, 'vite 5206 HTTP 200', health.status)

    await goto(`${BASE}/login`)
    await waitFor(`document.querySelector('.login-card')`)
    await screenshot('t021-login.png')
    await evaluate(fillScript('#user', 'wrong-user'))
    await evaluate(fillScript('#pass', 'wrong-pass'))
    await evaluate(`document.querySelector('button[type="submit"]').click()`)
    await waitFor(`(document.body.innerText || '').includes('用户名或密码')`, 8000)
    const badLogin = await evaluate(`({
      pathname: location.pathname,
      error: document.querySelector('.error-text, [role="alert"]')?.textContent || document.body.innerText,
      stillLogin: Boolean(document.querySelector('.login-card')),
    })`)
    evidence.steps.badLogin = {
      pathname: badLogin.pathname,
      stillLogin: badLogin.stillLogin,
      hasError: String(badLogin.error || '').includes('用户名或密码'),
    }
    try {
      assert(badLogin.stillLogin, 'wrong password stays on login')
      assert(badLogin.pathname === '/login' || /login/.test(badLogin.pathname), 'login path', badLogin.pathname)
      assert(String(badLogin.error || '').includes('用户名或密码'), 'login error copy')
    } catch (err) {
      evidence.failed.push({ id: 'TC-01-login-fail', error: String(err.message) })
    }

    await evaluate(fillScript('#user', DEMO_USER))
    await evaluate(fillScript('#pass', DEMO_PASS))
    await evaluate(`document.querySelector('button[type="submit"]').click()`)
    await waitFor(`document.querySelector('.employee-chat') && location.pathname === '/employee'`)

    await clickNav('知识库')
    await waitFor(`location.pathname === '/knowledge' && document.querySelector('.kb-page')`)
    await waitFor(`document.querySelectorAll('.kb-row').length > 0`)
    const knowledge = await evaluate(collectKnowledge)
    const knowledgeTop = await evaluate(collectTopbar)
    evidence.steps.knowledge = {
      rowCount: knowledge.rowCount,
      filenames: knowledge.filenames,
      uploadHint: knowledge.uploadHint,
      bodyHasMock: knowledge.bodyHasMock,
      topbar: knowledgeTop,
    }
    await screenshot('t021-knowledge.png')
    try {
      assert(knowledge.pathname === '/knowledge', 'knowledge path')
      assert(knowledge.rowCount >= 3, 'knowledge list has rows', knowledge.rowCount)
      assert(
        knowledge.filenames.some((n) => n.includes('wifi-reset.txt')) &&
          knowledge.filenames.some((n) => n.includes('vpn-faq.md')) &&
          knowledge.filenames.some((n) => n.includes('scan-only.pdf')) &&
          !knowledge.filenames.some((n) => n.includes('wifi-reset.md')),
        'original filenames kept',
        knowledge.filenames,
      )
      assert(knowledge.bodyHasMock, '[Mock] on knowledge')
      assert(
        String(knowledge.uploadHint).includes('支持 Markdown、TXT，以及能抽出文字的 PDF'),
        'upload hint',
        knowledge.uploadHint,
      )
      assert(Boolean(knowledgeTop.user?.includes('it-help')), 'knowledge topbar user', knowledgeTop.user)
      assert(knowledgeTop.logout === '退出', 'knowledge logout')
    } catch (err) {
      evidence.failed.push({ id: 'TC-01-knowledge', error: String(err.message) })
    }

    await clickNav('员工端')
    await waitFor(`location.pathname === '/employee' && document.querySelector('.employee-chat')`)
    const emptyEmployee = await evaluate(collectEmployee)
    const employeeTop = await evaluate(collectTopbar)
    evidence.steps.emptyEmployee = {
      emptyText: emptyEmployee.emptyText,
      hasItEmpty: emptyEmployee.hasItEmpty,
      bodyHasMock: emptyEmployee.bodyHasMock,
      statusText: emptyEmployee.statusText,
      pinGap: emptyEmployee.pinGap,
      topbar: employeeTop,
    }
    await screenshot('t021-employee-empty.png')
    try {
      assert(
        Boolean(emptyEmployee.emptyText?.includes('描述你的购物问题')),
        'shopping empty copy',
        emptyEmployee.emptyText,
      )
      assert(Boolean(emptyEmployee.emptyText?.includes('[Mock]')), '[Mock] on empty', emptyEmployee.emptyText)
      assert(!emptyEmployee.hasItEmpty, 'no IT empty copy')
      assert(employeeTop.user === knowledgeTop.user, 'topbar user matches knowledge', {
        employee: employeeTop.user,
        knowledge: knowledgeTop.user,
      })
      assert(employeeTop.logout === '退出' && knowledgeTop.logout === '退出', 'logout label')
    } catch (err) {
      evidence.failed.push({ id: 'TC-01-employee-empty', error: String(err.message) })
    }

    await clickNav('客服端')
    await waitFor(`location.pathname === '/agent' && document.querySelector('.agent-inbox')`)
    const emptyAgent = await evaluate(collectAgent)
    evidence.steps.emptyAgent = {
      listCount: emptyAgent.listCount,
      emptyText: emptyAgent.emptyText,
      confirmText: emptyAgent.confirmText,
      topbarUser: emptyAgent.topbarUser,
    }
    await screenshot('t021-agent-empty.png')
    try {
      assert(emptyAgent.listCount === 0, 'no untransferred sessions', emptyAgent.listCount)
      assert(!emptyAgent.confirmText, 'no confirm before handoff', emptyAgent.confirmText)
      assert(
        Boolean(emptyAgent.emptyText?.includes('还没有需要人工处理的对话')),
        'agent empty copy',
        emptyAgent.emptyText,
      )
    } catch (err) {
      evidence.failed.push({ id: 'TC-01-no-ticket-before-handoff', error: String(err.message) })
    }

    await clickNav('员工端')
    await waitFor(`location.pathname === '/employee' && document.querySelector('.employee-composer textarea')`)
    await evaluate(fillScript('.employee-composer textarea', DRESS_Q))
    await evaluate(`document.querySelector('.employee-composer button[type="submit"]').click()`)
    await waitFor(`document.querySelectorAll('.chat-msg').length >= 2`)
    const afterAsk = await evaluate(collectEmployee)
    evidence.steps.afterAsk = {
      messageCount: afterAsk.messageCount,
      otherTexts: afterAsk.otherTexts,
      statusText: afterAsk.statusText,
    }
    try {
      assert(afterAsk.messageCount >= 2, 'employee send produced reply', afterAsk.messageCount)
      assert(!afterAsk.transferDisabled, 'can handoff after ask')
    } catch (err) {
      evidence.failed.push({ id: 'TC-01-employee-send', error: String(err.message) })
    }

    await evaluate(`document.querySelector('.employee-status button').click()`)
    await waitFor(
      `document.querySelector('.employee-status-text') && document.querySelector('.employee-status-text').textContent.includes('已转人工')`,
    )
    const afterHandoff = await evaluate(collectEmployee)
    evidence.steps.afterHandoff = {
      statusText: afterHandoff.statusText,
      transferDisabled: afterHandoff.transferDisabled,
      transferText: afterHandoff.transferText,
    }

    await clickNav('客服端')
    await waitFor(`location.pathname === '/agent'`)
    await waitFor(`document.querySelector('.agent-row')`)
    await waitFor(`document.querySelector('#agent-ticket-type') && document.querySelector('#agent-business-line')`)
    const draft = await evaluate(collectAgent)
    const storeDraft = await evaluate(collectStore)
    evidence.conversationId = storeDraft.conversationId
    evidence.steps.draft = {
      listCount: draft.listCount,
      confirmDisabled: draft.confirmDisabled,
      typeValue: draft.typeValue,
      lineValue: draft.lineValue,
      bodyHasMock: draft.bodyHasMock,
      listWidth: draft.list?.w,
      workWidth: draft.work?.w,
      pinGap: draft.pinGap,
      sideBySideEqualPrimary: draft.sideBySideEqualPrimary,
      sameRow: draft.sameRow,
      polishClass: draft.polishClass,
      sendClass: draft.sendClass,
      confirmClass: draft.confirmClass,
      store: storeDraft,
      topbarUser: draft.topbarUser,
    }
    await screenshot('t021-draft.png')
    try {
      assert(draft.listCount >= 1, 'handed-off session listed', draft.listCount)
      assert(draft.confirmDisabled === true, 'confirm disabled without type', draft)
      assert(draft.typeValue === '', 'type empty 售前', draft.typeValue)
      assert(draft.bodyHasMock, '[Mock] on agent')
      assert(storeDraft.sameId, 'ticket uses same conversation store id', storeDraft)
      assert(storeDraft.convStatus === 'handed_off', 'conversation handed_off', storeDraft)
      assert(draft.list?.w === 320, 'UI-03 left 320', draft.list)
      assert(draft.work?.w === 360, 'UI-03 right 360', draft.work)
      assert(draft.pinGap === 0 || draft.pinGap === 16, 'composer pinned at 1440', draft.pinGap)
      assert(!draft.sideBySideEqualPrimary, 'confirm/send not equal primary side by side at 1440', {
        sameRow: draft.sameRow,
        sideBySideEqualPrimary: draft.sideBySideEqualPrimary,
        polishClass: draft.polishClass,
        sendClass: draft.sendClass,
        confirmClass: draft.confirmClass,
      })
      assert(Boolean(draft.polishClass?.includes('btn-secondary')), 'polish is secondary', draft.polishClass)
      assert(Boolean(draft.sendClass?.includes('btn-primary')), 'send is primary', draft.sendClass)
    } catch (err) {
      evidence.failed.push({ id: 'TC-01-draft-and-layout-1440', error: String(err.message) })
    }

    await evaluate(fillScript('#agent-reply', PRE_SALE_DRAFT))
    const beforePolish = await evaluate(`document.querySelectorAll('.agent-msg').length`)
    await evaluate(
      `[...document.querySelectorAll('.agent-composer button')].find((b) => (b.textContent || '').includes('润色')).click()`,
    )
    await waitFor(`document.querySelector('#agent-reply') && document.querySelector('#agent-reply').value.includes('您好')`)
    const polished = await evaluate(collectAgent)
    evidence.steps.polish = {
      before: beforePolish,
      after: polished.messageCount,
      draft: polished.draft,
      confirmDisabled: polished.confirmDisabled,
    }
    await screenshot('t021-polish.png')
    try {
      assert(polished.messageCount === beforePolish, 'polish does not auto-send', {
        before: beforePolish,
        after: polished.messageCount,
      })
      assert(Boolean(polished.draft?.includes('您好')), 'polish fills composer', polished.draft)
      assert(polished.confirmDisabled === true, 'still cannot confirm 售前')
    } catch (err) {
      evidence.failed.push({ id: 'TC-01-polish-no-autosend', error: String(err.message) })
    }

    await evaluate(
      `[...document.querySelectorAll('.agent-composer button')].find((b) => (b.textContent || '').includes('发送')).click()`,
    )
    await waitFor(`document.querySelectorAll('.agent-msg').length > ${beforePolish}`)
    const afterSend = await evaluate(collectAgent)
    evidence.steps.presaleSend = {
      lastPeer: afterSend.messages.filter((m) => m.side === 'peer').at(-1) ?? null,
      confirmDisabled: afterSend.confirmDisabled,
      messageCount: afterSend.messageCount,
    }
    try {
      assert(
        Boolean(afterSend.messages.filter((m) => m.side === 'peer').at(-1)?.text?.includes('您好')),
        'send uses polished text',
        afterSend.messages.filter((m) => m.side === 'peer').at(-1),
      )
      assert(afterSend.confirmDisabled === true, 'send does not enable confirm')
    } catch (err) {
      evidence.failed.push({ id: 'TC-01-presale-send', error: String(err.message) })
    }

    await evaluate(setSelectScript('#agent-business-line', 'apparel_beauty'))
    await evaluate(setSelectScript('#agent-ticket-type', 'return_exchange'))
    await waitFor(
      `[...document.querySelectorAll('.knowledge-card')].some((n) => (n.textContent || '').includes(${JSON.stringify(APPAREL_PUSH)}))`,
      8000,
    )
    const withKnowledge = await evaluate(collectAgent)
    evidence.steps.knowledgePush = {
      hasApparelPush: withKnowledge.hasApparelPush,
      hasSendToUserButton: withKnowledge.hasSendToUserButton,
      cardCount: withKnowledge.knowledgeCards.length,
      confirmDisabled: withKnowledge.confirmDisabled,
    }
    await screenshot('t021-knowledge-push.png')
    try {
      assert(withKnowledge.hasApparelPush, 'agent sees apparel knowledge push')
      assert(!withKnowledge.hasSendToUserButton, 'no 发给用户 button')
    } catch (err) {
      evidence.failed.push({ id: 'TC-01-agent-knowledge', error: String(err.message) })
    }

    await clickNav('员工端')
    await waitFor(`location.pathname === '/employee' && document.querySelector('.employee-chat')`)
    const employeeAfterPush = await evaluate(collectEmployee)
    evidence.steps.employeeAfterPush = {
      otherTexts: employeeAfterPush.otherTexts,
      messageCount: employeeAfterPush.messageCount,
      hasPush: employeeAfterPush.otherTexts.some((t) => (t || '').includes(APPAREL_PUSH)),
      hasPolished: employeeAfterPush.otherTexts.some((t) => (t || '').includes('您好')),
    }
    await screenshot('t021-employee-after-push.png')
    try {
      assert(
        !employeeAfterPush.otherTexts.some((t) => (t || '').includes(APPAREL_PUSH)),
        'knowledge push not in employee thread',
        employeeAfterPush.otherTexts,
      )
      assert(
        employeeAfterPush.otherTexts.some((t) => (t || '').includes('您好')),
        'employee sees sent polished reply',
        employeeAfterPush.otherTexts,
      )
    } catch (err) {
      evidence.failed.push({ id: 'TC-01-push-not-in-employee', error: String(err.message) })
    }

    await clickNav('客服端')
    await waitFor(`location.pathname === '/agent' && document.querySelector('#agent-ticket-type')`)
    await waitFor(`document.querySelector('.confirm-ticket') && !document.querySelector('.confirm-ticket').disabled`, 8000)
    await evaluate(`document.querySelector('.confirm-ticket').click()`)
    await waitFor(
      `document.querySelector('.confirm-ticket') && (document.querySelector('.confirm-ticket').textContent || '').includes('已确认')`,
      8000,
    )
    const confirmed = await evaluate(collectAgent)
    const storeConfirmed = await evaluate(collectStore)
    evidence.steps.confirmed = {
      confirmText: confirmed.confirmText,
      typeDisabled: confirmed.typeDisabled,
      typeValue: confirmed.typeValue,
      store: storeConfirmed,
    }
    await screenshot('t021-confirmed.png')
    try {
      assert(Boolean(confirmed.confirmText?.includes('已确认')), 'confirm label', confirmed.confirmText)
      assert(confirmed.typeDisabled === true, 'type locked after confirm', confirmed)
      assert(confirmed.typeValue === 'return_exchange', 'type stays return_exchange', confirmed.typeValue)
      assert(storeConfirmed.ticketStatus === 'confirmed', 'store confirmed', storeConfirmed)
    } catch (err) {
      evidence.failed.push({ id: 'TC-01-type-locked', error: String(err.message) })
    }

    await setViewport(900, 800)
    await delay(300)
    const narrow = await evaluate(collectAgent)
    evidence.steps.narrow = {
      viewport: narrow.viewport,
      list: narrow.list,
      work: narrow.work,
      thread: narrow.thread,
      pinGap: narrow.pinGap,
      workBelowThread: narrow.workBelowThread,
      listHeightRatio: narrow.listHeightRatio,
      sameRow: narrow.sameRow,
      sideBySideEqualPrimary: narrow.sideBySideEqualPrimary,
      polishClass: narrow.polishClass,
      sendClass: narrow.sendClass,
      confirmClass: narrow.confirmClass,
    }
    await screenshot('t021-narrow.png')
    try {
      assert(narrow.viewport.w < 1024, 'viewport narrower than 1024', narrow.viewport)
      assert(narrow.pinGap === 0 || narrow.pinGap === 16, 'composer still pinned when narrow', narrow.pinGap)
      assert(narrow.workBelowThread === true, 'workbench below thread when narrow', {
        work: narrow.work,
        thread: narrow.thread,
      })
      assert(
        narrow.listHeightRatio != null && Math.abs(narrow.listHeightRatio - 0.4) < 0.08,
        'list ~40vh',
        narrow.listHeightRatio,
      )
      assert(!narrow.sideBySideEqualPrimary, 'confirm/send not equal primary side by side when narrow', narrow)
    } catch (err) {
      evidence.failed.push({ id: 'TC-02-narrow-layout', error: String(err.message) })
    }

    await setViewport(1440, 900)
    const topbars = {}
    for (const label of ['员工端', '客服端', '知识库']) {
      await clickNav(label)
      const expectedPath = label === '员工端' ? '/employee' : label === '客服端' ? '/agent' : '/knowledge'
      await waitFor(`location.pathname === '${expectedPath}'`)
      topbars[label] = await evaluate(collectTopbar)
    }
    evidence.steps.topbars = topbars
    try {
      const users = Object.values(topbars).map((t) => t.user)
      const logouts = Object.values(topbars).map((t) => t.logout)
      assert(
        users.every((u) => u === users[0] && Boolean(u?.includes('已登录')) && Boolean(u?.includes('it-help'))),
        'topbar username consistent',
        users,
      )
      assert(
        logouts.every((v) => v === '退出'),
        'logout consistent',
        logouts,
      )
      assert(
        Object.values(topbars).every((t) => t.logoutClass?.includes('btn-secondary')),
        'logout is secondary button',
        Object.values(topbars).map((t) => t.logoutClass),
      )
    } catch (err) {
      evidence.failed.push({ id: 'TC-02-topbar', error: String(err.message) })
    }

    const envelopes = await evaluate(`(async () => {
      const keys = ${JSON.stringify(ENVELOPE_KEYS)};
      const missing = (env) => keys.filter((k) => !(k in (env || {})));
      const auth = await import('/src/mocks/auth.ts');
      const docs = await import('/src/mocks/documents.ts');
      const conv = await import('/src/mocks/conversations.ts');
      const tickets = await import('/src/mocks/tickets.ts');
      const id = sessionStorage.getItem('conversation_id');
      const login = auth.buildLoginSuccess();
      const list = docs.mockListDocuments(1, 20);
      const detail = conv.mockGetConversation(id);
      const ticket = tickets.handleGetTicket(id);
      const knowledge = tickets.handleKnowledgeSuggestions(id);
      const polish = tickets.handlePolishReply(id, { content: '核对一下进度' });
      return {
        loginMissing: missing(login),
        loginHasToken: Boolean(login?.data?.access_token),
        listMissing: missing(list?.envelope),
        listHasPagination: Boolean(list?.envelope?.pagination),
        detailMissing: missing(detail),
        ticketMissing: missing(ticket),
        knowledgeMissing: missing(knowledge),
        polishMissing: missing(polish),
        polishDoesNotSend: Boolean(polish?.data?.polished_content) && !polish?.data?.message_id,
      };
    })()`)
    evidence.steps.envelopes = envelopes
    try {
      assert(envelopes.loginMissing.length === 0, 'login envelope keys', envelopes.loginMissing)
      assert(envelopes.listMissing.length === 0, 'list envelope keys', envelopes.listMissing)
      assert(envelopes.detailMissing.length === 0, 'conversation envelope keys', envelopes.detailMissing)
      assert(envelopes.ticketMissing.length === 0, 'ticket envelope keys', envelopes.ticketMissing)
      assert(envelopes.knowledgeMissing.length === 0, 'knowledge envelope keys', envelopes.knowledgeMissing)
      assert(envelopes.polishMissing.length === 0, 'polish envelope keys', envelopes.polishMissing)
      assert(envelopes.listHasPagination, 'list pagination present')
    } catch (err) {
      evidence.failed.push({ id: 'TC-03-envelope', error: String(err.message) })
    }

    evidence.pass = evidence.failed.length === 0
    await writeFile(path.join(OUT_DIR, 't021-browser-evidence.json'), JSON.stringify(evidence, null, 2))
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
      path.join(OUT_DIR, 't021-browser-evidence.json'),
      JSON.stringify({ pass: false, error: String(err && err.message ? err.message : err) }, null, 2),
    )
  } catch {}
  try {
    if (ws) ws.close()
  } catch {}
  if (chromeProc && !chromeProc.killed) chromeProc.kill()
  process.exit(1)
})
