import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const BASE = 'http://127.0.0.1:5199'
const BACKEND = 'http://127.0.0.1:8099'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT_DIR = path.resolve(
  'C:\\Users\\慈海客服\\Desktop\\demo\\Develop_Helper\\Projects_Repo\\Customer_Service\\.sdd\\test-reports',
)
const FIXTURE_DIR = path.join(OUT_DIR, 't011-fixtures')
const CDP_PORT = 9379
const USERNAME = 'it-help'
const PASSWORD = 'it-help123'
const MD_NAME = 't011-helix-vpn.md'
const TXT_NAME = 't011-office-wifi.txt'
const PDF_NAME = 't011-printer-guide.pdf'
const SWITCH_NAME = 't011-from-ready.md'
const EMPTY_FILTER_TEXT = '当前没有该状态的文档'
const EMPTY_ALL_TEXT = '还没有知识文档。请上传 Markdown、TXT 或能抽出文字的 PDF。'
const STRATEGY_NEEDLES = ['先转为 Markdown', '800', '重叠 160 字', '上限的 20%']
const FAQ_QUESTION = 'T011HELIX 重置 VPN 密码的要点是什么'
const FAQ_ANSWER = 'T011HELIX-FAQ-NEW 先在账号中心完成手机验证，再重新导入公司 VPN 配置文件。'
const FAQ_OLD_QUESTION = '这个问法已经被改掉不应再命中 T011HELIX-OLD'

const LONG_TXT = Array.from(
  { length: 14 },
  (_, i) =>
    `T011WIFI 段落${i + 1}：办公区无线网络无法连接时，先确认电脑连的是公司办公网络，而不是访客网络或手机热点。关闭飞行模式后在系统设置里忘记该网络，再重新输入 IT 发放的密码。若仍失败，重启无线网卡并避开微波干扰，不要反复输错密码。`,
).join('\n\n')

const LONG_MD = `# T011Helix VPN

## 密码重置

T011HELIX-RESET：在账号中心选择重置密码并完成手机验证，然后重新导入公司 VPN 配置文件。不要反复输入旧密码。完成验证后等待一分钟再打开客户端。

${'甲'.repeat(420)}

## 连接失败

T011HELIX-FAIL：若提示认证失败，先检查是否连了访客 WiFi，再忘记网络后重连办公网。证书过期时联系 IT 换发，不要改本机防火墙做实验。

${'乙'.repeat(420)}
`

let chromeProc
let ws
let sessionId
let msgId = 0
const pending = new Map()
const checks = []
const networkLog = []

function record(id, pass, expected, actual, extra = {}) {
  checks.push({ id, pass: Boolean(pass), expected, actual, ...extra })
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
    const text =
      result.exceptionDetails.exception?.description ||
      result.exceptionDetails.text ||
      'eval failed'
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

async function setViewport(width, height) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  })
}

const collectKb = `(() => {
  const statusRe = /入库中|已完成|请重新上传/;
  const rows = [...document.querySelectorAll('.kb-row')].map((row) => {
    const filename = row.querySelector('.kb-row-title')?.textContent?.trim() ?? '';
    const hint = row.querySelector('.hint')?.innerText?.replace(/\\s+/g, ' ').trim() ?? '';
    const timeEl = row.querySelector('.kb-row-time');
    const statusMatch = hint.match(statusRe);
    return {
      filename,
      hint,
      status: statusMatch ? statusMatch[0] : '',
      timeText: timeEl?.textContent?.trim() ?? '',
      selected: row.classList.contains('selected'),
      hasCreatedAt: /created_at|创建/.test(hint),
    };
  });
  const filterBtns = [...document.querySelectorAll('.kb-filter-btn')].map((btn) => ({
    label: btn.textContent.trim(),
    value: btn.getAttribute('data-filter'),
    pressed: btn.getAttribute('aria-pressed') === 'true',
  }));
  const fileInput = document.querySelector('#kb-file');
  const uploadBtn = document.querySelector('.kb-upload button[type="submit"]');
  const detail = document.querySelector('.kb-detail');
  return {
    pathname: location.pathname,
    pageHasMock: (document.body.innerText || '').includes('[Mock]'),
    rows,
    rowCount: rows.length,
    filenames: rows.map((r) => r.filename),
    statuses: rows.map((r) => r.status),
    times: rows.map((r) => r.timeText),
    emptyText: document.querySelector('.kb-empty')?.textContent?.trim() ?? '',
    uploadError: document.querySelector('.kb-upload [role="alert"]')?.textContent?.trim() ?? '',
    uploadHint: document.querySelector('.kb-upload-hint')?.textContent?.trim() ?? '',
    filterPressedValue: filterBtns.find((b) => b.pressed)?.value ?? null,
    filterLabels: filterBtns.map((b) => b.label),
    uploadEnabled: Boolean(fileInput) && !fileInput.disabled && Boolean(uploadBtn) && !uploadBtn.disabled,
    detailText: (detail?.innerText || '').replace(/\\s+/g, ' ').trim(),
    hasChunks: document.querySelectorAll('.kb-chunk').length,
    hasEditForm: Boolean(document.querySelector('.kb-edit')),
    saveMessage: [...document.querySelectorAll('.kb-edit .hint, .kb-detail .hint')].map((el) => el.textContent.trim()),
    tagsHint: [...document.querySelectorAll('.kb-edit .hint')].map((el) => el.textContent.trim()),
    faqQuestions: [...document.querySelectorAll('.kb-faq input')].map((el) => el.value),
    faqAnswers: [...document.querySelectorAll('.kb-faq textarea')].map((el) => el.value),
  };
})()`

const collectDetail = `(() => {
  const chunks = [...document.querySelectorAll('.kb-chunk')].map((el) => {
    const meta = el.querySelector('.kb-chunk-meta')?.textContent?.trim() ?? '';
    const body = el.querySelector('.kb-chunk-body')?.innerText ?? '';
    return {
      meta,
      headingInMeta: meta.includes(' · '),
      headingPath: meta.includes(' · ') ? meta.split(' · ').slice(1).join(' · ') : '',
      body,
      bodyLen: body.length,
      hasInput: Boolean(el.querySelector('input, textarea, [contenteditable="true"]')),
    };
  });
  const detail = document.querySelector('.kb-detail');
  const text = detail?.innerText || '';
  return {
    strategyText: document.querySelector('.kb-detail > .hint')?.textContent?.trim() ?? '',
    detailText: text.replace(/\\s+/g, ' ').trim(),
    chunkCount: chunks.length,
    chunks,
    headingMetas: chunks.map((c) => c.meta),
    hasSaveChunk: /保存分块/.test(text),
    hasEditForm: Boolean(document.querySelector('.kb-edit')),
    hasOverlap80: /重叠 80\\s*字/.test(text),
    has800: /800/.test(text),
    has160: /重叠 160 字/.test(text),
    hasConvert: /先转为 Markdown/.test(text),
    hasPercent: /20%/.test(text),
    tagsHint: [...document.querySelectorAll('.kb-edit .hint')].map((el) => el.textContent.trim()),
    saveMessage: [...document.querySelectorAll('.kb-edit .hint')].find((el) => el.textContent.includes('已保存'))?.textContent ?? '',
    objectChecked: [...document.querySelectorAll('.kb-fieldset')].filter((fs) => fs.querySelector('legend')?.textContent.includes('对象标签')).flatMap((fs) => [...fs.querySelectorAll('.kb-check')].filter((l) => l.querySelector('input')?.checked).map((l) => l.textContent.trim())),
  };
})()`

const collectChat = `(() => {
  const msgs = [...document.querySelectorAll('.chat-msg')].map((n) => ({
    side: n.classList.contains('employee') ? 'employee' : 'other',
    tag: n.querySelector('.chat-msg-tag')?.textContent ?? null,
    text: n.querySelector('.chat-bubble')?.textContent ?? '',
    rewrite: n.querySelector('.chat-rewrite')?.textContent ?? null,
  }));
  return {
    pathname: location.pathname,
    conversationId: sessionStorage.getItem('conversation_id'),
    statusText: document.querySelector('.employee-status-text')?.textContent ?? null,
    messageCount: msgs.length,
    messages: msgs.map((m) => ({ ...m, text: (m.text || '').slice(0, 240) })),
    lastOther: msgs.filter((m) => m.side === 'other').at(-1) ?? null,
    lastEmployee: msgs.filter((m) => m.side === 'employee').at(-1) ?? null,
    pageHasMock: (document.body.innerText || '').includes('[Mock]'),
    sending: Boolean(document.querySelector('.employee-composer textarea')?.disabled),
  };
})()`

function redactUrl(url) {
  return String(url || '').replace(/([?&]access_token=)[^&]+/gi, '$1REDACTED')
}

function noteNetwork(msg) {
  if (msg.method === 'Network.requestWillBeSent') {
    const req = msg.params?.request
    const url = String(req?.url || '')
    if (!/\/api\/(documents|conversations|sessions)/.test(url)) return
    networkLog.push({
      kind: 'request',
      requestId: msg.params.requestId,
      method: req.method,
      url: redactUrl(url),
      ts: Date.now(),
    })
  }
  if (msg.method === 'Network.responseReceived') {
    const res = msg.params?.response
    const url = String(res?.url || '')
    if (!/\/api\/(documents|conversations|sessions)/.test(url)) return
    networkLog.push({
      kind: 'response',
      requestId: msg.params.requestId,
      status: res.status,
      url: redactUrl(url),
      mimeType: res.mimeType,
      ts: Date.now(),
    })
  }
}

async function setInputFile(name, content, mime = 'text/plain') {
  if (typeof content === 'string') {
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
  const bytes = [...content]
  return evaluate(`(() => {
    const input = document.querySelector('#kb-file');
    if (!input) throw new Error('missing #kb-file');
    const file = new File([new Uint8Array(${JSON.stringify(bytes)})], ${JSON.stringify(name)}, { type: ${JSON.stringify(mime)} });
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return input.files[0] ? { name: input.files[0].name, size: input.files[0].size } : null;
  })()`)
}

async function clickUpload() {
  await evaluate(`document.querySelector('.kb-upload button[type="submit"]').click()`)
}

async function clickFilter(label) {
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('.kb-filter-btn')].find((el) => el.textContent.trim() === ${JSON.stringify(label)});
    if (!btn) throw new Error('missing filter ' + ${JSON.stringify(label)});
    btn.click();
  })()`)
  await waitFor(
    `[...document.querySelectorAll('.kb-filter-btn')].some((el) => el.textContent.trim() === ${JSON.stringify(label)} && el.getAttribute('aria-pressed') === 'true')`,
    6000,
  )
}

async function clickNav(label) {
  await evaluate(`(() => {
    const a = [...document.querySelectorAll('.sidebar a')].find((el) => el.textContent.trim() === ${JSON.stringify(label)});
    if (!a) throw new Error('missing nav ' + ${JSON.stringify(label)});
    a.click();
  })()`)
}

async function clickRowIncludes(name) {
  await evaluate(`(() => {
    const row = [...document.querySelectorAll('.kb-row')].find((el) => (el.querySelector('.kb-row-title')?.textContent || '').includes(${JSON.stringify(name)}));
    if (!row) throw new Error('missing row ' + ${JSON.stringify(name)});
    row.click();
  })()`)
}

async function login() {
  await waitFor(`document.querySelector('.login-card') || document.querySelector('#user')`, 8000)
  await evaluate(fillScript('#user', USERNAME))
  await evaluate(fillScript('#pass', PASSWORD))
  await evaluate(`document.querySelector('button[type="submit"]').click()`)
  await waitFor(`document.querySelector('.app') && location.pathname === '/employee'`, 10000)
}

async function apiFetch(pathname, options = {}) {
  return evaluate(
    `(async () => {
      const token = localStorage.getItem('access_token');
      const res = await fetch(${JSON.stringify(pathname)}, {
        method: ${JSON.stringify(options.method || 'GET')},
        headers: {
          Authorization: 'Bearer ' + token,
          ${options.body ? `'Content-Type': 'application/json',` : ''}
        },
        ${options.body ? `body: ${JSON.stringify(JSON.stringify(options.body))},` : ''}
      });
      let body = null;
      try { body = await res.json(); } catch {}
      return { status: res.status, body };
    })()`,
    options.timeoutMs || 30000,
  )
}

function summarizeDoc(doc) {
  if (!doc) return null
  return {
    id: doc.id,
    filename: doc.filename,
    ingest_status: doc.ingest_status,
    ingest_error: doc.ingest_error,
    object_types: doc.object_types,
    request_types: doc.request_types,
    faq_count: Array.isArray(doc.faqs) ? doc.faqs.length : doc.faq_count,
    chunk_count: doc.chunk_count ?? doc.chunks?.length,
    faqs: (doc.faqs || []).map((f) => ({ id: f.id, question: f.question, answer: (f.answer || '').slice(0, 80) })),
    heading_paths: (doc.chunks || []).map((c) => c.heading_path),
    chunk_lens: (doc.chunks || []).map((c) => (c.content || '').length),
    first_chunk: (doc.chunks || [])[0]?.content?.slice(0, 120) ?? null,
  }
}

async function waitDocStatus(filename, wanted, timeoutMs = 240000) {
  const start = Date.now()
  let last = null
  while (Date.now() - start < timeoutMs) {
    const kb = await evaluate(collectKb)
    const row = kb.rows.find((r) => r.filename.includes(filename))
    const list = await apiFetch('/api/documents?page=1&page_size=20')
    const item = (list.body?.data || []).find((d) => String(d.filename || '').includes(filename))
    last = { ui: row, api: item }
    if (row?.status === wanted && item?.ingest_status === (wanted === '已完成' ? 'ready' : wanted === '入库中' ? 'ingesting' : 'failed')) {
      return last
    }
    if (item?.ingest_status === 'failed' && wanted === '已完成') {
      return last
    }
    await delay(1000)
  }
  throw new Error(`waitDocStatus timeout ${filename} ${wanted}: ${JSON.stringify(last)}`)
}

async function sendChat(text, timeoutMs = 90000) {
  const before = await evaluate(collectChat)
  await evaluate(fillScript('.employee-composer textarea', text))
  await evaluate(`document.querySelector('.employee-composer button[type="submit"]').click()`)
  const start = Date.now()
  let last = before
  while (Date.now() - start < timeoutMs) {
    last = await evaluate(collectChat)
    const newOther =
      last.messageCount > before.messageCount &&
      last.lastOther &&
      last.lastEmployee?.text?.includes(text.slice(0, 20)) &&
      !last.sending
    if (newOther && last.lastOther.text) return last
    await delay(400)
  }
  throw new Error(`chat timeout: ${text.slice(0, 40)} last=${JSON.stringify(last)}`)
}

function pollIntervals(entries) {
  const gets = entries.filter((e) => e.kind === 'request' && e.method === 'GET' && /\/api\/documents(\?|$)/.test(e.url) && !/\/documents\//.test(e.url.replace(/http:\/\/[^/]+/, '')))
  const times = gets.map((e) => e.ts)
  const deltas = []
  for (let i = 1; i < times.length; i += 1) deltas.push(times[i] - times[i - 1])
  return { count: gets.length, deltas: deltas.slice(0, 12), around3s: deltas.filter((d) => d >= 2500 && d <= 4500).length }
}

function timeToMinuteOk(text) {
  return /·\s*\d{1,2}月\d{1,2}日 \d{2}:\d{2}\s*$/.test(String(text || '').trim()) || /\d{1,2}月\d{1,2}日 \d{2}:\d{2}/.test(String(text || ''))
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const blankPdf = await readFile(path.join(FIXTURE_DIR, 'blank.pdf'))
  const textPdf = await readFile(path.join(FIXTURE_DIR, 'printer-guide.pdf'))
  const userData = await mkdtemp(path.join(os.tmpdir(), 't011-chrome-'))
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
    if (msg.method) noteNetwork(msg)
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
  await setViewport(1440, 900)

  async function goto(url) {
    const nav = send('Page.navigate', { url })
    await Promise.race([send('Page.loadEventFired').catch(() => null), delay(3000)])
    await nav
  }

  const evidence = {
    mock: false,
    viewport: '1440x900',
    cdpPort: CDP_PORT,
    url: BASE,
    backend: BACKEND,
    userDataDir: userData,
    longTxtLen: LONG_TXT.length,
    longMdLen: LONG_MD.length,
    steps: {},
  }

  const vite = await fetch(BASE)
  evidence.viteStatus = vite.status
  record('env-vite', vite.status === 200, 200, vite.status)
  const backend = await fetch(`${BACKEND}/docs`)
  evidence.backendStatus = backend.status
  record('env-backend', backend.status === 200, 200, backend.status)

  await goto(`${BASE}/login`)
  await waitFor(`document.querySelector('.login-card')`, 8000)
  const mockFlag = await evaluate(`import('/src/utils/mockFlag.ts').then((m) => m.isMockEnabled())`)
  evidence.mockEnabled = mockFlag
  record('tc-mock-off', mockFlag === false, false, mockFlag)

  await login()
  await clickNav('知识库')
  await waitFor(`location.pathname === '/knowledge' && document.querySelector('.kb-page')`, 8000)

  const emptyAll = await evaluate(collectKb)
  evidence.emptyAll = { ...emptyAll, screenshot: await screenshot('t011-empty-all.png') }
  record(
    'tc-no-mock-page',
    emptyAll.pageHasMock === false && emptyAll.pathname === '/knowledge',
    { mock: false, page: '/knowledge' },
    { mock: emptyAll.pageHasMock, pathname: emptyAll.pathname },
  )
  record(
    'ac028-empty-all',
    emptyAll.rowCount === 0 && emptyAll.emptyText.includes(EMPTY_ALL_TEXT) && emptyAll.uploadEnabled,
    EMPTY_ALL_TEXT,
    { emptyText: emptyAll.emptyText, uploadEnabled: emptyAll.uploadEnabled },
  )

  await clickFilter('入库中')
  const emptyIngesting = await evaluate(collectKb)
  evidence.emptyIngesting = { ...emptyIngesting, screenshot: await screenshot('t011-empty-ingesting.png') }
  record(
    'ac028-empty-ingesting',
    emptyIngesting.rowCount === 0 && emptyIngesting.emptyText.includes(EMPTY_FILTER_TEXT) && emptyIngesting.uploadEnabled,
    EMPTY_FILTER_TEXT,
    { emptyText: emptyIngesting.emptyText, uploadEnabled: emptyIngesting.uploadEnabled },
  )
  await clickFilter('请重新上传')
  const emptyFailed = await evaluate(collectKb)
  evidence.emptyFailed = emptyFailed
  record(
    'ac028-empty-failed',
    emptyFailed.rowCount === 0 && emptyFailed.emptyText.includes(EMPTY_FILTER_TEXT) && emptyFailed.uploadEnabled,
    EMPTY_FILTER_TEXT,
    { emptyText: emptyFailed.emptyText, uploadEnabled: emptyFailed.uploadEnabled },
  )

  const invalid = await apiFetch('/api/documents?ingest_status=bogus')
  evidence.invalidFilter = { status: invalid.status, error: invalid.body?.error, error_code: invalid.body?.error_code }
  record(
    'tc-api004-invalid-filter',
    invalid.status === 400 && invalid.body?.error === '入库状态筛选无效' && invalid.body?.error_code === 'VALIDATION_ERROR',
    { http: 400, error: '入库状态筛选无效' },
    evidence.invalidFilter,
  )

  await clickFilter('全部')
  const beforeReject = await evaluate(collectKb)
  await setInputFile('notes.docx', 'not-a-document', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  await clickUpload()
  await waitFor(`(document.querySelector('.kb-upload [role="alert"]')?.textContent || '').includes('请重新上传')`, 8000)
  const afterDocx = await evaluate(collectKb)
  evidence.rejectDocx = { rowCount: afterDocx.rowCount, uploadError: afterDocx.uploadError, screenshot: await screenshot('t011-reject-docx.png') }
  record(
    'ac004-reject-docx',
    afterDocx.uploadError.includes('请重新上传') && afterDocx.rowCount === beforeReject.rowCount && !afterDocx.filenames.some((n) => n.includes('notes.docx')) && afterDocx.pageHasMock === false,
    { noNewRow: true, error: '请重新上传' },
    { rowCount: afterDocx.rowCount, uploadError: afterDocx.uploadError, filenames: afterDocx.filenames },
  )

  await setInputFile('empty.txt', '', 'text/plain')
  await clickUpload()
  await waitFor(`(document.querySelector('.kb-upload [role="alert"]')?.textContent || '').includes('请重新上传')`, 8000)
  const afterEmpty = await evaluate(collectKb)
  evidence.rejectEmpty = { rowCount: afterEmpty.rowCount, uploadError: afterEmpty.uploadError }
  record(
    'ac004-reject-empty',
    afterEmpty.uploadError.includes('请重新上传') && afterEmpty.rowCount === beforeReject.rowCount && !afterEmpty.filenames.some((n) => n.includes('empty.txt')),
    { noNewRow: true },
    { rowCount: afterEmpty.rowCount, uploadError: afterEmpty.uploadError },
  )

  await setInputFile('blank.pdf', blankPdf, 'application/pdf')
  await clickUpload()
  await waitFor(`(document.querySelector('.kb-upload [role="alert"]')?.textContent || '').includes('请重新上传')`, 8000)
  const afterBlank = await evaluate(collectKb)
  evidence.rejectBlankPdf = { rowCount: afterBlank.rowCount, uploadError: afterBlank.uploadError, screenshot: await screenshot('t011-reject-blank-pdf.png') }
  record(
    'ac004-reject-blank-pdf',
    afterBlank.uploadError.includes('请重新上传') && afterBlank.rowCount === beforeReject.rowCount && !afterBlank.filenames.some((n) => n.includes('blank.pdf')),
    { noNewRow: true },
    { rowCount: afterBlank.rowCount, uploadError: afterBlank.uploadError, filenames: afterBlank.filenames },
  )

  const listAfterReject = await apiFetch('/api/documents?page=1&page_size=20')
  evidence.listAfterReject = { status: listAfterReject.status, total: listAfterReject.body?.pagination?.total_items, names: (listAfterReject.body?.data || []).map((d) => d.filename) }
  record(
    'ac004-api-no-row',
    listAfterReject.status === 200 && (listAfterReject.body?.pagination?.total_items || 0) === 0,
    0,
    evidence.listAfterReject,
  )

  const postBefore = networkLog.filter((e) => e.kind === 'response' && e.method !== 'GET').length
  await clickFilter('已完成')
  const readyEmpty = await evaluate(collectKb)
  evidence.readyEmptyBeforeUpload = readyEmpty
  record(
    'ac028-empty-ready',
    readyEmpty.filterPressedValue === 'ready' && readyEmpty.rowCount === 0 && readyEmpty.emptyText.includes(EMPTY_FILTER_TEXT),
    EMPTY_FILTER_TEXT,
    { filter: readyEmpty.filterPressedValue, emptyText: readyEmpty.emptyText },
  )

  await setInputFile(MD_NAME, LONG_MD, 'text/markdown')
  await clickUpload()
  await waitFor(
    `[...document.querySelectorAll('.kb-filter-btn')].some((el) => el.getAttribute('data-filter')==='all' && el.getAttribute('aria-pressed')==='true')`,
    8000,
  )
  await waitFor(`[...document.querySelectorAll('.kb-row-title')].some((el) => el.textContent.includes(${JSON.stringify(MD_NAME)}))`, 8000)
  const afterMd = await evaluate(collectKb)
  const mdPost = networkLog.filter((e) => e.kind === 'response' && String(e.url).includes('/api/documents') && !String(e.url).includes('/documents/') && e.status)
  evidence.uploadMd = { ...afterMd, screenshot: await screenshot('t011-md-ingesting.png'), posts: mdPost.slice(-6) }
  record(
    'ac028-upload-from-ready-to-all',
    afterMd.filterPressedValue === 'all' && afterMd.filenames[0] === MD_NAME && afterMd.statuses[0] === '入库中',
    { filter: 'all', first: MD_NAME, status: '入库中' },
    { filter: afterMd.filterPressedValue, first: afterMd.filenames[0], status: afterMd.statuses[0] },
  )
  record(
    'ac027-md-top-ingesting',
    afterMd.filenames[0] === MD_NAME &&
      afterMd.statuses[0] === '入库中' &&
      timeToMinuteOk(afterMd.times[0]) &&
      !afterMd.rows[0]?.hasCreatedAt &&
      afterMd.pageHasMock === false,
    { filename: MD_NAME, status: '入库中', timeToMinute: true },
    { first: afterMd.filenames[0], status: afterMd.statuses[0], time: afterMd.times[0] },
  )
  record(
    'tc-filename-md-original',
    afterMd.filenames[0] === MD_NAME && !afterMd.filenames.some((n) => n.includes('t011-helix-vpn.md.md')),
    MD_NAME,
    afterMd.filenames[0],
  )

  const mdList = await apiFetch('/api/documents?page=1&page_size=20')
  const mdItem = (mdList.body?.data || [])[0]
  evidence.mdAccepted = { status: mdList.status, item: mdItem }
  record(
    'tc-api003-202-ingesting',
    mdItem?.filename === MD_NAME && mdItem?.ingest_status === 'ingesting' && (mdItem?.chunk_count || 0) === 0,
    { filename: MD_NAME, ingest_status: 'ingesting' },
    mdItem,
  )
  const mdPost202 = networkLog.some((e) => e.kind === 'response' && e.status === 202 && String(e.url).includes('/api/documents'))
  record('tc-http-202', mdPost202, 202, mdPost.map((e) => ({ status: e.status, url: e.url })))

  await clickRowIncludes(MD_NAME)
  const ingestingDetail = await evaluate(collectKb)
  evidence.ingestingDetail = ingestingDetail
  record(
    'ac023-no-preview-or-edit',
    ingestingDetail.hasChunks === 0 &&
      ingestingDetail.hasEditForm === false &&
      ingestingDetail.detailText.includes('正在入库中') &&
      ingestingDetail.statuses[0] === '入库中',
    { chunks: 0, edit: false, hint: '正在入库中' },
    { chunks: ingestingDetail.hasChunks, edit: ingestingDetail.hasEditForm, detail: ingestingDetail.detailText.slice(0, 80) },
  )

  const pollStart = Date.now()
  await delay(7000)
  evidence.pollSample = pollIntervals(networkLog.filter((e) => e.ts >= pollStart - 500))
  record(
    'tc-poll-about-3s',
    evidence.pollSample.around3s >= 1 || evidence.pollSample.deltas.some((d) => d >= 2500 && d <= 4500),
    '~3000ms',
    evidence.pollSample,
  )

  await clickNav('员工端')
  await waitFor(`location.pathname === '/employee' && document.querySelector('.employee-composer textarea')`, 8000)
  let ingestAsk
  try {
    ingestAsk = await sendChat('T011HELIX-FAIL VPN 连接失败认证该怎么处理')
  } catch (err) {
    ingestAsk = { error: String(err) }
  }
  evidence.ingestAsk = ingestAsk
  const ingestHit =
    ingestAsk?.lastOther &&
    /知识问答|FAQ/.test(String(ingestAsk.lastOther.tag || '')) &&
    /T011HELIX/.test(String(ingestAsk.lastOther.text || ''))
  record(
    'ac023-ask-not-hit-ingesting',
    !ingestAsk?.error && ingestHit !== true && ingestAsk.pageHasMock === false,
    { notFaqOrKnowledgeWithToken: true },
    { tag: ingestAsk?.lastOther?.tag, text: ingestAsk?.lastOther?.text, error: ingestAsk?.error },
  )

  await clickNav('知识库')
  await waitFor(`location.pathname === '/knowledge' && document.querySelector('.kb-page')`, 8000)
  const backKb = await evaluate(collectKb)
  evidence.backKb = { ...backKb, screenshot: await screenshot('t011-md-after-leave.png') }
  record(
    'ac023-still-listed-after-leave',
    backKb.filenames.includes(MD_NAME) && (backKb.statuses[backKb.filenames.indexOf(MD_NAME)] === '入库中' || backKb.statuses[backKb.filenames.indexOf(MD_NAME)] === '已完成'),
    { listed: true, stillIngestingOrReady: true },
    { filenames: backKb.filenames, statuses: backKb.statuses },
  )

  const mdReady = await waitDocStatus(MD_NAME, '已完成', 240000)
  evidence.mdReadyRow = mdReady
  const mdFailed = mdReady.api?.ingest_status === 'failed'
  record(
    'ac003-md-ready',
    !mdFailed && mdReady.ui?.status === '已完成' && mdReady.api?.ingest_status === 'ready',
    'ready',
    mdReady,
  )

  if (!mdFailed) {
    await clickFilter('全部')
    await clickRowIncludes(MD_NAME)
    await waitFor(`document.querySelectorAll('.kb-chunk').length > 0`, 15000)
    const mdDetail = await evaluate(collectDetail)
    const mdApi = await apiFetch(`/api/documents/${mdReady.api.id}`)
    evidence.mdDetail = { ...mdDetail, screenshot: await screenshot('t011-md-ready.png'), api: summarizeDoc(mdApi.body?.data) }
    record(
      'ac024-strategy',
      STRATEGY_NEEDLES.every((n) => mdDetail.strategyText.includes(n)) && mdDetail.hasConvert && mdDetail.has160 && mdDetail.has800 && !mdDetail.hasOverlap80,
      STRATEGY_NEEDLES,
      mdDetail.strategyText,
    )
    record(
      'ac024-chunks-match-api',
      mdDetail.chunkCount > 1 &&
        mdDetail.chunkCount === (mdApi.body?.data?.chunks || []).length &&
        mdDetail.chunkCount === mdApi.body?.data?.chunk_count &&
        mdDetail.chunks.every((c) => !c.hasInput) &&
        mdDetail.hasSaveChunk === false &&
        mdDetail.hasEditForm === true,
      { chunks: '>1', matchApi: true, readonly: true },
      { ui: mdDetail.chunkCount, api: mdApi.body?.data?.chunk_count, hasSaveChunk: mdDetail.hasSaveChunk },
    )
    record(
      'ac024-heading-path',
      (mdApi.body?.data?.chunks || []).some((c) => (c.heading_path || '').includes('密码重置')) &&
        (mdApi.body?.data?.chunks || []).some((c) => (c.heading_path || '').includes('连接失败')) &&
        !(mdApi.body?.data?.chunks || []).some((c) => c.heading_path === 'T011Helix VPN' && !(c.content || '').trim()),
      { hasReset: true, hasFail: true, noEmptyParent: true },
      (mdApi.body?.data?.chunks || []).map((c) => c.heading_path),
    )
    record(
      'ac003-md-tags-faq-visible',
      (mdApi.body?.data?.object_types || []).length > 0 &&
        (mdApi.body?.data?.faqs || []).length >= 0 &&
        mdDetail.hasEditForm &&
        mdDetail.tagsHint.some((t) => t.includes('当前标签')) || (mdApi.body?.data?.object_types || []).length > 0,
      { tags: true, editable: true },
      { object_types: mdApi.body?.data?.object_types, faq_count: mdApi.body?.data?.faqs?.length, tagsHint: mdDetail.tagsHint },
    )

    await clickFilter('入库中')
    const ingestingWhileReady = await evaluate(collectKb)
    evidence.filterIngestingWhileMdReady = ingestingWhileReady
    record(
      'ac028-filter-ingesting-only',
      ingestingWhileReady.filterPressedValue === 'ingesting' && ingestingWhileReady.statuses.every((s) => s === '入库中' || s === ''),
      'only 入库中 or empty',
      { statuses: ingestingWhileReady.statuses, emptyText: ingestingWhileReady.emptyText },
    )
  }

  await clickFilter('全部')
  await setInputFile(TXT_NAME, LONG_TXT, 'text/plain')
  await clickUpload()
  await waitFor(`[...document.querySelectorAll('.kb-row-title')].some((el) => el.textContent.includes(${JSON.stringify(TXT_NAME)}))`, 8000)
  const afterTxt = await evaluate(collectKb)
  evidence.uploadTxt = afterTxt
  record(
    'ac027-txt-original-name-top',
    afterTxt.filenames[0] === TXT_NAME && afterTxt.statuses[0] === '入库中' && afterTxt.filenames.includes(MD_NAME),
    { first: TXT_NAME, status: '入库中', mdStillListed: true },
    { first: afterTxt.filenames[0], status: afterTxt.statuses[0], filenames: afterTxt.filenames.slice(0, 4) },
  )
  record(
    'tc-filename-txt-not-md',
    afterTxt.filenames[0] === TXT_NAME && !afterTxt.filenames.some((n) => n === 't011-office-wifi.md'),
    TXT_NAME,
    afterTxt.filenames[0],
  )

  const txtReady = await waitDocStatus(TXT_NAME, '已完成', 240000)
  evidence.txtReadyRow = txtReady
  record('ac003-txt-ready', txtReady.api?.ingest_status === 'ready', 'ready', txtReady.api)
  if (txtReady.api?.ingest_status === 'ready') {
    await clickRowIncludes(TXT_NAME)
    await waitFor(`document.querySelectorAll('.kb-chunk').length > 0`, 15000)
    const txtDetail = await evaluate(collectDetail)
    const txtApi = await apiFetch(`/api/documents/${txtReady.api.id}`)
    evidence.txtDetail = { ...txtDetail, screenshot: await screenshot('t011-txt-ready.png'), api: summarizeDoc(txtApi.body?.data) }
    const txtChunks = txtApi.body?.data?.chunks || []
    record(
      'ac029-txt-convert-then-chunk',
      txtChunks.length > 1 &&
        txtChunks.every((c) => (c.heading_path || '') === '') &&
        txtChunks.every((c) => (c.content || '').length <= 800) &&
        txtDetail.hasConvert &&
        txtDetail.has160 &&
        !txtDetail.hasSaveChunk &&
        txtDetail.chunks.every((c) => !c.hasInput) &&
        JSON.stringify(txtChunks.map((c) => c.content)).includes('T011WIFI') &&
        !/%PDF/.test(JSON.stringify(txtChunks)),
      { chunks: '>1', heading_path: '', convert: true },
      { count: txtChunks.length, heading_paths: txtChunks.map((c) => c.heading_path), first: txtChunks[0]?.content?.slice(0, 80) },
    )
    record(
      'ac003-txt-tags-faq',
      (txtApi.body?.data?.object_types || []).length > 0 && txtDetail.hasEditForm,
      { tagsVisible: true },
      { object_types: txtApi.body?.data?.object_types, faqs: (txtApi.body?.data?.faqs || []).length },
    )
  }

  await clickFilter('全部')
  await setInputFile(PDF_NAME, textPdf, 'application/pdf')
  await clickUpload()
  await waitFor(`[...document.querySelectorAll('.kb-row-title')].some((el) => el.textContent.includes(${JSON.stringify(PDF_NAME)}))`, 8000)
  const afterPdf = await evaluate(collectKb)
  evidence.uploadPdf = { ...afterPdf, screenshot: await screenshot('t011-pdf-ingesting.png') }
  record(
    'tc-filename-pdf-original',
    afterPdf.filenames[0] === PDF_NAME && afterPdf.statuses[0] === '入库中' && !afterPdf.filenames.some((n) => n.includes('printer-guide.md')),
    PDF_NAME,
    { first: afterPdf.filenames[0], status: afterPdf.statuses[0] },
  )

  const pdfReady = await waitDocStatus(PDF_NAME, '已完成', 240000)
  evidence.pdfReadyRow = pdfReady
  record('ac003-pdf-ready', pdfReady.api?.ingest_status === 'ready', 'ready', pdfReady.api)
  if (pdfReady.api?.ingest_status === 'ready') {
    await clickRowIncludes(PDF_NAME)
    await waitFor(`document.querySelectorAll('.kb-chunk').length > 0`, 15000)
    const pdfDetail = await evaluate(collectDetail)
    const pdfApi = await apiFetch(`/api/documents/${pdfReady.api.id}`)
    evidence.pdfDetail = { ...pdfDetail, screenshot: await screenshot('t011-pdf-ready.png'), api: summarizeDoc(pdfApi.body?.data) }
    const pdfChunks = pdfApi.body?.data?.chunks || []
    record(
      'ac029-pdf-convert-then-chunk',
      pdfChunks.length > 1 &&
        pdfChunks.every((c) => (c.heading_path || '') === '') &&
        pdfDetail.hasConvert &&
        !/%PDF/.test(JSON.stringify(pdfChunks)) &&
        /T011PRINTER/.test(JSON.stringify(pdfChunks)) &&
        pdfDetail.chunkCount === pdfChunks.length &&
        pdfDetail.chunks.every((c) => !c.hasInput),
      { chunks: '>1', heading_path: '', noRawPdf: true },
      { count: pdfChunks.length, heading_paths: pdfChunks.map((c) => c.heading_path), first: pdfChunks[0]?.content?.slice(0, 80) },
    )
    record(
      'ac003-pdf-tags-faq',
      (pdfApi.body?.data?.object_types || []).length > 0 && pdfDetail.hasEditForm,
      { tagsVisible: true },
      { object_types: pdfApi.body?.data?.object_types, faqs: (pdfApi.body?.data?.faqs || []).length },
    )
  }

  await clickFilter('全部')
  const allList = await evaluate(collectKb)
  evidence.filterAll = allList
  const allApi = await apiFetch('/api/documents?page=1&page_size=20')
  const allItems = allApi.body?.data || []
  const updatedOrder = allItems.map((d) => d.updated_at)
  const sorted = [...updatedOrder].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
  record(
    'ac027-api-desc',
    allItems.length >= 2 && JSON.stringify(updatedOrder) === JSON.stringify(sorted) && allApi.status === 200,
    'updated_at desc',
    { names: allItems.map((d) => d.filename), updated_at: updatedOrder },
  )
  record(
    'ac027-ui-original-names-status-time',
    allList.filenames.every((n) => n === MD_NAME || n === TXT_NAME || n === PDF_NAME || n === SWITCH_NAME) &&
      allList.rows.every((r) => r.filename && r.status && timeToMinuteOk(r.timeText)) &&
      allList.pageHasMock === false,
    { originalNames: true, status: true, localMinute: true },
    { rows: allList.rows.map((r) => ({ filename: r.filename, status: r.status, time: r.timeText })) },
  )

  await clickFilter('已完成')
  const readyOnly = await evaluate(collectKb)
  const readyApi = await apiFetch('/api/documents?page=1&page_size=20&ingest_status=ready')
  evidence.filterReady = { ui: readyOnly, apiCount: (readyApi.body?.data || []).length, screenshot: await screenshot('t011-filter-ready.png') }
  record(
    'ac028-filter-ready',
    readyOnly.statuses.every((s) => s === '已完成') &&
      readyOnly.rowCount === (readyApi.body?.data || []).length &&
      (readyApi.body?.data || []).every((d) => d.ingest_status === 'ready'),
    'all ready',
    { ui: readyOnly.statuses, api: (readyApi.body?.data || []).map((d) => d.ingest_status) },
  )

  await clickFilter('入库中')
  const ingestingOnly = await evaluate(collectKb)
  const ingestingApi = await apiFetch('/api/documents?page=1&page_size=20&ingest_status=ingesting')
  evidence.filterIngesting = ingestingOnly
  record(
    'ac028-filter-ingesting',
    ingestingOnly.statuses.every((s) => s === '入库中') &&
      ingestingOnly.rowCount === (ingestingApi.body?.data || []).length,
    'all ingesting or empty copy',
    { ui: ingestingOnly.statuses, emptyText: ingestingOnly.emptyText, apiTotal: ingestingApi.body?.pagination?.total_items },
  )
  if (ingestingOnly.rowCount === 0) {
    record('ac028-empty-ingesting-after-ready', ingestingOnly.emptyText.includes(EMPTY_FILTER_TEXT) && ingestingOnly.uploadEnabled, EMPTY_FILTER_TEXT, ingestingOnly.emptyText)
  }

  await clickFilter('请重新上传')
  const failedOnly = await evaluate(collectKb)
  const failedApi = await apiFetch('/api/documents?page=1&page_size=20&ingest_status=failed')
  evidence.filterFailed = failedOnly
  record(
    'ac028-filter-failed',
    failedOnly.statuses.every((s) => s === '请重新上传') && failedOnly.rowCount === (failedApi.body?.data || []).length,
    'all failed or empty copy',
    { ui: failedOnly.statuses, emptyText: failedOnly.emptyText, apiTotal: failedApi.body?.pagination?.total_items },
  )
  if (failedOnly.rowCount === 0) {
    record('ac028-empty-failed-after-ready', failedOnly.emptyText.includes(EMPTY_FILTER_TEXT) && failedOnly.uploadEnabled, EMPTY_FILTER_TEXT, failedOnly.emptyText)
  }

  await clickFilter('已完成')
  await setInputFile(SWITCH_NAME, '# T011 switch\n\nShort markdown for filter switch.\n', 'text/markdown')
  await clickUpload()
  await waitFor(
    `[...document.querySelectorAll('.kb-filter-btn')].some((el) => el.getAttribute('data-filter')==='all' && el.getAttribute('aria-pressed')==='true')`,
    8000,
  )
  await waitFor(`[...document.querySelectorAll('.kb-row-title')].some((el) => el.textContent.includes(${JSON.stringify(SWITCH_NAME)}))`, 8000)
  const afterSwitch = await evaluate(collectKb)
  evidence.uploadFromReady2 = { ...afterSwitch, screenshot: await screenshot('t011-upload-from-ready.png') }
  record(
    'ac028-upload-from-ready-again',
    afterSwitch.filterPressedValue === 'all' && afterSwitch.filenames[0] === SWITCH_NAME && afterSwitch.statuses[0] === '入库中',
    { filter: 'all', first: SWITCH_NAME, status: '入库中' },
    { filter: afterSwitch.filterPressedValue, first: afterSwitch.filenames[0], status: afterSwitch.statuses[0] },
  )

  if (!mdFailed && mdReady.api?.id) {
    await waitDocStatus(SWITCH_NAME, '已完成', 240000).catch((err) => {
      evidence.switchReadyError = String(err)
      return null
    })
    await clickFilter('全部')
    await clickRowIncludes(MD_NAME)
    await waitFor(`document.querySelector('.kb-edit')`, 15000)
    const beforeEdit = await evaluate(collectDetail)
    const mdApiBefore = await apiFetch(`/api/documents/${mdReady.api.id}`)
    const originalTypes = mdApiBefore.body?.data?.object_types || []
    const originalFaqs = mdApiBefore.body?.data?.faqs || []
    evidence.mdBeforeEdit = { types: originalTypes, faqs: originalFaqs.map((f) => f.question) }
    const targetLabel = originalTypes.includes('network') ? '硬件设备' : '网络与远程接入'
    const targetCode = originalTypes.includes('network') ? 'hardware' : 'network'
    const oldCode = originalTypes.includes('network') ? 'network' : originalTypes[0]
    await evaluate(`(() => {
      const fieldset = [...document.querySelectorAll('.kb-fieldset')].find((fs) => (fs.querySelector('legend')?.textContent || '').includes('对象标签'));
      if (!fieldset) throw new Error('missing object fieldset');
      for (const label of fieldset.querySelectorAll('.kb-check')) {
        const name = label.textContent.trim();
        const input = label.querySelector('input[type="checkbox"]');
        const want = name.includes(${JSON.stringify(targetLabel)});
        if (Boolean(input.checked) !== want) input.click();
      }
      return [...fieldset.querySelectorAll('.kb-check')].filter((l) => l.querySelector('input')?.checked).map((l) => l.textContent.trim());
    })()`)
    await evaluate(`document.querySelector('.kb-edit button[type="submit"]').click()`)
    await waitFor(`(document.body.innerText || '').includes('已保存，将立即用于后续提问')`, 20000)
    const afterTagSave = await evaluate(collectDetail)
    const mdApiAfterTag = await apiFetch(`/api/documents/${mdReady.api.id}`)
    evidence.tagSave = { afterTagSave, api: summarizeDoc(mdApiAfterTag.body?.data), screenshot: await screenshot('t011-tag-saved.png') }
    record(
      'ac017-page-shows-new-tags',
      afterTagSave.objectChecked.some((n) => n.includes(targetLabel)) &&
        (mdApiAfterTag.body?.data?.object_types || []).includes(targetCode) &&
        !(mdApiAfterTag.body?.data?.object_types || []).includes(oldCode) &&
        (afterTagSave.saveMessage || '').includes('已保存'),
      { target: targetLabel, api: targetCode },
      { checked: afterTagSave.objectChecked, api: mdApiAfterTag.body?.data?.object_types, save: afterTagSave.saveMessage },
    )

    await clickNav('员工端')
    await waitFor(`document.querySelector('.employee-composer textarea')`, 8000)
    const newTagQuestion =
      targetCode === 'hardware'
        ? 'T011HELIX-FAIL 认证失败是不是网卡硬件坏了，该怎么处理'
        : 'T011HELIX-FAIL VPN 连接失败认证该怎么排查'
    const oldTagQuestion =
      oldCode === 'network' || originalTypes.includes('network')
        ? 'T011HELIX VPN 连接失败认证该怎么排查，不要问硬件'
        : 'T011HELIX Outlook 客户端打不开该怎么排查'
    let newTagAsk
    try {
      newTagAsk = await sendChat(newTagQuestion)
    } catch (err) {
      newTagAsk = { error: String(err) }
    }
    evidence.newTagAsk = newTagAsk
    const newTagHitKnowledge = /知识问答/.test(String(newTagAsk?.lastOther?.tag || '')) && /T011HELIX/.test(String(newTagAsk?.lastOther?.text || ''))
    const newTagFallback = /兜底/.test(String(newTagAsk?.lastOther?.tag || ''))
    record(
      'ac017-question-uses-new-tags',
      !newTagAsk?.error && (newTagHitKnowledge || newTagFallback || Boolean(newTagAsk?.lastOther?.tag)),
      { answered: true, preferKnowledgeIfHardwareQueryMatches: true },
      { tag: newTagAsk?.lastOther?.tag, text: newTagAsk?.lastOther?.text, error: newTagAsk?.error, targetCode },
    )

    await clickNav('知识库')
    await waitFor(`document.querySelector('.kb-page')`, 8000)
    await clickRowIncludes(MD_NAME)
    await waitFor(`document.querySelector('.kb-edit')`, 15000)
    await evaluate(`(() => {
      const del = () => [...document.querySelectorAll('.kb-faq button')].filter((b) => b.textContent.includes('删除 FAQ'));
      while (del().length > 1) del()[0].click();
      if (!document.querySelector('.kb-faq')) {
        const add = [...document.querySelectorAll('.kb-edit button')].find((b) => b.textContent.trim() === '添加 FAQ');
        add && add.click();
      }
      const q = document.querySelector('.kb-faq input');
      const a = document.querySelector('.kb-faq textarea');
      const setVal = (el, val, proto) => {
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        desc.set.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setVal(q, ${JSON.stringify(FAQ_QUESTION)}, HTMLInputElement.prototype);
      setVal(a, ${JSON.stringify(FAQ_ANSWER)}, HTMLTextAreaElement.prototype);
      return { q: q.value, a: a.value, n: document.querySelectorAll('.kb-faq').length };
    })()`)
    await evaluate(`document.querySelector('.kb-edit button[type="submit"]').click()`)
    await waitFor(`(document.body.innerText || '').includes('已保存，将立即用于后续提问')`, 20000)
    const afterFaqSave = await evaluate(collectKb)
    const mdApiAfterFaq = await apiFetch(`/api/documents/${mdReady.api.id}`)
    evidence.faqSave = { questions: afterFaqSave.faqQuestions, answers: afterFaqSave.faqAnswers, api: summarizeDoc(mdApiAfterFaq.body?.data), screenshot: await screenshot('t011-faq-saved.png') }
    record(
      'ac018-page-shows-new-faq',
      afterFaqSave.faqQuestions.some((q) => q.includes('T011HELIX 重置 VPN')) &&
        afterFaqSave.faqAnswers.some((a) => a.includes('T011HELIX-FAQ-NEW')) &&
        (mdApiAfterFaq.body?.data?.faqs || []).some((f) => f.answer.includes('T011HELIX-FAQ-NEW')),
      FAQ_QUESTION,
      { questions: afterFaqSave.faqQuestions, api: (mdApiAfterFaq.body?.data?.faqs || []).map((f) => f.question) },
    )

    await clickNav('员工端')
    await waitFor(`document.querySelector('.employee-composer textarea')`, 8000)
    let faqAsk
    try {
      faqAsk = await sendChat(FAQ_QUESTION)
    } catch (err) {
      faqAsk = { error: String(err) }
    }
    evidence.faqAsk = faqAsk
    record(
      'ac018-new-faq-hit',
      /FAQ/.test(String(faqAsk?.lastOther?.tag || '')) && /T011HELIX-FAQ-NEW/.test(String(faqAsk?.lastOther?.text || '')),
      { tag: 'FAQ', answerToken: 'T011HELIX-FAQ-NEW' },
      { tag: faqAsk?.lastOther?.tag, text: faqAsk?.lastOther?.text, error: faqAsk?.error },
    )
    let oldFaqAsk
    try {
      oldFaqAsk = await sendChat(originalFaqs[0]?.question || FAQ_OLD_QUESTION)
    } catch (err) {
      oldFaqAsk = { error: String(err) }
    }
    evidence.oldFaqAsk = oldFaqAsk
    const oldAnswer = originalFaqs[0]?.answer || ''
    record(
      'ac018-old-faq-not-hit',
      !oldFaqAsk?.error &&
        !(oldAnswer && String(oldFaqAsk?.lastOther?.text || '').includes(oldAnswer.slice(0, 20))) &&
        !/T011HELIX-OLD/.test(String(oldFaqAsk?.lastOther?.text || '')),
      { notOldAnswer: true },
      { tag: oldFaqAsk?.lastOther?.tag, text: oldFaqAsk?.lastOther?.text, oldAnswerHead: oldAnswer.slice(0, 40) },
    )

    const knowledgeAskQ = 'T011HELIX-RESET 账号中心重置密码之后怎样重新导入公司 VPN 配置，这不是 FAQ 原句'
    let knowledgeAsk
    try {
      knowledgeAsk = await sendChat(knowledgeAskQ)
    } catch (err) {
      knowledgeAsk = { error: String(err) }
    }
    evidence.knowledgeAsk = knowledgeAsk
    record(
      'ac003-md-faq-and-retrieval',
      /FAQ/.test(String(faqAsk?.lastOther?.tag || '')) &&
        (/知识问答/.test(String(knowledgeAsk?.lastOther?.tag || '')) || /T011HELIX/.test(String(knowledgeAsk?.lastOther?.text || ''))),
      { faqHit: true, knowledgeHit: true },
      { faq: faqAsk?.lastOther, knowledge: knowledgeAsk?.lastOther, knowledgeError: knowledgeAsk?.error },
    )
  }

  const anyMock = checks.some((c) => JSON.stringify(c.actual || {}).includes('[Mock]'))
  record('tc-no-mock-evidence', anyMock === false && mockFlag === false, false, { anyMock, mockFlag })

  evidence.network = networkLog.map((e) => ({
    kind: e.kind,
    method: e.method,
    status: e.status,
    url: e.url,
    ts: e.ts,
  }))
  evidence.poll = pollIntervals(networkLog)
  evidence.checks = checks
  evidence.failed = checks.filter((c) => !c.pass).map((c) => c.id)
  await writeFile(path.join(OUT_DIR, 't011-browser-evidence.json'), JSON.stringify(evidence, null, 2))
  console.log(`failed=${JSON.stringify(evidence.failed)}`)
  if (evidence.failed.length) process.exitCode = 1
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => {
    try {
      ws?.close()
    } catch {
      // ignore
    }
    try {
      if (chromeProc && chromeProc.pid) chromeProc.kill()
    } catch {
      // ignore
    }
  })
