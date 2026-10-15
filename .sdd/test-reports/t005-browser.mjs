import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const BASE = 'http://127.0.0.1:5199'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT_DIR = path.resolve(
  'C:\\Users\\慈海客服\\Desktop\\demo\\Develop_Helper\\Projects_Repo\\Customer_Service\\.sdd\\test-reports',
)
const CDP_PORT = 9335
const FALLBACK =
  '抱歉，这个问题我暂时无法根据现有知识准确回答。你可以换个说法再问，或点击转人工。'
const CLARIFY = '请问出问题的是哪套系统或设备？'
const FAQ_ANSWER = '请检查是否在安全模式启动'
const SMALL_TALK = '你好，我是内部 IT 助手'
const AGENT_REPLY = '已帮你报修，工单稍后代登'
const LONG_MSG =
  '这是一条用于验证长消息滚动的测试内容。'.repeat(40) +
  'Outlook 相关说明请不要把顶栏挤出视口。'

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
    const text =
      result.exceptionDetails.exception?.description ||
      result.exceptionDetails.text ||
      result.exceptionDetails.text
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

const collectShell = `(() => {
  const topbar = document.querySelector('.topbar');
  const sidebar = document.querySelector('.sidebar');
  const nav = [...document.querySelectorAll('.sidebar a')].map((a) => ({
    text: a.textContent.trim(),
    href: a.getAttribute('href'),
    ariaCurrent: a.getAttribute('aria-current'),
    className: a.className,
    active: a.classList.contains('active') || a.getAttribute('aria-current') === 'page',
  }));
  const topRect = topbar?.getBoundingClientRect();
  const sideRect = sidebar?.getBoundingClientRect();
  const sideCs = sidebar ? getComputedStyle(sidebar) : null;
  return {
    pathname: location.pathname,
    title: document.querySelector('.page-name')?.textContent ?? null,
    topbarUser: document.querySelector('.session .user')?.textContent ?? null,
    logoutText: document.querySelector('.session button')?.textContent?.trim() ?? null,
    nav,
    activeNav: nav.filter((n) => n.active).map((n) => n.text),
    activeCount: nav.filter((n) => n.active).length,
    pageHasMock: (document.body.innerText || '').includes('[Mock]'),
    layout: {
      topbarHeight: topbar ? getComputedStyle(topbar).height : null,
      topbarTop: topRect ? Math.round(topRect.top) : null,
      topbarBottom: topRect ? Math.round(topRect.bottom) : null,
      sidebarFlex: sideCs?.flexDirection ?? null,
      sidebarWidth: sideRect ? Math.round(sideRect.width) : null,
      sidebarHeight: sideRect ? Math.round(sideRect.height) : null,
      viewport: { w: window.innerWidth, h: window.innerHeight },
    },
  };
})()`

const collectLogin = `(() => {
  return {
    pathname: location.pathname,
    formAlert: document.querySelector('[role="alert"]')?.textContent ?? '',
    hasLoggedOutHint: (document.body.innerText || '').includes('当前未登录'),
    tokenPresent: Boolean(localStorage.getItem('access_token')),
    pageHasMock: (document.body.innerText || '').includes('[Mock]'),
  };
})()`

const collectChat = `(() => {
  const status = document.querySelector('.employee-status-text');
  const transfer = [...document.querySelectorAll('.employee-status button')].at(0);
  const msgs = [...document.querySelectorAll('.chat-msg')].map((n) => ({
    side: n.classList.contains('employee') ? 'employee' : 'other',
    tag: n.querySelector('.chat-msg-tag')?.textContent ?? null,
    text: n.querySelector('.chat-bubble')?.textContent ?? '',
    rewrite: n.querySelector('.chat-rewrite')?.textContent ?? null,
  }));
  const composer = document.querySelector('.employee-composer');
  const messages = document.querySelector('.employee-messages');
  const topbar = document.querySelector('.topbar');
  const composerRect = composer?.getBoundingClientRect();
  const msgRect = messages?.getBoundingClientRect();
  const topRect = topbar?.getBoundingClientRect();
  return {
    pathname: location.pathname,
    statusText: status?.textContent ?? null,
    transferText: transfer?.textContent?.trim() ?? null,
    transferDisabled: transfer ? transfer.disabled : null,
    messageCount: msgs.length,
    messages: msgs,
    lastEmployee: msgs.filter((m) => m.side === 'employee').at(-1) ?? null,
    lastOther: msgs.filter((m) => m.side === 'other').at(-1) ?? null,
    systemTags: msgs.filter((m) => m.side === 'other').map((m) => m.tag),
    otherCount: msgs.filter((m) => m.side === 'other').length,
    agentBubbles: msgs.filter((m) => m.tag === '客服'),
    conversationId: sessionStorage.getItem('conversation_id'),
    storeKeys: Object.keys(JSON.parse(sessionStorage.getItem('mock_conversations') || '{}')),
    pageHasMock: (document.body.innerText || '').includes('[Mock]'),
    composer: composer && composerRect ? {
      minHeight: getComputedStyle(composer).minHeight,
      pinGap: window.innerHeight - composerRect.bottom,
      flexShrink: getComputedStyle(composer).flexShrink,
      bottom: Math.round(composerRect.bottom),
    } : null,
    overlap: topRect && msgRect ? {
      topbarTop: Math.round(topRect.top),
      topbarBottom: Math.round(topRect.bottom),
      messagesTop: Math.round(msgRect.top),
      messagesCoversTopbar: msgRect.top < topRect.bottom - 1,
      composerCoversTopbar: composerRect ? composerRect.top < topRect.bottom - 1 : null,
    } : null,
  };
})()`

const collectKb = `(() => {
  const rows = [...document.querySelectorAll('.kb-row')].map((row) => ({
    filename: row.querySelector('.kb-row-title')?.textContent?.trim() ?? '',
    statusText: row.querySelector('.hint')?.innerText?.replace(/\\s+/g, ' ').trim() ?? '',
    selected: row.classList.contains('selected'),
  }));
  const detail = document.querySelector('.kb-detail');
  const chunks = [...document.querySelectorAll('.kb-chunk')].map((chunk) => ({
    meta: chunk.querySelector('.kb-chunk-meta')?.textContent?.trim() ?? '',
    hasInput: Boolean(chunk.querySelector('textarea, input')),
    contentEditable: chunk.querySelector('.kb-chunk-body')?.getAttribute('contenteditable'),
  }));
  const editForm = document.querySelector('form.kb-edit');
  return {
    pathname: location.pathname,
    rows,
    rowCount: rows.length,
    filenames: rows.map((r) => r.filename),
    statuses: rows.map((r) => r.statusText),
    detailText: detail?.innerText ?? '',
    hasChunks: chunks.length > 0,
    chunkCount: chunks.length,
    chunks,
    hasEditForm: Boolean(editForm),
    saveButtons: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => t.includes('保存')),
    uploadError: document.querySelector('.kb-upload [role="alert"]')?.textContent?.trim() ?? '',
    pageHasMock: (document.body.innerText || '').includes('[Mock]'),
  };
})()`

const collectAgent = `(() => {
  const rows = [...document.querySelectorAll('.agent-row')].map((row) => ({
    title: row.querySelector('.agent-row-title')?.textContent ?? '',
    meta: row.querySelector('.agent-row-meta')?.textContent ?? '',
    selected: row.classList.contains('selected'),
  }));
  const msgs = [...document.querySelectorAll('.agent-msg')].map((n) => ({
    tag: n.querySelector('.agent-tag')?.textContent ?? null,
    text: n.querySelector('.agent-bubble')?.textContent ?? '',
    rewrite: n.querySelector('.agent-rewrite')?.textContent ?? null,
    user: n.classList.contains('agent-msg-user'),
  }));
  const composer = document.querySelector('.agent-composer');
  const composerRect = composer?.getBoundingClientRect();
  const empty = [...document.querySelectorAll('.agent-empty')].map((n) => n.textContent.trim());
  return {
    pathname: location.pathname,
    empty,
    rowCount: rows.length,
    rows,
    messageCount: msgs.length,
    messages: msgs,
    hasRewrite: msgs.some((m) => Boolean(m.rewrite)),
    agentBubbles: msgs.filter((m) => m.tag === '客服'),
    textareaDisabled: document.querySelector('.agent-composer textarea')?.disabled ?? null,
    replyDisabled: document.querySelector('.agent-composer button[type="submit"]')?.disabled ?? null,
    pageHasMock: (document.body.innerText || '').includes('[Mock]'),
    composer: composer && composerRect ? {
      minHeight: getComputedStyle(composer).minHeight,
      pinGap: window.innerHeight - composerRect.bottom,
      flexShrink: getComputedStyle(composer).flexShrink,
    } : null,
  };
})()`

async function sendChat(text) {
  const before = await evaluate(`document.querySelectorAll('.chat-msg').length`)
  await evaluate(fillScript('.employee-composer textarea', text))
  await evaluate(`document.querySelector('.employee-composer button[type="submit"]').click()`)
  await waitFor(`document.querySelectorAll('.chat-msg').length > ${before}`)
  await waitFor(
    `document.querySelector('.employee-composer textarea') && !document.querySelector('.employee-composer textarea').disabled`,
  )
  return evaluate(collectChat)
}

async function clickNav(label) {
  await evaluate(`(() => {
    const a = [...document.querySelectorAll('.sidebar a')].find((el) => el.textContent.trim() === ${JSON.stringify(label)});
    if (!a) throw new Error('missing nav ' + ${JSON.stringify(label)});
    a.click();
  })()`)
}

async function setViewport(width, height) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  })
}

async function setInputFile(name, content, mime = 'text/plain') {
  return evaluate(`(() => {
    const input = document.querySelector('#kb-file');
    if (!input) throw new Error('missing #kb-file');
    const file = new File([${JSON.stringify(content)}], ${JSON.stringify(name)}, { type: ${JSON.stringify(mime)} });
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return input.files[0] ? { name: input.files[0].name, size: input.files[0].size } : null;
  })()`)
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const userData = await mkdtemp(path.join(os.tmpdir(), 't005-chrome-'))
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
  await setViewport(1440, 900)

  async function goto(url) {
    const nav = send('Page.navigate', { url })
    await Promise.race([send('Page.loadEventFired').catch(() => null), delay(3000)])
    await nav
  }

  const evidence = { mock: true, viewport: '1440x900', steps: [] }

  await goto(`${BASE}/login`)
  await waitFor(`document.querySelector('.login-card')`)
  await evaluate(fillScript('#user', 'it-help'))
  await evaluate(fillScript('#pass', 'wrong-password'))
  await evaluate(`document.querySelector('button[type="submit"]').click()`)
  await waitFor(`(document.querySelector('[role="alert"]')?.textContent || '').includes('用户名或密码错误')`)
  const wrong = await evaluate(collectLogin)
  evidence.wrongPassword = {
    pathname: wrong.pathname,
    formAlert: wrong.formAlert,
    tokenPresent: wrong.tokenPresent,
    pageHasMock: wrong.pageHasMock,
    screenshot: await screenshot('t005-wrong-password.png'),
  }

  await evaluate(fillScript('#pass', 'it-help123'))
  await evaluate(`document.querySelector('button[type="submit"]').click()`)
  await waitFor(`document.querySelector('.app') && location.pathname === '/employee'`)
  const employeeShell = await evaluate(collectShell)
  evidence.employeeShell = {
    ...employeeShell,
    screenshot: await screenshot('t005-employee-shell.png'),
  }

  await clickNav('客服端')
  await waitFor(`location.pathname === '/agent'`)
  const agentBefore = await evaluate(collectAgent)
  const waitStart = Date.now()
  let demoAppeared = false
  let demoElapsed = 0
  while (Date.now() - waitStart < 3500) {
    const snap = await evaluate(collectAgent)
    demoElapsed = Date.now() - waitStart
    if (snap.rowCount > 0) {
      demoAppeared = true
      break
    }
    await delay(200)
  }
  if (!demoAppeared) demoElapsed = Date.now() - waitStart
  const agentEmpty = await evaluate(collectAgent)
  const agentShell = await evaluate(collectShell)
  evidence.agentEmptyWait = {
    firstRowCount: agentBefore.rowCount,
    empty: agentEmpty.empty,
    rowCount: agentEmpty.rowCount,
    demoAppeared,
    waitedMs: demoElapsed,
    shell: agentShell,
    screenshot: await screenshot('t005-agent-empty.png'),
  }

  await clickNav('知识库')
  await waitFor(`location.pathname === '/knowledge'`)
  await waitFor(`document.querySelectorAll('.kb-row').length > 0`, 8000)
  const knowledgeShell = await evaluate(collectShell)
  evidence.knowledgeShell = knowledgeShell
  const kbBefore = await evaluate(collectKb)
  await setInputFile('notes.txt', 'this is not markdown', 'text/plain')
  await evaluate(`document.querySelector('.kb-upload button[type="submit"]').click()`)
  await waitFor(`(document.querySelector('.kb-upload [role="alert"]')?.textContent || '').includes('请重新上传')`, 4000)
  const nonMd = await evaluate(collectKb)
  evidence.nonMd = {
    beforeCount: kbBefore.rowCount,
    afterCount: nonMd.rowCount,
    uploadError: nonMd.uploadError,
    filenames: nonMd.filenames,
    screenshot: await screenshot('t005-non-md.png'),
  }

  const mdName = 't005-crosspage.md'
  const mdBody = `# T005 跨页入库\n\n## 第一节 VPN\n\n${'VPN 连接说明。'.repeat(40)}\n\n## 第二节 打印机\n\n${'打印机驱动安装。'.repeat(40)}\n`
  await setInputFile(mdName, mdBody, 'text/markdown')
  await evaluate(`document.querySelector('.kb-upload button[type="submit"]').click()`)
  await waitFor(
    `[...document.querySelectorAll('.kb-row')].some((r) => (r.textContent || '').includes(${JSON.stringify(mdName)}) && (r.textContent || '').includes('入库中'))`,
    4000,
  )
  const ingesting = await evaluate(collectKb)
  evidence.ingesting = {
    statuses: ingesting.statuses,
    hasChunks: ingesting.hasChunks,
    hasEditForm: ingesting.hasEditForm,
    saveButtons: ingesting.saveButtons,
    screenshot: await screenshot('t005-ingesting.png'),
  }

  const leaveStart = Date.now()
  await clickNav('员工端')
  await waitFor(`location.pathname === '/employee'`)
  await clickNav('知识库')
  await waitFor(`location.pathname === '/knowledge'`)
  const backMs = Date.now() - leaveStart
  const stillIngesting = await evaluate(collectKb)
  evidence.leaveAndBack = {
    backMs,
    statuses: stillIngesting.statuses,
    hasChunks: stillIngesting.hasChunks,
    hasEditForm: stillIngesting.hasEditForm,
    screenshot: await screenshot('t005-ingesting-back.png'),
  }

  await waitFor(
    `[...document.querySelectorAll('.kb-row')].some((r) => (r.textContent || '').includes(${JSON.stringify(mdName)}) && (r.textContent || '').includes('已完成'))`,
    15000,
  )
  await evaluate(`(() => {
    const row = [...document.querySelectorAll('.kb-row')].find((el) => (el.querySelector('.kb-row-title')?.textContent || '').includes(${JSON.stringify(mdName)}));
    if (row) row.click();
  })()`)
  await waitFor(`document.querySelectorAll('.kb-chunk').length > 0`, 8000)
  const ready = await evaluate(collectKb)
  evidence.readyChunks = {
    statuses: ready.statuses,
    chunkCount: ready.chunkCount,
    chunksReadonly: ready.chunks.every((c) => !c.hasInput && c.contentEditable !== 'true'),
    hasEditForm: ready.hasEditForm,
    screenshot: await screenshot('t005-ready.png'),
  }

  await clickNav('员工端')
  await waitFor(`location.pathname === '/employee' && document.querySelector('.employee-chat')`)
  const vague = await sendChat('连不上')
  const faq = await sendChat('Outlook 打不开')
  const talk = await sendChat('你好')
  const knowledge = await sendChat('VPN连不上而且打印机无法使用')
  const fallback = await sendChat('我的工单进度怎么样了')
  evidence.branches = {
    vague: { tag: vague.lastOther?.tag, hasRewrite: Boolean(vague.lastEmployee?.rewrite) },
    faq: { tag: faq.lastOther?.tag, text: faq.lastOther?.text },
    talk: { tag: talk.lastOther?.tag },
    knowledge: { tag: knowledge.lastOther?.tag, text: knowledge.lastOther?.text },
    fallback: { tag: fallback.lastOther?.tag, text: fallback.lastOther?.text },
    conversationId: fallback.conversationId,
    screenshot: await screenshot('t005-branches.png'),
  }

  await evaluate(`document.querySelector('.employee-status button').click()`)
  await waitFor(`(document.querySelector('.employee-status-text')?.textContent || '').includes('已转人工')`)
  const afterTransfer = await evaluate(collectChat)
  const otherBefore = afterTransfer.otherCount
  const afterSend = await sendChat('转人工后再问 Outlook 打不开')
  evidence.afterHandoff = {
    statusText: afterTransfer.statusText,
    transferDisabled: afterTransfer.transferDisabled,
    conversationId: afterTransfer.conversationId,
    otherBefore,
    otherAfter: afterSend.otherCount,
    lastEmployee: afterSend.lastEmployee,
    lastOther: afterSend.lastOther,
    screenshot: await screenshot('t005-after-handoff.png'),
  }

  await clickNav('客服端')
  await waitFor(`location.pathname === '/agent'`)
  await waitFor(`document.querySelectorAll('.agent-row').length > 0`, 4000)
  const agentSame = await evaluate(collectAgent)
  const agentShell2 = await evaluate(collectShell)
  evidence.agentSameSession = {
    rowCount: agentSame.rowCount,
    rows: agentSame.rows,
    hasRewrite: agentSame.hasRewrite,
    previewHasOutlook: agentSame.rows.some((r) => /Outlook|转人工后再问/i.test(r.title)),
    messagesHaveRewrite: agentSame.hasRewrite,
    tags: agentSame.messages.map((m) => m.tag),
    shell: agentShell2,
    screenshot: await screenshot('t005-agent-same-session.png'),
  }

  await evaluate(fillScript('.agent-composer textarea', AGENT_REPLY))
  await evaluate(`document.querySelector('.agent-composer button[type="submit"]').click()`)
  await waitFor(`[...document.querySelectorAll('.agent-tag')].some((n) => n.textContent.includes('客服'))`, 8000)
  const afterReply = await evaluate(collectAgent)
  evidence.agentReply = {
    agentBubbles: afterReply.agentBubbles,
    screenshot: await screenshot('t005-agent-reply.png'),
  }

  await clickNav('员工端')
  await waitFor(`location.pathname === '/employee'`)
  const pollStart = Date.now()
  await waitFor(
    `[...document.querySelectorAll('.chat-msg-tag')].some((n) => (n.textContent || '').includes('客服'))`,
    5000,
  )
  const pollMs = Date.now() - pollStart
  const employeeAfterReply = await evaluate(collectChat)
  evidence.employeeSeesReply = {
    pollMs,
    agentBubbles: employeeAfterReply.agentBubbles,
    statusText: employeeAfterReply.statusText,
    screenshot: await screenshot('t005-employee-sees-reply.png'),
  }

  const long = await sendChat(LONG_MSG)
  const layout1440 = {
    shell: await evaluate(collectShell),
    chat: await evaluate(collectChat),
    screenshot: await screenshot('t005-layout-1440.png'),
  }
  evidence.layout1440 = layout1440

  await setViewport(900, 900)
  await waitFor(`getComputedStyle(document.querySelector('.sidebar')).flexDirection === 'row'`, 4000)
  const layout900Employee = {
    shell: await evaluate(collectShell),
    chat: await evaluate(collectChat),
    screenshot: await screenshot('t005-layout-900-employee.png'),
  }
  evidence.layout900Employee = layout900Employee

  await clickNav('客服端')
  await waitFor(`location.pathname === '/agent'`)
  const layout900Agent = {
    shell: await evaluate(collectShell),
    agent: await evaluate(collectAgent),
    screenshot: await screenshot('t005-layout-900-agent.png'),
  }
  evidence.layout900Agent = layout900Agent

  await clickNav('知识库')
  await waitFor(`location.pathname === '/knowledge'`)
  const layout900Kb = {
    shell: await evaluate(collectShell),
    kb: await evaluate(collectKb),
    screenshot: await screenshot('t005-layout-900-knowledge.png'),
  }
  evidence.layout900Kb = layout900Kb

  const expectedUser = '已登录：[Mock] it-help'
  evidence.assertions = {
    wrongPasswordStays: wrong.pathname === '/login' && !wrong.tokenPresent,
    wrongPasswordText: (wrong.formAlert || '').includes('用户名或密码错误'),
    wrongPasswordMock: (wrong.formAlert || '').includes('[Mock]'),
    employeeTopbar: employeeShell.topbarUser === expectedUser && employeeShell.logoutText === '退出',
    agentTopbar: agentShell.topbarUser === expectedUser && agentShell.logoutText === '退出',
    knowledgeTopbar: knowledgeShell.topbarUser === expectedUser && knowledgeShell.logoutText === '退出',
    navExclusiveEmployee: employeeShell.activeCount === 1 && employeeShell.activeNav[0] === '员工端',
    navExclusiveAgent: agentShell.activeCount === 1 && agentShell.activeNav[0] === '客服端',
    navExclusiveKnowledge: knowledgeShell.activeCount === 1 && knowledgeShell.activeNav[0] === '知识库',
    noTimedDemo: demoAppeared === false && agentEmpty.rowCount === 0 && demoElapsed >= 3000,
    nonMdImmediate:
      (nonMd.uploadError || '').includes('请重新上传') &&
      nonMd.rowCount === kbBefore.rowCount &&
      !nonMd.filenames.some((name) => /notes\.txt/i.test(name)),
    nonMdMock: (nonMd.uploadError || '').includes('[Mock]'),
    ingestingNoEdit:
      ingesting.statuses.some((s) => s.includes('入库中')) &&
      ingesting.hasChunks === false &&
      ingesting.hasEditForm === false,
    leaveStillIngesting:
      stillIngesting.statuses.some((s) => s.includes('入库中')) &&
      stillIngesting.hasChunks === false &&
      stillIngesting.hasEditForm === false &&
      backMs < 8000,
    readyReadonly:
      ready.chunkCount >= 2 &&
      ready.chunks.every((c) => !c.hasInput && c.contentEditable !== 'true'),
    vagueClarify: vague.lastOther?.tag === '反问' && (vague.lastOther?.text || '').includes(CLARIFY),
    faqTag: faq.lastOther?.tag === 'FAQ' && (faq.lastOther?.text || '').includes(FAQ_ANSWER),
    talkTag: talk.lastOther?.tag === '闲聊' && (talk.lastOther?.text || '').includes(SMALL_TALK),
    knowledgeTag:
      knowledge.lastOther?.tag === '知识问答' &&
      (knowledge.lastOther?.text || '').includes('1.') &&
      (knowledge.lastOther?.text || '').includes('2.'),
    fallbackTag: fallback.lastOther?.tag === '兜底' && (fallback.lastOther?.text || '').includes(FALLBACK),
    noAutoAfterHandoff: afterSend.otherCount === otherBefore,
    agentShowsThisSession:
      agentSame.rowCount >= 1 &&
      agentSame.hasRewrite === true &&
      agentSame.rows.some((r) => /Outlook|转人工后再问|VPN/i.test(r.title)),
    employeeSeesAgentWithin3s:
      pollMs <= 3500 &&
      employeeAfterReply.agentBubbles.some((m) => (m.text || '').includes(AGENT_REPLY)),
    layout1440SidebarColumn:
      layout1440.shell.layout.sidebarFlex === 'column' &&
      layout1440.shell.layout.sidebarWidth >= 200 &&
      layout1440.shell.layout.sidebarWidth <= 240,
    layout1440Pin:
      layout1440.chat.composer &&
      layout1440.chat.composer.pinGap <= 8 &&
      layout1440.chat.overlap &&
      layout1440.chat.overlap.messagesCoversTopbar === false &&
      layout1440.chat.overlap.topbarTop === 0,
    layout900SidebarRow:
      layout900Employee.shell.layout.sidebarFlex === 'row' &&
      layout900Employee.shell.layout.sidebarHeight <= 56,
    layout900Pin:
      layout900Employee.chat.composer &&
      layout900Employee.chat.composer.pinGap <= 8 &&
      layout900Employee.chat.overlap &&
      layout900Employee.chat.overlap.messagesCoversTopbar === false &&
      layout900Employee.chat.overlap.topbarTop === 0,
    mockOnPages:
      employeeShell.pageHasMock &&
      agentShell.pageHasMock &&
      knowledgeShell.pageHasMock &&
      agentSame.pageHasMock &&
      employeeAfterReply.pageHasMock,
    longSent: (long.lastEmployee?.text || '').length > 200,
  }

  const failed = Object.entries(evidence.assertions)
    .filter(([, v]) => v !== true)
    .map(([k]) => k)
  evidence.failedAssertions = failed

  const outFile = path.join(OUT_DIR, 't005-browser-evidence.json')
  await writeFile(outFile, JSON.stringify(evidence, null, 2), 'utf8')
  console.log(
    JSON.stringify(
      {
        ok: failed.length === 0,
        outFile,
        failed,
        assertions: evidence.assertions,
        pollMs,
        demoWaitedMs: demoElapsed,
      },
      null,
      2,
    ),
  )
  if (failed.length) process.exitCode = 1
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    try {
      ws?.close()
    } catch {}
    try {
      chromeProc?.kill()
    } catch {}
    await delay(300)
  })
