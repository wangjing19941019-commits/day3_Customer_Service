import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const BASE = 'http://127.0.0.1:5199'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT_DIR = path.resolve(
  'C:\\Users\\慈海客服\\Desktop\\demo\\Develop_Helper\\Projects_Repo\\Customer_Service\\.sdd\\test-reports',
)
const BACKEND_LOG =
  'C:\\Users\\慈海客服\\.cursor\\projects\\c-Users-Desktop-demo-Develop-Helper\\terminals\\407193.txt'
const CDP_PORT = 9415
const USERNAME = 'it-help'
const PASSWORD = 'it-help123'
const CONVA = 'b68e4e94-5a53-4ae7-b25a-8e8d13527bc0'
const AFTER_FAQ = 'T013-RETRY-FAQ T011HELIX 重置 VPN 密码的要点是什么'

let chromeProc
let ws
let sessionId
let msgId = 0
const pending = new Map()
const checks = []

function record(id, pass, expected, actual) {
  checks.push({ id, pass: Boolean(pass), expected, actual })
  if (!pass) console.error(`FAIL ${id}: expected ${JSON.stringify(expected)} actual ${JSON.stringify(actual)}`)
  else console.log(`PASS ${id}`)
}

function send(method, params = {}, timeoutMs = 30000) {
  const id = ++msgId
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`CDP timeout: ${method}`))
    }, timeoutMs)
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

async function evaluate(expression, timeoutMs = 30000) {
  const result = await send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    timeoutMs,
  )
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'eval failed')
  }
  return result.result?.value
}

async function waitFor(expression, timeoutMs = 12000) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeoutMs) {
    last = await evaluate(`Boolean(${expression})`)
    if (last) return last
    await delay(150)
  }
  throw new Error(`waitFor timeout: ${expression}; last=${last}`)
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

async function screenshot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  await writeFile(path.join(OUT_DIR, name), Buffer.from(data, 'base64'))
  return name
}

const collectChat = `(() => {
  const msgs = [...document.querySelectorAll('.chat-msg')].map((n) => ({
    side: n.classList.contains('employee') ? 'employee' : 'other',
    tag: n.querySelector('.chat-msg-tag')?.textContent ?? null,
    text: n.querySelector('.chat-bubble')?.textContent ?? '',
  }));
  return {
    conversationId: sessionStorage.getItem('conversation_id'),
    statusText: document.querySelector('.employee-status-text')?.textContent ?? null,
    transferDisabled: Boolean(document.querySelector('.employee-status button')?.disabled),
    sending: Boolean(document.querySelector('.employee-composer textarea')?.disabled),
    otherCount: msgs.filter((m) => m.side === 'other').length,
    employeeCount: msgs.filter((m) => m.side === 'employee').length,
    otherTags: msgs.filter((m) => m.side === 'other').map((m) => m.tag),
    lastEmployee: msgs.filter((m) => m.side === 'employee').at(-1)?.text ?? null,
    lastOther: msgs.filter((m) => m.side === 'other').at(-1) ?? null,
    pageHasMock: (document.body.innerText || '').includes('[Mock]'),
  };
})()`

async function apiFetch(pathname, options = {}) {
  return evaluate(
    `(async () => {
      const token = localStorage.getItem('access_token');
      const headers = { Authorization: 'Bearer ' + token };
      if (${JSON.stringify(Boolean(options.json))}) headers['Content-Type'] = 'application/json';
      const res = await fetch(${JSON.stringify(pathname)}, {
        method: ${JSON.stringify(options.method || 'GET')},
        headers,
        ${options.json ? `body: ${JSON.stringify(JSON.stringify(options.json))},` : ''}
      });
      let body = null;
      try { body = await res.json(); } catch {}
      return { status: res.status, body };
    })()`,
    options.timeoutMs || 30000,
  )
}

async function logSize() {
  try {
    return (await readFile(BACKEND_LOG)).length
  } catch {
    return 0
  }
}

async function snapshotLog(startSize) {
  const buf = await readFile(BACKEND_LOG)
  const added = buf.subarray(startSize).toString('utf8')
  const lines = added.split(/\r?\n/).filter((line) => /chat\/completions|embeddings|调用百炼/i.test(line))
  return {
    chatCompletions: lines.filter((l) => /chat\/completions/.test(l)).length,
    embeddings: lines.filter((l) => /embeddings/.test(l)).length,
    sample: lines.slice(-6).map((l) => l.replace(/Bearer\s+\S+/g, 'Bearer REDACTED').slice(0, 240)),
  }
}

async function main() {
  const userData = await mkdtemp(path.join(os.tmpdir(), 't013-chrome-'))
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
  ws = new WebSocket(version.webSocketDebuggerUrl)
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

  const evidence = { convA: CONVA, cdpPort: CDP_PORT, userDataDir: userData, steps: {} }
  try {
    await send('Page.navigate', { url: `${BASE}/login` })
    await Promise.race([send('Page.loadEventFired').catch(() => null), delay(3000)])
    await waitFor(`document.querySelector('#user')`, 8000)
    await evaluate(fillScript('#user', USERNAME))
    await evaluate(fillScript('#pass', PASSWORD))
    await evaluate(`document.querySelector('button[type="submit"]').click()`)
    await waitFor(`document.querySelector('.app')`, 12000)
    await evaluate(`sessionStorage.setItem('conversation_id', ${JSON.stringify(CONVA)})`)
    await send('Page.navigate', { url: `${BASE}/employee` })
    await Promise.race([send('Page.loadEventFired').catch(() => null), delay(3000)])
    await waitFor(
      `document.querySelector('.employee-status-text')?.textContent === '已转人工，等待客服' && sessionStorage.getItem('conversation_id') === ${JSON.stringify(CONVA)} && !document.querySelector('.employee-composer textarea')?.disabled`,
      15000,
    )
    const before = await evaluate(collectChat)
    evidence.steps.before = before
    record(
      'resume-handed-off',
      before.conversationId === CONVA && before.statusText === '已转人工，等待客服' && !before.pageHasMock,
      'same conv handed_off',
      before,
    )

    const logStart = await logSize()
    const otherBefore = before.otherCount
    await evaluate(fillScript('.employee-composer textarea', AFTER_FAQ))
    await evaluate(`document.querySelector('.employee-composer button[type="submit"]').click()`)
    const start = Date.now()
    let last = before
    while (Date.now() - start < 20000) {
      last = await evaluate(collectChat)
      if (
        !last.sending &&
        String(last.lastEmployee || '').includes('T013-RETRY-FAQ') &&
        last.conversationId === CONVA
      ) {
        break
      }
      await delay(200)
    }
    const api = await apiFetch(`/api/conversations/${CONVA}`)
    const conv = api.body?.data
    const messages = conv?.messages || []
    const empIdx = [...messages]
      .map((m, i) => ({ m, i }))
      .reverse()
      .find(({ m }) => String(m.original_content || m.content || '').includes('T013-RETRY-FAQ'))
    const afterKinds = empIdx ? messages.slice(empIdx.i).map((m) => `${m.role}:${m.kind}`) : []
    const logs = await snapshotLog(logStart)
    evidence.steps.faq = {
      ui: last,
      elapsedMs: Date.now() - start,
      http: api.status,
      status: conv?.status,
      afterKinds,
      otherDelta: last.otherCount - otherBefore,
      lastOther: last.lastOther,
      logs,
    }
    const noFaqAi = afterKinds.every((k) => !/:(faq|small_talk|knowledge|clarification|fallback)$/.test(k))
    const waiting = afterKinds.includes('system:waiting_for_agent') || afterKinds.every((k) => k.startsWith('employee:') || k.startsWith('system:waiting'))
    record(
      'ac006-retry-faq-no-ai',
      last.conversationId === CONVA &&
        conv?.status === 'handed_off' &&
        String(last.lastEmployee || '').includes('T013-RETRY-FAQ') &&
        last.otherDelta !== undefined &&
        last.otherCount === otherBefore &&
        noFaqAi &&
        afterKinds.includes('system:waiting_for_agent') &&
        logs.chatCompletions === 0 &&
        last.lastOther?.tag !== 'FAQ',
      'handed_off FAQ question waits, no FAQ/AI, no completions',
      evidence.steps.faq,
    )
    await screenshot('t013-ac006-retry-faq.png')

    await evaluate(`([...document.querySelectorAll('.sidebar a')].find((el) => el.textContent.trim() === '客服端')||{click(){}}).click()`)
    await waitFor(`document.querySelector('.agent-inbox')`, 8000)
    const pickStart = Date.now()
    let agent = null
    while (Date.now() - pickStart < 10000) {
      await evaluate(`(() => {
        const rows = [...document.querySelectorAll('.agent-row')];
        const hit = rows.find((r) => /T013-RETRY-FAQ|T013-AGENT|T011HELIX/.test(r.querySelector('.agent-row-title')?.textContent || ''));
        if (hit) hit.click();
      })()`)
      agent = await evaluate(`(() => ({
        titles: [...document.querySelectorAll('.agent-row-title')].map((n) => n.textContent),
        msgs: [...document.querySelectorAll('.agent-msg')].map((n) => ({
          tag: n.querySelector('.agent-tag')?.textContent ?? null,
          text: (n.querySelector('.agent-bubble')?.textContent || '').slice(0, 200),
        })),
      }))()`)
      if (agent.msgs.some((m) => /T013-RETRY-FAQ/.test(m.text || ''))) break
      await delay(300)
    }
    const faqMsg = agent?.msgs.find((m) => /T013-RETRY-FAQ/.test(m.text || ''))
    const autoFaqAfter = agent?.msgs.some((m, i) => {
      const prev = agent.msgs[i - 1]
      return prev && /T013-RETRY-FAQ/.test(prev.text || '') && m.tag === 'FAQ'
    })
    evidence.steps.agent = { faqMsg, autoFaqAfter, msgs: agent?.msgs?.slice(-8) }
    record(
      'ac006-retry-agent-no-faq-reply',
      Boolean(faqMsg) && faqMsg.tag == null && autoFaqAfter !== true,
      'agent sees employee FAQ text without FAQ auto reply after it',
      evidence.steps.agent,
    )
    await screenshot('t013-ac006-retry-agent.png')
  } finally {
    evidence.checks = checks
    evidence.failed = checks.filter((c) => !c.pass).map((c) => c.id)
    await writeFile(path.join(OUT_DIR, 't013-retest-ac006-evidence.json'), JSON.stringify(evidence, null, 2), 'utf8')
    console.log(JSON.stringify({ failed: evidence.failed, checkCount: checks.length }))
    try { ws?.close() } catch {}
    try { if (chromeProc && !chromeProc.killed) chromeProc.kill() } catch {}
  }
}

main().catch(async (err) => {
  console.error('SCRIPT_ERROR', err)
  try {
    await writeFile(
      path.join(OUT_DIR, 't013-retest-ac006-evidence.json'),
      JSON.stringify({ scriptError: String(err), checks }, null, 2),
      'utf8',
    )
  } catch {}
  try { if (chromeProc && !chromeProc.killed) chromeProc.kill() } catch {}
  process.exit(1)
})
