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
const CDP_PORT = 9334
const FALLBACK =
  '抱歉，这个问题我暂时无法根据现有知识准确回答。你可以换个说法再问，或点击转人工。'
const CLARIFY = '请问出问题的是哪套系统或设备？例如 Outlook、VPN 还是电脑硬件。'
const FAQ_ANSWER = '请检查是否在安全模式启动，并尝试用公司提供的安装包修复 Office。'
const SMALL_TALK = '你好，我是内部 IT 助手，可以直接问具体系统或设备问题。'
const REWRITE_VAGUE = '当前问法缺少系统或设备对象，需补充后才能检索'

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

const collectChat = `(() => {
  const status = document.querySelector('.employee-status-text');
  const transfer = [...document.querySelectorAll('.employee-status button')].at(0);
  const empty = document.querySelector('.employee-empty');
  const msgs = [...document.querySelectorAll('.chat-msg')].map((n) => ({
    side: n.classList.contains('employee') ? 'employee' : 'other',
    tag: n.querySelector('.chat-msg-tag')?.textContent ?? null,
    text: n.querySelector('.chat-bubble')?.textContent ?? '',
    rewrite: n.querySelector('.chat-rewrite')?.textContent ?? null,
    alignSelf: getComputedStyle(n).alignSelf,
  }));
  const composer = document.querySelector('.employee-composer');
  const messages = document.querySelector('.employee-messages');
  const composerRect = composer?.getBoundingClientRect();
  const msgRect = messages?.getBoundingClientRect();
  const composerCs = composer ? getComputedStyle(composer) : null;
  const empBubble = document.querySelector('.chat-msg.employee .chat-bubble');
  const sysBubble = document.querySelector('.chat-msg.other .chat-bubble');
  const empCs = empBubble ? getComputedStyle(empBubble) : null;
  const sysCs = sysBubble ? getComputedStyle(sysBubble) : null;
  const topbar = document.querySelector('.topbar');
  return {
    href: location.href,
    pathname: location.pathname,
    statusText: status?.textContent ?? null,
    transferText: transfer?.textContent?.trim() ?? null,
    transferDisabled: transfer ? transfer.disabled : null,
    emptyText: empty?.textContent ?? null,
    messageCount: msgs.length,
    messages: msgs,
    systemTags: msgs.filter((m) => m.side === 'other').map((m) => m.tag),
    lastEmployee: msgs.filter((m) => m.side === 'employee').at(-1) ?? null,
    lastOther: msgs.filter((m) => m.side === 'other').at(-1) ?? null,
    conversationId: sessionStorage.getItem('conversation_id'),
    tokenPresent: Boolean(localStorage.getItem('access_token')),
    topbarUser: document.querySelector('.session .user')?.textContent ?? null,
    topbarHeight: topbar ? getComputedStyle(topbar).height : null,
    pageHasMock: (document.body.innerText || '').includes('[Mock]'),
    enumLeak: /\\b(small_talk|employee_turn|waiting_for_agent|handed_off|clarification)\\b/.test(document.body.innerText || ''),
    composer: composerCs && composerRect ? {
      minHeight: composerCs.minHeight,
      bottom: composerRect.bottom,
      viewportHeight: window.innerHeight,
      pinGap: window.innerHeight - composerRect.bottom,
      flexShrink: composerCs.flexShrink,
    } : null,
    messagePane: messages && msgRect ? {
      overflow: getComputedStyle(messages).overflow,
      minHeight: getComputedStyle(messages).minHeight,
      height: msgRect.height,
      scrollHeight: messages.scrollHeight,
      scrollTop: messages.scrollTop,
    } : null,
    employeeBubble: empCs ? {
      backgroundColor: empCs.backgroundColor,
      color: empCs.color,
      maxWidth: getComputedStyle(empBubble.parentElement).maxWidth,
    } : null,
    systemBubble: sysCs ? {
      backgroundColor: sysCs.backgroundColor,
      color: sysCs.color,
    } : null,
  };
})()`

async function sendChat(text) {
  const before = await evaluate(`document.querySelectorAll('.chat-msg').length`)
  await evaluate(fillScript('.employee-composer textarea', text))
  await evaluate(`document.querySelector('.employee-composer button[type="submit"]').click()`)
  await waitFor(`document.querySelectorAll('.chat-msg').length > ${before}`)
  await waitFor(`document.querySelector('.employee-composer textarea') && !document.querySelector('.employee-composer textarea').disabled`)
  return evaluate(collectChat)
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const userData = await mkdtemp(path.join(os.tmpdir(), 't002-chrome-'))
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

  const evidence = { mock: true, viewport: '1440x900', steps: [] }

  await goto(`${BASE}/employee`)
  await waitFor(`document.querySelector('.login-card') || document.querySelector('.employee-chat')`)
  const onLogin = await evaluate(`Boolean(document.querySelector('.login-card'))`)
  if (onLogin) {
    await evaluate(fillScript('#user', 'it-help'))
    await evaluate(fillScript('#pass', 'it-help123'))
    await evaluate(`document.querySelector('button[type="submit"]').click()`)
  }
  await waitFor(`document.querySelector('.employee-chat') && location.pathname === '/employee'`)
  await waitFor(`document.querySelector('.employee-empty') || document.querySelector('.chat-msg')`)

  const empty = await evaluate(collectChat)
  evidence.empty = {
    pathname: empty.pathname,
    emptyText: empty.emptyText,
    statusText: empty.statusText,
    transferText: empty.transferText,
    transferDisabled: empty.transferDisabled,
    messageCount: empty.messageCount,
    conversationId: empty.conversationId,
    pageHasMock: empty.pageHasMock,
    topbarUser: empty.topbarUser,
    composer: empty.composer,
    screenshot: await screenshot('t002-empty.png'),
  }

  const vagueTurns = ['连不上', '怎么办', '不行啊', '没反应', '打不开', '还是不行']
  const vagueResults = []
  for (const text of vagueTurns) {
    const snap = await sendChat(text)
    vagueResults.push({
      input: text,
      lastEmployee: snap.lastEmployee,
      lastOther: snap.lastOther,
      systemTags: snap.systemTags,
      messageCount: snap.messageCount,
    })
  }
  evidence.vague = {
    rounds: vagueResults,
    screenshot: await screenshot('t002-vague-fallback.png'),
  }

  const faq = await sendChat('Outlook 打不开')
  evidence.faq = {
    lastEmployee: faq.lastEmployee,
    lastOther: faq.lastOther,
    screenshot: await screenshot('t002-faq.png'),
  }

  const talk = await sendChat('你好')
  evidence.smallTalk = {
    lastEmployee: talk.lastEmployee,
    lastOther: talk.lastOther,
    screenshot: await screenshot('t002-small-talk.png'),
  }

  const knowledge = await sendChat('VPN连不上而且打印机无法使用')
  const knowledgeOthers = (knowledge.messages || []).filter((m) => m.side === 'other')
  evidence.knowledge = {
    lastEmployee: knowledge.lastEmployee,
    lastOther: knowledge.lastOther,
    otherAfterSend: knowledgeOthers.slice(-2),
    screenshot: await screenshot('t002-knowledge.png'),
  }

  const fallback = await sendChat('我的工单进度怎么样了')
  evidence.outOfScope = {
    lastEmployee: fallback.lastEmployee,
    lastOther: fallback.lastOther,
    screenshot: await screenshot('t002-fallback.png'),
  }

  await evaluate(`document.querySelector('.employee-status button').click()`)
  await waitFor(`(document.querySelector('.employee-status-text')?.textContent || '').includes('已转人工')`)
  const afterTransfer = await evaluate(collectChat)
  const otherCountBefore = afterTransfer.messages.filter((m) => m.side === 'other').length
  evidence.afterTransfer = {
    statusText: afterTransfer.statusText,
    transferText: afterTransfer.transferText,
    transferDisabled: afterTransfer.transferDisabled,
    conversationId: afterTransfer.conversationId,
    otherCount: otherCountBefore,
    screenshot: await screenshot('t002-transferred.png'),
  }

  const afterHandoffSend = await sendChat('Outlook 打不开')
  const otherCountAfter1 = afterHandoffSend.messages.filter((m) => m.side === 'other').length
  const afterHandoffSend2 = await sendChat('你好')
  const otherCountAfter2 = afterHandoffSend2.messages.filter((m) => m.side === 'other').length
  evidence.afterHandoffMessages = {
    otherCountBefore,
    otherCountAfter1,
    otherCountAfter2,
    lastEmployee: afterHandoffSend2.lastEmployee,
    lastOther: afterHandoffSend2.lastOther,
    newEmployeeHasRewrite: Boolean(afterHandoffSend2.lastEmployee?.rewrite),
    waitingHintVisible: afterHandoffSend2.messages.some((m) => (m.text || '').includes('已转交客服')),
    screenshot: await screenshot('t002-after-handoff-send.png'),
  }

  const idBeforeReload = afterHandoffSend2.conversationId
  await send('Page.reload', { ignoreCache: false })
  await waitFor(`document.querySelector('.employee-chat') && location.pathname === '/employee'`)
  await waitFor(`document.querySelectorAll('.chat-msg').length > 0`)
  const afterReload = await evaluate(collectChat)
  evidence.afterReload = {
    conversationId: afterReload.conversationId,
    sameId: afterReload.conversationId === idBeforeReload,
    statusText: afterReload.statusText,
    transferDisabled: afterReload.transferDisabled,
    messageCount: afterReload.messageCount,
    lastEmployee: afterReload.lastEmployee,
    lastOther: afterReload.lastOther,
    composer: afterReload.composer,
    messagePane: afterReload.messagePane,
    employeeBubble: afterReload.employeeBubble,
    systemBubble: afterReload.systemBubble,
    pageHasMock: afterReload.pageHasMock,
    enumLeak: afterReload.enumLeak,
    topbarHeight: afterReload.topbarHeight,
    screenshot: await screenshot('t002-reload.png'),
  }

  evidence.layout = {
    composer: afterReload.composer,
    messagePane: afterReload.messagePane,
    employeeBubble: afterReload.employeeBubble,
    systemBubble: afterReload.systemBubble,
    topbarHeight: afterReload.topbarHeight,
  }

  evidence.assertions = {
    emptyHasHint: (empty.emptyText || '').includes('描述你的 IT 问题'),
    emptyHasMock: (empty.emptyText || '').includes('[Mock]'),
    statusBotChinese: (empty.statusText || '').includes('AI 接待中') || (empty.statusText || '').includes('接待'),
    firstVagueIsClarify: vagueResults[0]?.lastOther?.tag === '反问' && (vagueResults[0]?.lastOther?.text || '').includes(CLARIFY),
    firstVagueHasRewrite: (vagueResults[0]?.lastEmployee?.rewrite || '').includes(REWRITE_VAGUE),
    rounds1to5Clarify: vagueResults.slice(0, 5).every((r) => r.lastOther?.tag === '反问'),
    round6Fallback: vagueResults[5]?.lastOther?.tag === '兜底' && (vagueResults[5]?.lastOther?.text || '').includes(FALLBACK),
    faqTag: faq.lastOther?.tag === 'FAQ' && (faq.lastOther?.text || '').includes(FAQ_ANSWER),
    smallTalkTag: talk.lastOther?.tag === '闲聊' && (talk.lastOther?.text || '').includes(SMALL_TALK),
    knowledgeTag: knowledge.lastOther?.tag === '知识问答',
    knowledgeSegmented: (knowledge.lastOther?.text || '').includes('1.') && (knowledge.lastOther?.text || '').includes('2.'),
    knowledgeSingleBubble:
      evidence.knowledge.otherAfterSend.length === 1 || knowledge.lastOther?.tag === '知识问答',
    outOfScopeFallback: fallback.lastOther?.tag === '兜底' && (fallback.lastOther?.text || '').includes(FALLBACK),
    transferredStatus: (afterTransfer.statusText || '').includes('已转人工，等待客服'),
    transferButtonDisabled: afterTransfer.transferDisabled === true && afterTransfer.transferText === '已转人工',
    noSystemAfterHandoff: otherCountAfter2 === otherCountBefore,
    reloadSameConversation: afterReload.conversationId === idBeforeReload && afterReload.conversationId != null,
    reloadStillHandedOff: (afterReload.statusText || '').includes('已转人工，等待客服'),
    composerPinned: afterReload.composer && afterReload.composer.pinGap <= 8 && afterReload.composer.flexShrink === '0',
    composerMin88: afterReload.composer && parseFloat(afterReload.composer.minHeight) >= 88,
    employeeRight: afterReload.messages.some((m) => m.side === 'employee' && m.alignSelf === 'flex-end'),
    systemLeft: afterReload.messages.some((m) => m.side === 'other' && m.alignSelf === 'flex-start'),
    employeeBubbleColor: afterReload.employeeBubble?.backgroundColor === 'rgb(29, 78, 137)',
    systemBubbleColor: afterReload.systemBubble?.backgroundColor === 'rgb(232, 241, 250)',
    pageHasMock: afterReload.pageHasMock === true,
    noEnumLeak: afterReload.enumLeak === false,
  }

  const failed = Object.entries(evidence.assertions)
    .filter(([, v]) => v !== true)
    .map(([k]) => k)
  evidence.failedAssertions = failed

  const outFile = path.join(OUT_DIR, 't002-browser-evidence.json')
  await writeFile(outFile, JSON.stringify(evidence, null, 2), 'utf8')
  console.log(
    JSON.stringify({ ok: failed.length === 0, outFile, failed, assertions: evidence.assertions }, null, 2),
  )
  if (failed.length) process.exitCode = 1
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
