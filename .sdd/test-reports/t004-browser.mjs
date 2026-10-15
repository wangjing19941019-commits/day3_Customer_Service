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

const collectInbox = `(() => {
  const topbar = document.querySelector('.topbar');
  const user = document.querySelector('.session .user');
  const list = document.querySelector('.agent-list');
  const thread = document.querySelector('.agent-thread');
  const rows = [...document.querySelectorAll('.agent-row')];
  const empties = [...document.querySelectorAll('.agent-empty')].map((n) => n.textContent.trim());
  const textarea = document.querySelector('#agent-reply');
  const replyBtn = document.querySelector('.agent-composer .btn-primary');
  const messages = [...document.querySelectorAll('.agent-msg')].map((n) => ({
    className: n.className,
    tag: n.querySelector('.agent-tag')?.textContent?.trim() ?? null,
    content: n.querySelector('.agent-bubble')?.textContent ?? '',
    rewrite: n.querySelector('.agent-rewrite')?.textContent ?? null,
  }));
  const listCs = list ? getComputedStyle(list) : null;
  const listRect = list?.getBoundingClientRect();
  const bodyCs = getComputedStyle(document.body);
  const btnCs = replyBtn ? getComputedStyle(replyBtn) : null;
  const userBubble = document.querySelector('.agent-msg-user .agent-bubble');
  const peerBubble = document.querySelector('.agent-msg-peer .agent-bubble');
  const composer = document.querySelector('.agent-composer');
  return {
    href: location.href,
    pathname: location.pathname,
    pageName: document.querySelector('.page-name')?.textContent?.trim() ?? null,
    topbarHeight: topbar ? getComputedStyle(topbar).height : null,
    topbarUser: user?.textContent ?? null,
    hasLogout: Boolean([...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '退出')),
    emptyTexts: empties,
    rowCount: rows.length,
    rows: rows.map((row) => ({
      title: row.querySelector('.agent-row-title')?.textContent ?? '',
      meta: row.querySelector('.agent-row-meta')?.textContent ?? '',
      selected: row.classList.contains('selected'),
    })),
    messages,
    textareaDisabled: textarea ? textarea.disabled : null,
    replyDisabled: replyBtn ? replyBtn.disabled : null,
    replyLabel: replyBtn?.textContent?.trim() ?? null,
    placeholder: textarea?.getAttribute('placeholder') ?? null,
    canvas: bodyCs.backgroundColor,
    listWidth: listRect ? Math.round(listRect.width) : null,
    listBorder: listCs ? listCs.borderRightWidth + ' ' + listCs.borderRightColor : null,
    replyBtnBg: btnCs?.backgroundColor ?? null,
    replyBtnHeight: btnCs?.height ?? null,
    userBubbleBg: userBubble ? getComputedStyle(userBubble).backgroundColor : null,
    peerBubbleBg: peerBubble ? getComputedStyle(peerBubble).backgroundColor : null,
    composerMinHeight: composer ? getComputedStyle(composer).minHeight : null,
    hasVpn: (document.body.innerText || '').includes('VPN'),
    hasOutlook: (document.body.innerText || '').includes('Outlook'),
    hasMock: (document.body.innerText || '').includes('[Mock]'),
    hasRewrite: messages.some((m) => (m.rewrite || '').includes('改写')),
    hasAgentTag: messages.some((m) => m.tag === '客服'),
    agentBubbleTexts: messages.filter((m) => m.tag === '客服').map((m) => m.content),
    bodySnippet: (document.body.innerText || '').slice(0, 800),
  };
})()`

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const userData = await mkdtemp(path.join(os.tmpdir(), 't004-chrome-'))
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

  async function goto(url) {
    const nav = send('Page.navigate', { url })
    await Promise.race([send('Page.loadEventFired').catch(() => null), delay(3000)])
    await nav
  }

  const evidence = { mock: true, viewport: '1440x900', url: `${BASE}/agent`, steps: [] }

  await goto(`${BASE}/login`)
  await waitFor(`document.querySelector('#user') || document.querySelector('input')`)
  const userSel = await evaluate(`document.querySelector('#user') ? '#user' : 'input[type="text"], input:not([type])'`)
  const passSel = await evaluate(`document.querySelector('#pass') ? '#pass' : 'input[type="password"]'`)
  await evaluate(fillScript(userSel, 'it-help'))
  await evaluate(fillScript(passSel, 'it-help123'))
  await evaluate(`document.querySelector('button[type="submit"]').click()`)
  await waitFor(`document.querySelector('.topbar') && location.pathname !== '/login'`, 10000)

  await evaluate(`([...document.querySelectorAll('.sidebar a')].find((a) => a.textContent.trim() === '客服端')).click()`)
  await waitFor(`location.pathname === '/agent' && document.querySelector('.agent-inbox')`, 8000)
  const emptyAt = Date.now()
  const emptySnap = await evaluate(collectInbox)
  evidence.empty = {
    elapsedMs: 0,
    pathname: emptySnap.pathname,
    pageName: emptySnap.pageName,
    topbarUser: emptySnap.topbarUser,
    hasLogout: emptySnap.hasLogout,
    emptyTexts: emptySnap.emptyTexts,
    rowCount: emptySnap.rowCount,
    textareaDisabled: emptySnap.textareaDisabled,
    replyDisabled: emptySnap.replyDisabled,
    replyLabel: emptySnap.replyLabel,
    hasVpn: emptySnap.hasVpn,
    hasOutlook: emptySnap.hasOutlook,
    hasMock: emptySnap.hasMock,
    listWidth: emptySnap.listWidth,
    canvas: emptySnap.canvas,
    topbarHeight: emptySnap.topbarHeight,
    screenshot: await screenshot('t004-empty.png'),
  }
  evidence.steps.push({ id: 'empty', ...evidence.empty })

  await waitFor(`document.querySelectorAll('.agent-row').length > 0`, 8000)
  const appearedAt = Date.now()
  await waitFor(
    `document.querySelectorAll('.agent-msg').length > 0 && [...document.querySelectorAll('.agent-rewrite')].length > 0`,
    5000,
  )
  const afterPoll = await evaluate(collectInbox)
  evidence.afterPoll = {
    elapsedMs: appearedAt - emptyAt,
    pathname: afterPoll.pathname,
    emptyTexts: afterPoll.emptyTexts,
    rowCount: afterPoll.rowCount,
    rows: afterPoll.rows,
    messages: afterPoll.messages,
    textareaDisabled: afterPoll.textareaDisabled,
    replyDisabled: afterPoll.replyDisabled,
    hasVpn: afterPoll.hasVpn,
    hasOutlook: afterPoll.hasOutlook,
    hasMock: afterPoll.hasMock,
    hasRewrite: afterPoll.hasRewrite,
    listWidth: afterPoll.listWidth,
    listBorder: afterPoll.listBorder,
    userBubbleBg: afterPoll.userBubbleBg,
    peerBubbleBg: afterPoll.peerBubbleBg,
    composerMinHeight: afterPoll.composerMinHeight,
    replyBtnHeight: afterPoll.replyBtnHeight,
    screenshot: await screenshot('t004-handed-off.png'),
  }
  evidence.steps.push({ id: 'after-poll', elapsedMs: evidence.afterPoll.elapsedMs, rowCount: afterPoll.rowCount })

  await evaluate(`document.querySelector('.agent-row')?.click()`)
  await waitFor(`document.querySelectorAll('.agent-msg').length > 0`, 4000)
  const opened = await evaluate(collectInbox)
  evidence.opened = {
    rowCount: opened.rowCount,
    rows: opened.rows,
    messages: opened.messages,
    hasRewrite: opened.hasRewrite,
    hasVpn: opened.hasVpn,
    hasMock: opened.hasMock,
    textareaDisabled: opened.textareaDisabled,
    replyDisabled: opened.replyDisabled,
    screenshot: await screenshot('t004-opened.png'),
  }

  await evaluate(fillScript('#agent-reply', '已帮你报修，工单稍后代登'))
  await waitFor(`document.querySelector('.agent-composer .btn-primary') && !document.querySelector('.agent-composer .btn-primary').disabled`, 3000)
  await evaluate(`document.querySelector('.agent-composer .btn-primary').click()`)
  await waitFor(
    `[...document.querySelectorAll('.agent-tag')].some((n) => n.textContent.trim() === '客服')`,
    5000,
  )
  const afterReply = await evaluate(collectInbox)
  evidence.afterReply = {
    rowCount: afterReply.rowCount,
    rows: afterReply.rows,
    messages: afterReply.messages,
    hasAgentTag: afterReply.hasAgentTag,
    agentBubbleTexts: afterReply.agentBubbleTexts,
    hasVpn: afterReply.hasVpn,
    hasMock: afterReply.hasMock,
    hasRewrite: afterReply.hasRewrite,
    screenshot: await screenshot('t004-after-reply.png'),
  }

  const outFile = path.join(OUT_DIR, 't004-browser-evidence.json')
  await writeFile(outFile, JSON.stringify(evidence, null, 2), 'utf8')
  console.log(
    JSON.stringify(
      {
        ok: true,
        outFile,
        empty: evidence.empty,
        afterPoll: {
          elapsedMs: evidence.afterPoll.elapsedMs,
          rowCount: evidence.afterPoll.rowCount,
          rows: evidence.afterPoll.rows,
          hasOutlook: evidence.afterPoll.hasOutlook,
          hasVpn: evidence.afterPoll.hasVpn,
          hasMock: evidence.afterPoll.hasMock,
          hasRewrite: evidence.afterPoll.hasRewrite,
          messages: evidence.afterPoll.messages,
          textareaDisabled: evidence.afterPoll.textareaDisabled,
          listWidth: evidence.afterPoll.listWidth,
        },
        opened: {
          hasRewrite: evidence.opened.hasRewrite,
          hasVpn: evidence.opened.hasVpn,
          messages: evidence.opened.messages,
        },
        afterReply: {
          hasAgentTag: evidence.afterReply.hasAgentTag,
          agentBubbleTexts: evidence.afterReply.agentBubbleTexts,
          hasVpn: evidence.afterReply.hasVpn,
          hasMock: evidence.afterReply.hasMock,
          rowCount: evidence.afterReply.rowCount,
        },
      },
      null,
      2,
    ),
  )
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
