import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const BASE = 'http://127.0.0.1:5199'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT_DIR = path.resolve(
  'C:\\Users\\慈海客服\\Desktop\\demo\\Develop_Helper\\Projects_Repo\\Customer_Service\\.sdd\\test-reports',
)
const CDP_PORT = 9383
const MD_NAME = 't011-helix-vpn.md'
const TXT_NAME = 't011-office-wifi.txt'
const PROBE_NAME = 't011-ingest-probe.md'
const EMPTY_FILTER_TEXT = '当前没有该状态的文档'
const FAQ_QUESTION = 'T011HELIX 重置 VPN 密码的要点是什么'
const FAQ_ANSWER = 'T011HELIX-FAQ-NEW 先在账号中心完成手机验证，再重新导入公司 VPN 配置文件。'
const PROBE_MD = `# T011INGESTPROBE

T011INGESTPROBE 这篇文档仍在入库中时不能被提问命中，也不能改标签。
${'丙'.repeat(200)}
`

const readyDocs = JSON.parse(await readFile(path.join(OUT_DIR, 't011-ready-docs.json'), 'utf8'))
const mdDoc = readyDocs.find((d) => d.filename === MD_NAME)
const txtDoc = readyDocs.find((d) => d.filename === TXT_NAME)
const mdFaq = mdDoc?.faqs?.[0]

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
    emptyText: document.querySelector('.kb-empty')?.textContent?.trim() ?? '',
    uploadError: document.querySelector('.kb-upload [role="alert"]')?.textContent?.trim() ?? '',
    filterPressedValue: filterBtns.find((b) => b.pressed)?.value ?? null,
    uploadEnabled: Boolean(fileInput) && !fileInput.disabled && Boolean(uploadBtn) && !uploadBtn.disabled,
    detailText: (detail?.innerText || '').replace(/\\s+/g, ' ').trim(),
    hasChunks: document.querySelectorAll('.kb-chunk').length,
    hasEditForm: Boolean(document.querySelector('.kb-edit')),
    tagsHint: [...document.querySelectorAll('.kb-edit .hint')].map((el) => el.textContent.trim()),
    faqQuestions: [...document.querySelectorAll('.kb-faq input')].map((el) => el.value),
    faqAnswers: [...document.querySelectorAll('.kb-faq textarea')].map((el) => el.value),
    saveMessage: [...document.querySelectorAll('.kb-edit .hint')].find((el) => (el.textContent || '').includes('已保存'))?.textContent ?? '',
    objectChecked: [...document.querySelectorAll('.kb-fieldset')]
      .filter((fs) => (fs.querySelector('legend')?.textContent || '').includes('对象标签'))
      .flatMap((fs) => [...fs.querySelectorAll('.kb-check')].filter((l) => l.querySelector('input')?.checked).map((l) => l.textContent.trim())),
  };
})()`

const collectChat = `(() => {
  const msgs = [...document.querySelectorAll('.chat-msg')].map((n) => ({
    side: n.classList.contains('employee') ? 'employee' : 'other',
    tag: n.querySelector('.chat-msg-tag')?.textContent ?? null,
    text: n.querySelector('.chat-bubble')?.textContent ?? '',
  }));
  const ta = document.querySelector('.employee-composer textarea');
  const btn = document.querySelector('.employee-composer button[type="submit"]');
  return {
    pathname: location.pathname,
    conversationId: sessionStorage.getItem('conversation_id'),
    statusText: document.querySelector('.employee-status-text')?.textContent ?? null,
    errorText: document.querySelector('.employee-composer-error')?.textContent ?? '',
    loading: (document.body.innerText || '').includes('正在加载会话'),
    messageCount: msgs.length,
    messages: msgs.map((m) => ({ ...m, text: (m.text || '').slice(0, 280) })),
    lastOther: msgs.filter((m) => m.side === 'other').at(-1) ?? null,
    lastEmployee: msgs.filter((m) => m.side === 'employee').at(-1) ?? null,
    pageHasMock: (document.body.innerText || '').includes('[Mock]'),
    taDisabled: ta ? ta.disabled : null,
    btnDisabled: btn ? btn.disabled : null,
    draft: ta ? ta.value : null,
  };
})()`

function noteNetwork(msg) {
  if (msg.method === 'Network.responseReceived') {
    const res = msg.params?.response
    const url = String(res?.url || '')
    if (!/\/api\//.test(url)) return
    networkLog.push({ kind: 'response', status: res.status, url: url.split('?')[0], ts: Date.now() })
  }
}

async function clickNav(label) {
  await evaluate(`(() => {
    const a = [...document.querySelectorAll('.sidebar a')].find((el) => el.textContent.trim() === ${JSON.stringify(label)});
    if (!a) throw new Error('missing nav ' + ${JSON.stringify(label)});
    a.click();
  })()`)
}

async function clickFilter(label) {
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('.kb-filter-btn')].find((el) => el.textContent.trim() === ${JSON.stringify(label)});
    if (!btn) throw new Error('missing filter ' + ${JSON.stringify(label)});
    btn.click();
  })()`)
}

async function clickRowIncludes(name) {
  await evaluate(`(() => {
    const row = [...document.querySelectorAll('.kb-row')].find((el) => (el.querySelector('.kb-row-title')?.textContent || '').includes(${JSON.stringify(name)}));
    if (!row) throw new Error('missing row ' + ${JSON.stringify(name)});
    row.click();
  })()`)
}

async function apiFetch(pathname, options = {}) {
  return evaluate(
    `(async () => {
      const token = localStorage.getItem('access_token');
      const res = await fetch(${JSON.stringify(pathname)}, {
        method: ${JSON.stringify(options.method || 'GET')},
        headers: Object.assign({ Authorization: 'Bearer ' + token }, ${options.body ? `{ 'Content-Type': 'application/json' }` : `{}`}),
        ${options.body ? `body: ${JSON.stringify(JSON.stringify(options.body))},` : ''}
      });
      let body = null;
      try { body = await res.json(); } catch {}
      return { status: res.status, body };
    })()`,
    options.timeoutMs || 20000,
  )
}

async function waitFilterSynced(label, apiStatus) {
  await clickFilter(label)
  const start = Date.now()
  let last = null
  while (Date.now() - start < 10000) {
    const kb = await evaluate(collectKb)
    const path = apiStatus
      ? `/api/documents?page=1&page_size=20&ingest_status=${apiStatus}`
      : '/api/documents?page=1&page_size=20'
    const api = await apiFetch(path)
    const items = api.body?.data || []
    const expectedValue = apiStatus || 'all'
    const statusZh = apiStatus === 'ingesting' ? '入库中' : apiStatus === 'ready' ? '已完成' : apiStatus === 'failed' ? '请重新上传' : null
    const countMatch = kb.rowCount === items.length
    const statusMatch = !statusZh || kb.statuses.every((s) => s === statusZh)
    const emptyOk = items.length > 0 || kb.emptyText.includes(EMPTY_FILTER_TEXT) || (apiStatus == null && kb.rowCount === items.length)
    last = { kb, apiCount: items.length, apiStatuses: items.map((d) => d.ingest_status) }
    if (kb.filterPressedValue === expectedValue && countMatch && statusMatch && emptyOk) return last
    await delay(250)
  }
  return last
}

async function setInputFile(name, content, mime = 'text/markdown') {
  return evaluate(`(() => {
    const input = document.querySelector('#kb-file');
    const file = new File([${JSON.stringify(content)}], ${JSON.stringify(name)}, { type: ${JSON.stringify(mime)} });
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return input.files[0] ? { name: input.files[0].name, size: input.files[0].size } : null;
  })()`)
}

async function gotoEmployeeReady() {
  await clickNav('员工端')
  await waitFor(`location.pathname === '/employee'`, 8000)
  await waitFor(
    `document.querySelector('.employee-composer textarea') && !document.querySelector('.employee-composer textarea').disabled`,
    15000,
  )
}

async function sendChat(text, timeoutMs = 90000) {
  await waitFor(
    `document.querySelector('.employee-composer textarea') && !document.querySelector('.employee-composer textarea').disabled`,
    15000,
  )
  await evaluate(`document.querySelector('.employee-composer textarea').focus()`)
  await evaluate(`(() => {
    const el = document.querySelector('.employee-composer textarea');
    const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    desc.set.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await send('Input.insertText', { text })
  await waitFor(
    `(document.querySelector('.employee-composer textarea')?.value || '').length >= ${Math.min(text.length, 8)}`,
    5000,
  )
  await waitFor(
    `document.querySelector('.employee-composer button[type="submit"]') && !document.querySelector('.employee-composer button[type="submit"]').disabled`,
    5000,
  )
  const before = await evaluate(collectChat)
  await evaluate(`document.querySelector('.employee-composer').requestSubmit()`)
  const start = Date.now()
  let last = before
  while (Date.now() - start < timeoutMs) {
    last = await evaluate(collectChat)
    if (last.errorText) return last
    const employeeSent = (last.lastEmployee?.text || '').includes(text.slice(0, 16))
    const otherArrived = last.messageCount > before.messageCount && last.lastOther && !last.taDisabled
    if (employeeSent && otherArrived && last.lastOther.text) return last
    await delay(400)
  }
  return { ...last, timeout: true }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const evidence = { phase: 2, cdpPort: CDP_PORT, mock: false, steps: {} }
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

  async function goto(url) {
    const nav = send('Page.navigate', { url })
    await Promise.race([send('Page.loadEventFired').catch(() => null), delay(3000)])
    await nav
  }

  await goto(`${BASE}/login`)
  await waitFor(`document.querySelector('#user')`, 8000)
  await evaluate(`(() => {
    const set = (sel, val, proto) => {
      const el = document.querySelector(sel);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      desc.set.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('#user', 'it-help', HTMLInputElement.prototype);
    set('#pass', 'it-help123', HTMLInputElement.prototype);
    document.querySelector('button[type="submit"]').click();
  })()`)
  await waitFor(`document.querySelector('.app')`, 10000)
  await clickNav('知识库')
  await waitFor(`location.pathname === '/knowledge' && document.querySelector('.kb-page')`, 8000)
  await waitFor(`document.querySelectorAll('.kb-row').length >= 1`, 8000)
  const mockFlag = await evaluate(`import('/src/utils/mockFlag.ts').then((m) => m.isMockEnabled())`)
  record('p2-mock-off', mockFlag === false, false, mockFlag)

  const filterAll = await waitFilterSynced('全部', null)
  evidence.filterAll = { count: filterAll.kb.rowCount, statuses: filterAll.kb.statuses, apiCount: filterAll.apiCount, screenshot: await screenshot('t011-p2-filter-all.png') }
  record(
    'ac028-filter-all-synced',
    filterAll.kb.filterPressedValue === 'all' && filterAll.kb.rowCount === filterAll.apiCount && filterAll.kb.pageHasMock === false,
    { uiEqualsApi: true },
    { ui: filterAll.kb.rowCount, api: filterAll.apiCount, statuses: filterAll.kb.statuses },
  )

  const filterReady = await waitFilterSynced('已完成', 'ready')
  evidence.filterReady = { count: filterReady.kb.rowCount, statuses: filterReady.kb.statuses, apiCount: filterReady.apiCount, screenshot: await screenshot('t011-p2-filter-ready.png') }
  record(
    'ac028-filter-ready-synced',
    filterReady.kb.statuses.every((s) => s === '已完成') && filterReady.kb.rowCount === filterReady.apiCount,
    'all 已完成',
    { ui: filterReady.kb.statuses, api: filterReady.apiStatuses },
  )

  const filterIngesting = await waitFilterSynced('入库中', 'ingesting')
  evidence.filterIngesting = { count: filterIngesting.kb.rowCount, statuses: filterIngesting.kb.statuses, empty: filterIngesting.kb.emptyText, apiCount: filterIngesting.apiCount, screenshot: await screenshot('t011-p2-filter-ingesting.png') }
  record(
    'ac028-filter-ingesting-synced',
    filterIngesting.apiCount === filterIngesting.kb.rowCount &&
      (filterIngesting.apiCount === 0
        ? filterIngesting.kb.emptyText.includes(EMPTY_FILTER_TEXT) && filterIngesting.kb.uploadEnabled
        : filterIngesting.kb.statuses.every((s) => s === '入库中')),
    'UI matches API ingesting',
    { uiCount: filterIngesting.kb.rowCount, apiCount: filterIngesting.apiCount, empty: filterIngesting.kb.emptyText, statuses: filterIngesting.kb.statuses },
  )

  const filterFailed = await waitFilterSynced('请重新上传', 'failed')
  evidence.filterFailed = { count: filterFailed.kb.rowCount, empty: filterFailed.kb.emptyText, apiCount: filterFailed.apiCount }
  record(
    'ac028-filter-failed-synced',
    filterFailed.apiCount === filterFailed.kb.rowCount &&
      (filterFailed.apiCount === 0
        ? filterFailed.kb.emptyText.includes(EMPTY_FILTER_TEXT) && filterFailed.kb.uploadEnabled
        : filterFailed.kb.statuses.every((s) => s === '请重新上传')),
    'UI matches API failed',
    { uiCount: filterFailed.kb.rowCount, apiCount: filterFailed.apiCount, empty: filterFailed.kb.emptyText },
  )

  await clickFilter('已完成')
  await waitFor(`[...document.querySelectorAll('.kb-filter-btn')].some((el) => el.getAttribute('data-filter')==='ready' && el.getAttribute('aria-pressed')==='true')`, 4000)
  await setInputFile(PROBE_NAME, PROBE_MD)
  await evaluate(`document.querySelector('.kb-upload button[type="submit"]').click()`)
  await waitFor(
    `[...document.querySelectorAll('.kb-filter-btn')].some((el) => el.getAttribute('data-filter')==='all' && el.getAttribute('aria-pressed')==='true')`,
    8000,
  )
  await waitFor(`[...document.querySelectorAll('.kb-row-title')].some((el) => el.textContent.includes(${JSON.stringify(PROBE_NAME)}))`, 8000)
  const afterProbe = await evaluate(collectKb)
  evidence.probeUpload = { first: afterProbe.filenames[0], status: afterProbe.statuses[0], filter: afterProbe.filterPressedValue, screenshot: await screenshot('t011-p2-probe-ingesting.png') }
  record(
    'ac023-upload-ingesting',
    afterProbe.filterPressedValue === 'all' && afterProbe.filenames[0] === PROBE_NAME && afterProbe.statuses[0] === '入库中' && afterProbe.hasChunks === 0 && afterProbe.hasEditForm === false,
    { status: '入库中', noPreview: true },
    { first: afterProbe.filenames[0], status: afterProbe.statuses[0], chunks: afterProbe.hasChunks, edit: afterProbe.hasEditForm, detail: afterProbe.detailText.slice(0, 80) },
  )

  await gotoEmployeeReady()
  const probeAsk = await sendChat('T011INGESTPROBE 这篇文档里写了什么步骤')
  evidence.probeAsk = probeAsk
  const probeHit =
    /知识问答|FAQ/.test(String(probeAsk.lastOther?.tag || '')) && /T011INGESTPROBE/.test(String(probeAsk.lastOther?.text || ''))
  record(
    'ac023-ask-not-hit-ingesting',
    probeAsk.timeout !== true && probeAsk.pageHasMock === false && !probeHit,
    { notHitIngestingDoc: true },
    { tag: probeAsk.lastOther?.tag, text: probeAsk.lastOther?.text, timeout: probeAsk.timeout, error: probeAsk.errorText },
  )

  await clickNav('知识库')
  await waitFor(`location.pathname === '/knowledge' && document.querySelector('.kb-page')`, 8000)
  await waitFor(`[...document.querySelectorAll('.kb-row-title')].some((el) => el.textContent.includes(${JSON.stringify(PROBE_NAME)}))`, 10000)
  const backProbe = await evaluate(collectKb)
  evidence.backProbe = { filenames: backProbe.filenames.slice(0, 5), statuses: backProbe.statuses.slice(0, 5), screenshot: await screenshot('t011-p2-probe-back.png') }
  const probeRow = backProbe.rows.find((r) => r.filename === PROBE_NAME)
  record(
    'ac023-still-listed-after-leave',
    Boolean(probeRow) && (probeRow.status === '入库中' || probeRow.status === '已完成'),
    { listed: true },
    probeRow,
  )
  if (probeRow?.status === '入库中') {
    await clickRowIncludes(PROBE_NAME)
    const stillIngesting = await evaluate(collectKb)
    record(
      'ac023-still-no-edit',
      stillIngesting.hasChunks === 0 && stillIngesting.hasEditForm === false && stillIngesting.detailText.includes('正在入库中'),
      { noPreview: true },
      { chunks: stillIngesting.hasChunks, edit: stillIngesting.hasEditForm, detail: stillIngesting.detailText.slice(0, 80) },
    )
  }

  await clickFilter('全部')
  await waitFor(`[...document.querySelectorAll('.kb-row-title')].some((el) => el.textContent.includes(${JSON.stringify(MD_NAME)}))`, 8000)
  await clickRowIncludes(MD_NAME)
  await waitFor(`document.querySelector('.kb-edit')`, 10000)
  const mdOpen = await evaluate(collectKb)
  evidence.mdOpen = { tags: mdOpen.objectChecked, faqs: mdOpen.faqQuestions, screenshot: await screenshot('t011-p2-md-open.png') }
  record('ac017-tags-still-hardware', mdOpen.objectChecked.some((n) => n.includes('硬件')), '硬件设备', mdOpen.objectChecked)

  await gotoEmployeeReady()
  const extractedFaqAsk = await sendChat(mdFaq.question)
  evidence.extractedFaqAsk = extractedFaqAsk
  const faqHit =
    /FAQ/.test(String(extractedFaqAsk.lastOther?.tag || '')) &&
    String(extractedFaqAsk.lastOther?.text || '').includes('账号中心')
  record(
    'ac003-md-faq-intercept',
    extractedFaqAsk.timeout !== true && faqHit,
    { tag: 'FAQ', has账号中心: true },
    { tag: extractedFaqAsk.lastOther?.tag, text: extractedFaqAsk.lastOther?.text, timeout: extractedFaqAsk.timeout, error: extractedFaqAsk.errorText },
  )

  const hardwareAsk = await sendChat('T011HELIX-FAIL 认证失败是不是网卡硬件坏了，该怎么处理')
  evidence.hardwareAsk = hardwareAsk
  record(
    'ac017-new-tag-question',
    hardwareAsk.timeout !== true && Boolean(hardwareAsk.lastOther?.tag),
    { answered: true },
    { tag: hardwareAsk.lastOther?.tag, text: hardwareAsk.lastOther?.text, timeout: hardwareAsk.timeout },
  )

  const txtAsk = await sendChat('T011WIFI 办公网忘记之后还要不要避开微波炉再重连，请按知识说明，不要只复述 FAQ 标题')
  evidence.txtAsk = txtAsk
  const txtKnowledge =
    /知识问答/.test(String(txtAsk.lastOther?.tag || '')) && /T011WIFI|办公|无线|微波/.test(String(txtAsk.lastOther?.text || ''))
  record(
    'ac003-txt-tag-retrieval',
    txtAsk.timeout !== true && (txtKnowledge || /知识问答/.test(String(txtAsk.lastOther?.tag || ''))),
    { tag: '知识问答' },
    { tag: txtAsk.lastOther?.tag, text: txtAsk.lastOther?.text, timeout: txtAsk.timeout },
  )

  await clickNav('知识库')
  await waitFor(`document.querySelector('.kb-page')`, 8000)
  await clickFilter('全部')
  await waitFor(`[...document.querySelectorAll('.kb-row-title')].some((el) => el.textContent.includes(${JSON.stringify(MD_NAME)}))`, 8000)
  await clickRowIncludes(MD_NAME)
  await waitFor(`document.querySelector('.kb-edit')`, 10000)
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
    return { q: q.value, n: document.querySelectorAll('.kb-faq').length };
  })()`)
  await evaluate(`document.querySelector('.kb-edit button[type="submit"]').click()`)
  await waitFor(`(document.body.innerText || '').includes('已保存，将立即用于后续提问')`, 20000)
  const afterFaq = await evaluate(collectKb)
  const mdAfter = await apiFetch(`/api/documents/${mdDoc.id}`)
  evidence.faqSave = { questions: afterFaq.faqQuestions, apiFaqs: (mdAfter.body?.data?.faqs || []).map((f) => f.question), screenshot: await screenshot('t011-p2-faq-saved.png') }
  record(
    'ac018-page-shows-new-faq',
    afterFaq.faqQuestions.some((q) => q.includes('T011HELIX 重置 VPN')) &&
      afterFaq.faqAnswers.some((a) => a.includes('T011HELIX-FAQ-NEW')),
    FAQ_QUESTION,
    { questions: afterFaq.faqQuestions, answers: afterFaq.faqAnswers },
  )

  await gotoEmployeeReady()
  const newFaqAsk = await sendChat(FAQ_QUESTION)
  evidence.newFaqAsk = newFaqAsk
  record(
    'ac018-new-faq-hit',
    /FAQ/.test(String(newFaqAsk.lastOther?.tag || '')) && /T011HELIX-FAQ-NEW/.test(String(newFaqAsk.lastOther?.text || '')),
    { tag: 'FAQ', token: 'T011HELIX-FAQ-NEW' },
    { tag: newFaqAsk.lastOther?.tag, text: newFaqAsk.lastOther?.text, timeout: newFaqAsk.timeout },
  )
  const oldFaqAsk = await sendChat(mdFaq.question)
  evidence.oldFaqAsk = oldFaqAsk
  record(
    'ac018-old-faq-not-hit',
    oldFaqAsk.timeout !== true &&
      !(/FAQ/.test(String(oldFaqAsk.lastOther?.tag || '')) && String(oldFaqAsk.lastOther?.text || '').includes('等待一分钟')),
    { notOldFaqAnswer: true },
    { tag: oldFaqAsk.lastOther?.tag, text: oldFaqAsk.lastOther?.text, timeout: oldFaqAsk.timeout },
  )

  const mdKnowledge = await sendChat('T011HELIX-RESET 重置密码并完成手机验证之后，怎样重新导入公司 VPN 配置文件？这不是 FAQ 那句原问')
  evidence.mdKnowledge = mdKnowledge
  record(
    'ac003-md-knowledge-retrieval',
    mdKnowledge.timeout !== true &&
      (/知识问答/.test(String(mdKnowledge.lastOther?.tag || '')) || /T011HELIX|VPN|导入/.test(String(mdKnowledge.lastOther?.text || ''))),
    { knowledgeOrDocToken: true },
    { tag: mdKnowledge.lastOther?.tag, text: mdKnowledge.lastOther?.text, timeout: mdKnowledge.timeout },
  )

  evidence.network = networkLog.slice(-40)
  evidence.checks = checks
  evidence.failed = checks.filter((c) => !c.pass).map((c) => c.id)
  await writeFile(path.join(OUT_DIR, 't011-browser-phase2.json'), JSON.stringify(evidence, null, 2))
  console.log(`failed=${JSON.stringify(evidence.failed)}`)
  if (evidence.failed.length) process.exitCode = 1
}

main()
  .catch(async (err) => {
    console.error(err)
    try {
      await writeFile(
        path.join(OUT_DIR, 't011-browser-phase2.json'),
        JSON.stringify({ error: String(err), checks, failed: checks.filter((c) => !c.pass).map((c) => c.id) }, null, 2),
      )
    } catch {
      // ignore
    }
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
