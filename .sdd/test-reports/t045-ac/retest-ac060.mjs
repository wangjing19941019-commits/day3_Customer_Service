import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..', '..')
const BASE = 'http://127.0.0.1:5220'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const CDP_PORT = 9563
const RISK_FILE = 't045-high-risk.md'
const RISK_TOKEN = 'T045_HIGH_RISK_COMPENSATION_TOKEN'
const QUERY = '屏幕进液高风险赔付'

let chromeProc
let ws
let sessionId
let msgId = 0
const pending = new Map()

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

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'eval failed')
  }
  return result.result?.value
}

async function waitFor(expression, timeoutMs = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await evaluate(`Boolean(${expression})`)) return true
    await delay(150)
  }
  throw new Error(`waitFor timeout: ${expression}`)
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
  await writeFile(path.join(HERE, name), Buffer.from(data, 'base64'))
  return name
}

async function readSharedPassword() {
  const text = await readFile(path.join(ROOT, 'backend', '.env'), 'utf8')
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('shared_password=')) return line.slice('shared_password='.length)
  }
  throw new Error('shared_password missing')
}

async function main() {
  const password = await readSharedPassword()
  const userData = await mkdtemp(path.join(os.tmpdir(), 't045-retest-chrome-'))
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
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      const item = pending.get(msg.id)
      pending.delete(msg.id)
      clearTimeout(item.timer)
      if (msg.error) item.reject(new Error(msg.error.message || JSON.stringify(msg.error)))
      else item.resolve(msg.result)
    }
  })
  const created = await send('Target.createTarget', { url: 'about:blank' })
  const attached = await send('Target.attachToTarget', { targetId: created.targetId, flatten: true })
  sessionId = attached.sessionId
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

  await send('Page.navigate', { url: `${BASE}/login` })
  await waitFor(`document.querySelector('#user')`, 10000)
  await evaluate(fillScript('#user', 'agent'))
  await evaluate(fillScript('#pass', password))
  await evaluate(`document.querySelector('button[type="submit"]').click()`)
  await waitFor(`location.pathname === '/agent'`, 15000)
  await waitFor(`document.querySelector('.agent-row')`, 15000)
  await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.agent-row')];
    const hit = rows.find((row) => (row.innerText || '').includes('屏幕进液')) || rows[0];
    hit.click();
    return true;
  })()`)
  await waitFor(`document.querySelector('#agent-knowledge-search')`, 15000)
  await evaluate(`document.querySelector('#agent-knowledge-search').scrollIntoView({ block: 'center' })`)
  await evaluate(fillScript('#agent-knowledge-search', QUERY))
  await evaluate(`document.querySelector('.knowledge-search button')?.click()`)

  const start = Date.now()
  let snapshot = { cards: '', panel: '', mock: false }
  while (Date.now() - start < 45000) {
    snapshot = await evaluate(`({
      cards: [...document.querySelectorAll('.knowledge-card')].map((n) => n.innerText).join('\\n---\\n'),
      panel: document.querySelector('.work-block')?.innerText || '',
      mock: (document.body.innerText || '').includes('[Mock]'),
      query: document.querySelector('#agent-knowledge-search')?.value || '',
    })`)
    if ((snapshot.cards || '').includes(RISK_TOKEN) && (snapshot.cards || '').includes(RISK_FILE)) break
    await delay(250)
  }
  await evaluate(`(() => {
    const card = [...document.querySelectorAll('.knowledge-card')].find((n) => n.innerText.includes(${JSON.stringify(RISK_TOKEN)}));
    card?.scrollIntoView({ block: 'center' });
    return Boolean(card);
  })()`)
  await delay(200)
  const shot = await screenshot('t045-agent-search-risk-retest.png')
  const pass = (snapshot.cards || '').includes(RISK_TOKEN) && (snapshot.cards || '').includes(RISK_FILE) && snapshot.mock === false
  const evidence = {
    id: 'ac060-agent-search-high-risk-retest',
    pass,
    query: QUERY,
    expected: { hasToken: true, hasFile: true, mock: false },
    actual: {
      hasToken: (snapshot.cards || '').includes(RISK_TOKEN),
      hasFile: (snapshot.cards || '').includes(RISK_FILE),
      mock: snapshot.mock,
      query: snapshot.query,
      excerpt: (snapshot.cards || '').slice(0, 500),
      screenshot: shot,
    },
  }
  await writeFile(path.join(HERE, 't045-browser-retest-ac060.json'), JSON.stringify(evidence, null, 2), 'utf8')
  console.log(pass ? 'PASS ac060-agent-search-high-risk-retest' : 'FAIL ac060-agent-search-high-risk-retest')
  if (chromeProc) chromeProc.kill()
  process.exit(pass ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  if (chromeProc) chromeProc.kill()
  process.exit(1)
})
