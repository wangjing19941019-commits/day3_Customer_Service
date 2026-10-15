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
const CDP_PORT = 9357
const HINT_EXACT = '支持 Markdown、TXT，以及能抽出文字的 PDF'
const ACCEPT_EXACT = '.md,.txt,.pdf,text/markdown,text/plain,application/pdf'
const STRATEGY_NEEDLES = ['先转为 Markdown', '800', '重叠 160 字', '上限的 20%']
const EMPTY_FILTER_TEXT = '当前没有该状态的文档'
const EMPTY_ALL_TEXT = '还没有知识文档。请上传 Markdown、TXT 或能抽出文字的 PDF。'
const LONG_TXT = Array.from(
  { length: 14 },
  (_, i) =>
    `段落${i + 1}：办公区无线网络无法连接时，先确认电脑连的是公司办公网络，而不是访客网络或手机热点。关闭飞行模式后在系统设置里忘记该网络，再重新输入 IT 发放的密码。若仍失败，重启无线网卡并避开微波干扰，不要反复输错密码。`,
).join('\n\n')
const PDF_BODY = 'Office printer reset steps. Confirm the device is on the company network and powered on. '.repeat(22)
const PDF_RAW_FAKE = '# Fake Heading from raw bytes\n'

let chromeProc
let ws
let sessionId
let msgId = 0
const pending = new Map()
const checks = []

function record(id, pass, expected, actual, extra = {}) {
  checks.push({ id, pass: Boolean(pass), expected, actual, ...extra })
  if (!pass) {
    console.error(`FAIL ${id}: expected ${JSON.stringify(expected)} actual ${JSON.stringify(actual)}`)
  } else {
    console.log(`PASS ${id}`)
  }
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

function makePdf({ bodyText = '', extraRaw = '' }) {
  const escaped = String(bodyText)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
  const stream = bodyText
    ? `BT\n/F1 12 Tf\n72 720 Td\n(${escaped}) Tj\nET\n`
    : `BT\n/F1 12 Tf\n72 720 Td\nET\n`
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ]
  return `%PDF-1.4\n${extraRaw}${objects.join('')}\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`
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
  const upload = document.querySelector('.kb-upload');
  const fileInput = document.querySelector('#kb-file');
  const uploadBtn = document.querySelector('.kb-upload button[type="submit"]');
  const filterBar = document.querySelector('.kb-filter');
  const list = document.querySelector('.kb-list');
  const listScroll = document.querySelector('.kb-list-scroll');
  return {
    pathname: location.pathname,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    pageHasMock: (document.body.innerText || '').includes('[Mock]'),
    rows,
    rowCount: rows.length,
    filenames: rows.map((r) => r.filename),
    statuses: rows.map((r) => r.status),
    emptyText: document.querySelector('.kb-empty')?.textContent?.trim() ?? '',
    uploadError: document.querySelector('.kb-upload [role="alert"]')?.textContent?.trim() ?? '',
    uploadHint: document.querySelector('.kb-upload-hint')?.textContent?.trim() ?? '',
    accept: fileInput?.getAttribute('accept') ?? '',
    filterPressedValue: filterBtns.find((b) => b.pressed)?.value ?? null,
    filterLabels: filterBtns.map((b) => b.label),
    filterBtns,
    layout: {
      uploadHeight: upload ? Math.round(upload.getBoundingClientRect().height) : null,
      listWidth: list ? Math.round(list.getBoundingClientRect().width) : null,
      filterTop: filterBar ? Math.round(filterBar.getBoundingClientRect().top) : null,
      listScrollTop: listScroll ? Math.round(listScroll.getBoundingClientRect().top) : null,
      filterInList: Boolean(list?.querySelector(':scope > .kb-filter')),
      filterInUpload: Boolean(document.querySelector('.kb-upload .kb-filter, .kb-upload [data-filter]')),
      fileDisabled: fileInput ? fileInput.disabled : null,
      uploadDisabled: uploadBtn ? uploadBtn.disabled : null,
    },
    storeKeyV4: sessionStorage.getItem('customer_service_mock_documents_v4') != null,
    storeKeyLegacy: sessionStorage.getItem('customer_service_mock_documents_v3') != null,
  };
})()`

const collectDetail = `(() => {
  const chunks = [...document.querySelectorAll('.kb-chunk')].map((el) => {
    const meta = el.querySelector('.kb-chunk-meta')?.textContent?.trim() ?? '';
    const bodyRaw = el.querySelector('.kb-chunk-body')?.innerText ?? '';
    const body = bodyRaw.replace(/^\\[Mock\\]\\s*/, '');
    return {
      meta,
      headingInMeta: meta.includes(' · '),
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
    hasOnlyMarkdown: /仅 Markdown|仅支持 Markdown/.test(text),
    has800: /800/.test(text),
    has160: /重叠 160 字/.test(text),
    hasConvert: /先转为 Markdown/.test(text),
    hasPercent: /20%/.test(text),
  };
})()`

const collectShell = `(() => {
  const nav = [...document.querySelectorAll('.sidebar a')].map((a) => ({
    text: a.textContent.trim(),
    ariaCurrent: a.getAttribute('aria-current'),
    active: a.classList.contains('active') || a.getAttribute('aria-current') === 'page',
  }));
  return {
    pathname: location.pathname,
    title: document.querySelector('.page-name')?.textContent ?? null,
    topbarUser: document.querySelector('.session .user')?.textContent ?? null,
    logoutText: document.querySelector('.session button')?.textContent?.trim() ?? null,
    activeNav: nav.filter((n) => n.active).map((n) => n.text),
    activeCount: nav.filter((n) => n.active).length,
    pageHasMock: (document.body.innerText || '').includes('[Mock]'),
  };
})()`

const collectLogin = `(() => ({
  pathname: location.pathname,
  hasLoggedOutHint: (document.body.innerText || '').includes('当前未登录'),
  tokenPresent: Boolean(localStorage.getItem('access_token') || localStorage.getItem('token')),
  pageHasMock: (document.body.innerText || '').includes('[Mock]'),
}))()`

const collectChat = `(() => {
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
    lastOther: msgs.filter((m) => m.side === 'other').at(-1) ?? null,
    systemTags: msgs.filter((m) => m.side === 'other').map((m) => m.tag),
    pageHasMock: (document.body.innerText || '').includes('[Mock]'),
  };
})()`

const collectAgent = `(() => ({
  pathname: location.pathname,
  emptyText: [...document.querySelectorAll('.agent-empty')].map((el) => el.textContent.trim()),
  rowCount: document.querySelectorAll('.agent-row, .inbox-row').length,
  pageHasMock: (document.body.innerText || '').includes('[Mock]'),
}))()`

function overlapOk(chunks, overlap = 160) {
  if (!chunks || chunks.length < 2) return { ok: false, reason: 'need 2+ chunks', count: chunks?.length ?? 0 }
  const a = chunks[0].body || chunks[0].content || ''
  const b = chunks[1].body || chunks[1].content || ''
  const needle = a.slice(-overlap)
  return {
    ok: Boolean(needle) && b.startsWith(needle),
    overlap,
    aLen: a.length,
    bLen: b.length,
    count: chunks.length,
  }
}

function displayedName(filename) {
  return `[Mock] ${filename}`
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
    4000,
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

async function setViewport(width, height) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  })
}

async function login() {
  await waitFor(`document.querySelector('.login-card') || document.querySelector('#user')`, 8000)
  await evaluate(fillScript('#user', 'it-help'))
  await evaluate(fillScript('#pass', 'it-help123'))
  await evaluate(`document.querySelector('button[type="submit"]').click()`)
  await waitFor(`document.querySelector('.app') && location.pathname === '/employee'`, 8000)
}

async function logoutAndExpectLogin() {
  await evaluate(`document.querySelector('.session button').click()`)
  await waitFor(`location.pathname === '/login'`, 8000)
  return evaluate(collectLogin)
}

async function sendChat(text) {
  await evaluate(fillScript('.employee-composer textarea', text))
  await evaluate(`document.querySelector('.employee-composer button[type="submit"]').click()`)
  await waitFor(
    `document.querySelector('.employee-composer textarea') && !document.querySelector('.employee-composer textarea').disabled`,
    8000,
  )
  await delay(200)
  return evaluate(collectChat)
}

function encoderLatin1(str) {
  return Uint8Array.from(Buffer.from(str, 'latin1'))
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const userData = await mkdtemp(path.join(os.tmpdir(), 't017-chrome-'))
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

  const evidence = {
    mock: true,
    viewport: '1440x900',
    cdpPort: CDP_PORT,
    url: BASE,
    userDataDir: userData,
    longTxtLen: LONG_TXT.length,
    pdfBodyLen: PDF_BODY.length,
    steps: [],
  }

  const vite = await fetch(BASE)
  evidence.viteStatus = vite.status
  record('env-vite', vite.status === 200, 200, vite.status)

  await goto(`${BASE}/login`)
  await login()
  await clickNav('知识库')
  await waitFor(`location.pathname === '/knowledge'`)
  await send('Page.reload', { ignoreCache: true })
  await Promise.race([send('Page.loadEventFired').catch(() => null), delay(5000)])
  await waitFor(`location.pathname === '/knowledge' && document.querySelector('.kb-page')`, 8000)
  await waitFor(`document.querySelectorAll('.kb-row').length >= 3`, 8000)

  const baseline = await evaluate(collectKb)
  evidence.baseline = { ...baseline, screenshot: await screenshot('t017-baseline-all.png') }
  record(
    'tc01-hint',
    baseline.uploadHint === `[Mock] ${HINT_EXACT}` && !/仅支持 Markdown/.test(baseline.uploadHint),
    `[Mock] ${HINT_EXACT}`,
    baseline.uploadHint,
  )
  record('tc01-accept', baseline.accept === ACCEPT_EXACT, ACCEPT_EXACT, baseline.accept)
  record('tc01-viewport', baseline.viewport?.w === 1440 && baseline.viewport?.h === 900, { w: 1440, h: 900 }, baseline.viewport)
  record(
    'tc01-seed-names',
    baseline.filenames.some((n) => n.includes('wifi-reset.txt')) &&
      baseline.filenames.some((n) => n.includes('scan-only.pdf')) &&
      baseline.filenames.some((n) => n.includes('vpn-faq.md')) &&
      !baseline.filenames.some((n) => n.includes('wifi-reset.md')),
    ['wifi-reset.txt', 'scan-only.pdf', 'vpn-faq.md'],
    baseline.filenames,
  )
  record(
    'tc01-layout',
    baseline.layout.filterInList === true &&
      baseline.layout.filterInUpload === false &&
      baseline.layout.listWidth === 320 &&
      baseline.layout.filterTop < baseline.layout.listScrollTop,
    { filterInList: true, filterInUpload: false, listWidth: 320 },
    baseline.layout,
  )
  record('tc01-store-v4', baseline.storeKeyV4 === true, true, baseline.storeKeyV4)

  await clickRowIncludes('wifi-reset.txt')
  await waitFor(`document.querySelectorAll('.kb-chunk').length > 0`, 5000)
  const wifiDetail = await evaluate(collectDetail)
  evidence.wifiDetail = { ...wifiDetail, screenshot: await screenshot('t017-wifi-detail.png') }
  const wifiOverlap = overlapOk(wifiDetail.chunks, 160)
  record(
    'tc03-strategy',
    STRATEGY_NEEDLES.every((n) => wifiDetail.strategyText.includes(n)) &&
      wifiDetail.hasConvert &&
      wifiDetail.has160 &&
      wifiDetail.has800 &&
      !wifiDetail.hasOverlap80 &&
      !wifiDetail.hasOnlyMarkdown,
    STRATEGY_NEEDLES,
    {
      strategyText: wifiDetail.strategyText,
      hasOverlap80: wifiDetail.hasOverlap80,
      hasOnlyMarkdown: wifiDetail.hasOnlyMarkdown,
    },
  )
  record(
    'tc03-wifi-heading-empty',
    wifiDetail.chunkCount > 1 && wifiDetail.chunks.every((c) => c.headingInMeta === false),
    { chunkCount: '>1', headingInMeta: false },
    { chunkCount: wifiDetail.chunkCount, headingMetas: wifiDetail.headingMetas },
  )
  record('tc03-wifi-overlap160', wifiOverlap.ok, true, wifiOverlap)
  record('tc03-readonly', wifiDetail.hasEditForm && !wifiDetail.hasSaveChunk && wifiDetail.chunks.every((c) => !c.hasInput), true, {
    hasEditForm: wifiDetail.hasEditForm,
    hasSaveChunk: wifiDetail.hasSaveChunk,
  })

  await clickRowIncludes('vpn-faq.md')
  await waitFor(`document.querySelectorAll('.kb-chunk').length > 0`, 5000)
  const vpnDetail = await evaluate(collectDetail)
  evidence.vpnDetail = vpnDetail
  record(
    'tc03-vpn-has-heading',
    vpnDetail.chunks.some((c) => c.headingInMeta),
    true,
    vpnDetail.headingMetas,
  )

  const beforeReject = await evaluate(collectKb)
  await setInputFile('notes.docx', 'not-a-document', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  await clickUpload()
  await waitFor(`(document.querySelector('.kb-upload [role="alert"]')?.textContent || '').includes('请重新上传')`, 5000)
  const afterDocx = await evaluate(collectKb)
  evidence.rejectDocx = { before: beforeReject.rowCount, after: afterDocx, screenshot: await screenshot('t017-reject-docx.png') }
  record(
    'tc02-reject-ext',
    afterDocx.uploadError.includes('请重新上传') &&
      afterDocx.rowCount === beforeReject.rowCount &&
      !afterDocx.filenames.some((n) => n.includes('notes.docx')),
    { noNewRow: true, error: '请重新上传' },
    { rowCount: afterDocx.rowCount, uploadError: afterDocx.uploadError, filenames: afterDocx.filenames },
  )

  await setInputFile('empty.txt', '', 'text/plain')
  await clickUpload()
  await waitFor(`(document.querySelector('.kb-upload [role="alert"]')?.textContent || '').includes('请重新上传')`, 5000)
  const afterEmpty = await evaluate(collectKb)
  evidence.rejectEmpty = { rowCount: afterEmpty.rowCount, uploadError: afterEmpty.uploadError }
  record(
    'tc02-reject-empty',
    afterEmpty.uploadError.includes('请重新上传') &&
      afterEmpty.rowCount === beforeReject.rowCount &&
      !afterEmpty.filenames.some((n) => n.includes('empty.txt')),
    { noNewRow: true },
    { rowCount: afterEmpty.rowCount, uploadError: afterEmpty.uploadError },
  )

  const scanCountBefore = afterEmpty.filenames.filter((n) => n.includes('scan-only.pdf')).length
  await setInputFile('scan-only.pdf', makePdf({ bodyText: 'this text should not be accepted by fixture name' }), 'application/pdf')
  await clickUpload()
  await waitFor(`(document.querySelector('.kb-upload [role="alert"]')?.textContent || '').includes('请重新上传')`, 5000)
  const afterScan = await evaluate(collectKb)
  const scanCountAfter = afterScan.filenames.filter((n) => n.includes('scan-only.pdf')).length
  evidence.rejectScan = {
    scanCountBefore,
    scanCountAfter,
    uploadError: afterScan.uploadError,
    screenshot: await screenshot('t017-reject-scan-only.png'),
  }
  record(
    'tc02-reject-scan-fixture',
    afterScan.uploadError.includes('请重新上传') && scanCountAfter === scanCountBefore,
    { scanCountBefore, noNewRow: true },
    { scanCountAfter, uploadError: afterScan.uploadError },
  )

  const emptyPdf = encoderLatin1(makePdf({ bodyText: '', extraRaw: '# Fake Heading from raw bytes\n' }))
  await setInputFile('image-only.pdf', emptyPdf, 'application/pdf')
  await clickUpload()
  await waitFor(`(document.querySelector('.kb-upload [role="alert"]')?.textContent || '').includes('请重新上传')`, 5000)
  const afterImage = await evaluate(collectKb)
  evidence.rejectImagePdf = {
    rowCount: afterImage.rowCount,
    uploadError: afterImage.uploadError,
    hasImageOnly: afterImage.filenames.some((n) => n.includes('image-only.pdf')),
    screenshot: await screenshot('t017-reject-image-pdf.png'),
  }
  record(
    'tc02-reject-no-text-pdf',
    afterImage.uploadError.includes('请重新上传') &&
      afterImage.rowCount === afterScan.rowCount &&
      !afterImage.filenames.some((n) => n.includes('image-only.pdf')),
    { noNewRow: true },
    { rowCount: afterImage.rowCount, uploadError: afterImage.uploadError, filenames: afterImage.filenames },
  )

  await clickFilter('入库中')
  const ingestingOnly = await evaluate(collectKb)
  evidence.filterIngesting = { ...ingestingOnly, screenshot: await screenshot('t017-filter-ingesting.png') }
  record(
    'tc02-filter-ingesting',
    ingestingOnly.rowCount > 0 && ingestingOnly.statuses.every((s) => s === '入库中'),
    'all 入库中',
    ingestingOnly.statuses,
  )

  await clickFilter('已完成')
  const readyOnly = await evaluate(collectKb)
  evidence.filterReady = { ...readyOnly, screenshot: await screenshot('t017-filter-ready.png') }
  record(
    'tc02-filter-ready',
    readyOnly.rowCount > 0 && readyOnly.statuses.every((s) => s === '已完成'),
    'all 已完成',
    readyOnly.statuses,
  )

  await clickFilter('请重新上传')
  const failedOnly = await evaluate(collectKb)
  evidence.filterFailed = { ...failedOnly, screenshot: await screenshot('t017-filter-failed.png') }
  record(
    'tc02-filter-failed',
    failedOnly.rowCount > 0 && failedOnly.statuses.every((s) => s === '请重新上传'),
    'all 请重新上传',
    failedOnly.statuses,
  )

  await setInputFile('from-failed.md', '# From failed filter\n\nSwitch to all after upload.\n', 'text/markdown')
  await clickUpload()
  await waitFor(
    `[...document.querySelectorAll('.kb-filter-btn')].some((el) => el.getAttribute('data-filter')==='all' && el.getAttribute('aria-pressed')==='true')`,
    5000,
  )
  await waitFor(`[...document.querySelectorAll('.kb-row-title')].some((el) => el.textContent.includes('from-failed.md'))`, 5000)
  const fromFailed = await evaluate(collectKb)
  evidence.uploadFromFailed = { ...fromFailed, screenshot: await screenshot('t017-upload-from-failed.png') }
  record(
    'tc02-upload-from-failed-to-all',
    fromFailed.filterPressedValue === 'all' &&
      fromFailed.filenames[0]?.includes('from-failed.md') &&
      fromFailed.statuses[0] === '入库中',
    { filter: 'all', first: 'from-failed.md', status: '入库中' },
    { filter: fromFailed.filterPressedValue, first: fromFailed.filenames[0], status: fromFailed.statuses[0] },
  )

  await clickFilter('已完成')
  await setInputFile('from-ready.md', '# From ready filter\n\nSwitch to all after upload.\n', 'text/markdown')
  await clickUpload()
  await waitFor(
    `[...document.querySelectorAll('.kb-filter-btn')].some((el) => el.getAttribute('data-filter')==='all' && el.getAttribute('aria-pressed')==='true')`,
    5000,
  )
  await waitFor(`[...document.querySelectorAll('.kb-row-title')].some((el) => el.textContent.includes('from-ready.md'))`, 5000)
  const fromReady = await evaluate(collectKb)
  evidence.uploadFromReady = { ...fromReady, screenshot: await screenshot('t017-upload-from-ready.png') }
  record(
    'tc02-upload-from-ready-to-all',
    fromReady.filterPressedValue === 'all' &&
      fromReady.filenames[0]?.includes('from-ready.md') &&
      fromReady.statuses[0] === '入库中',
    { filter: 'all', first: 'from-ready.md', status: '入库中' },
    { filter: fromReady.filterPressedValue, first: fromReady.filenames[0], status: fromReady.statuses[0] },
  )

  const beforeThree = await evaluate(collectKb)
  await setInputFile('office-notes.md', '# Office notes\n\nMarkdown body for T-017.\n', 'text/markdown')
  await clickUpload()
  await waitFor(`[...document.querySelectorAll('.kb-row-title')].some((el) => el.textContent.includes('office-notes.md'))`, 5000)
  const afterMd = await evaluate(collectKb)
  record(
    'tc01-upload-md',
    afterMd.filenames[0]?.includes('office-notes.md') && afterMd.statuses[0] === '入库中' && afterMd.rowCount === beforeThree.rowCount + 1,
    { first: 'office-notes.md', status: '入库中' },
    { first: afterMd.filenames[0], status: afterMd.statuses[0], rowCount: afterMd.rowCount },
  )

  await setInputFile('office-wifi.txt', LONG_TXT, 'text/plain')
  await clickUpload()
  await waitFor(`[...document.querySelectorAll('.kb-row-title')].some((el) => el.textContent.includes('office-wifi.txt'))`, 5000)
  const afterTxt = await evaluate(collectKb)
  evidence.uploadTxt = afterTxt
  record(
    'tc01-upload-txt-original-name',
    afterTxt.filenames[0]?.includes('office-wifi.txt') &&
      !afterTxt.filenames[0]?.includes('office-wifi.md') &&
      afterTxt.statuses[0] === '入库中',
    { first: 'office-wifi.txt', status: '入库中' },
    { first: afterTxt.filenames[0], status: afterTxt.statuses[0] },
  )

  const guidePdf = encoderLatin1(makePdf({ bodyText: PDF_BODY, extraRaw: PDF_RAW_FAKE }))
  await setInputFile('guide.pdf', guidePdf, 'application/pdf')
  await clickUpload()
  await waitFor(`[...document.querySelectorAll('.kb-row-title')].some((el) => el.textContent.includes('guide.pdf'))`, 5000)
  const afterPdf = await evaluate(collectKb)
  evidence.uploadPdf = { ...afterPdf, screenshot: await screenshot('t017-upload-three-types.png') }
  record(
    'tc01-upload-pdf-original-name',
    afterPdf.filenames[0]?.includes('guide.pdf') &&
      !afterPdf.filenames.some((n) => n.includes('guide.md')) &&
      afterPdf.statuses[0] === '入库中',
    { first: 'guide.pdf', status: '入库中' },
    { first: afterPdf.filenames[0], status: afterPdf.statuses[0], filenames: afterPdf.filenames.slice(0, 6) },
  )

  await waitFor(
    `[...document.querySelectorAll('.kb-row')].some((row) => (row.querySelector('.kb-row-title')?.textContent || '').includes('office-wifi.txt') && /已完成/.test(row.innerText))`,
    20000,
  )
  await waitFor(
    `[...document.querySelectorAll('.kb-row')].some((row) => (row.querySelector('.kb-row-title')?.textContent || '').includes('guide.pdf') && /已完成/.test(row.innerText))`,
    20000,
  )

  await clickFilter('全部')
  await clickRowIncludes('office-wifi.txt')
  await waitFor(`document.querySelectorAll('.kb-chunk').length > 0`, 8000)
  const txtDetail = await evaluate(collectDetail)
  evidence.txtReady = { ...txtDetail, screenshot: await screenshot('t017-txt-ready-chunks.png') }
  const txtOverlap = overlapOk(txtDetail.chunks, 160)
  record(
    'tc04-txt-chunks',
    txtDetail.chunkCount > 1 &&
      txtDetail.chunks.every((c) => !c.headingInMeta) &&
      txtOverlap.ok &&
      txtDetail.has160 &&
      !txtDetail.hasOverlap80,
    { chunks: '>1', headingEmpty: true, overlap160: true },
    { chunkCount: txtDetail.chunkCount, headingMetas: txtDetail.headingMetas, overlap: txtOverlap, strategy: txtDetail.strategyText },
  )

  await clickRowIncludes('guide.pdf')
  await waitFor(`document.querySelectorAll('.kb-chunk').length > 0`, 8000)
  const pdfDetail = await evaluate(collectDetail)
  evidence.pdfReady = { ...pdfDetail, screenshot: await screenshot('t017-pdf-ready-chunks.png') }
  const pdfOverlap = overlapOk(pdfDetail.chunks, 160)
  record(
    'tc04-pdf-chunks',
    pdfDetail.chunkCount > 1 &&
      pdfDetail.chunks.every((c) => !c.headingInMeta) &&
      pdfOverlap.ok &&
      !/Fake Heading/.test(pdfDetail.detailText),
    { chunks: '>1', headingEmpty: true, noRawFakeHeading: true },
    { chunkCount: pdfDetail.chunkCount, headingMetas: pdfDetail.headingMetas, overlap: pdfOverlap, detailHasFake: /Fake Heading/.test(pdfDetail.detailText) },
  )

  const ingestAnalysis = await evaluate(`(async () => {
    const mod = await import('/src/mocks/documents.ts?t=' + Date.now());
    const pdfBytes = new Uint8Array(${JSON.stringify([...guidePdf])});
    const extracted = mod.extractPdfText(pdfBytes.buffer);
    const md = mod.convertToMarkdown('guide.pdf', extracted);
    const converted = mod.chunkMarkdown(md);
    const rawAsText = new TextDecoder('latin1').decode(pdfBytes);
    const rawChunks = mod.chunkMarkdown(rawAsText);
    const txtMd = mod.convertToMarkdown('office-wifi.txt', ${JSON.stringify(LONG_TXT)});
    const txtConverted = mod.chunkMarkdown(txtMd);
    const store = JSON.parse(sessionStorage.getItem('customer_service_mock_documents_v4') || '[]');
    const txtDoc = store.find((d) => d.filename === 'office-wifi.txt');
    const pdfDoc = store.find((d) => d.filename === 'guide.pdf');
    const overlap = (chunks) => chunks.length > 1 && chunks[1].content.startsWith(chunks[0].content.slice(-mod.CHUNK_OVERLAP_CHARS));
    return {
      overlapConst: mod.CHUNK_OVERLAP_CHARS,
      maxConst: mod.CHUNK_MAX_CHARS,
      extractedLen: extracted.length,
      mdHasHeading: /^#\\s/m.test(md),
      txtMdHasHeading: /^#\\s/m.test(txtMd),
      convertedPdf: {
        count: converted.length,
        heading_paths: converted.map((c) => c.heading_path),
        overlap160: overlap(converted),
      },
      rawPdf: {
        count: rawChunks.length,
        heading_paths: [...new Set(rawChunks.map((c) => c.heading_path))],
        hasFakeHeading: rawChunks.some((c) => (c.heading_path || '').includes('Fake Heading')),
      },
      convertedTxt: {
        count: txtConverted.length,
        heading_paths: [...new Set(txtConverted.map((c) => c.heading_path))],
        overlap160: overlap(txtConverted),
        firstLen: txtConverted[0]?.content.length ?? 0,
      },
      storedTxt: {
        filename: txtDoc?.filename,
        chunkCount: txtDoc?.chunks?.length ?? 0,
        heading_paths: [...new Set((txtDoc?.chunks || []).map((c) => c.heading_path))],
        matchesConverted: JSON.stringify(txtDoc?.chunks || []) === JSON.stringify(txtConverted),
        sourceLooksRawPdf: /%PDF/.test(txtDoc?.source_text || ''),
      },
      storedPdf: {
        filename: pdfDoc?.filename,
        chunkCount: pdfDoc?.chunks?.length ?? 0,
        heading_paths: [...new Set((pdfDoc?.chunks || []).map((c) => c.heading_path))],
        matchesConverted: JSON.stringify(pdfDoc?.chunks || []) === JSON.stringify(converted),
        sourceLooksRawPdf: /%PDF/.test(pdfDoc?.source_text || ''),
        sourceEqualsExtracted: pdfDoc?.source_text === extracted,
      },
    };
  })()`)
  evidence.ingestAnalysis = ingestAnalysis
  record(
    'tc04-convert-then-chunk',
    ingestAnalysis.overlapConst === 160 &&
      ingestAnalysis.maxConst === 800 &&
      ingestAnalysis.convertedPdf.count > 1 &&
      ingestAnalysis.convertedPdf.heading_paths.every((h) => h === '') &&
      ingestAnalysis.convertedPdf.overlap160 &&
      ingestAnalysis.rawPdf.hasFakeHeading &&
      ingestAnalysis.storedPdf.matchesConverted &&
      ingestAnalysis.storedPdf.sourceEqualsExtracted &&
      ingestAnalysis.storedPdf.sourceLooksRawPdf === false &&
      ingestAnalysis.storedTxt.matchesConverted &&
      ingestAnalysis.convertedTxt.count > 1 &&
      ingestAnalysis.convertedTxt.heading_paths.every((h) => h === '') &&
      ingestAnalysis.txtMdHasHeading === false,
    { convertThenChunk: true, rawWouldHaveFakeHeading: true, overlap: 160 },
    ingestAnalysis,
  )

  const readyOnlyDocs = await evaluate(`(() => {
    const raw = sessionStorage.getItem('customer_service_mock_documents_v4');
    const docs = JSON.parse(raw || '[]').filter((d) => d.ingest_status === 'ready');
    sessionStorage.setItem('customer_service_mock_documents_v4', JSON.stringify(docs));
    return docs.map((d) => d.filename);
  })()`)
  evidence.emptyFilterSetup = readyOnlyDocs
  await send('Page.reload', { ignoreCache: true })
  await Promise.race([send('Page.loadEventFired').catch(() => null), delay(5000)])
  await waitFor(`document.querySelector('.kb-page')`, 8000)
  await waitFor(`document.querySelectorAll('.kb-row').length >= 1`, 8000)
  await clickFilter('入库中')
  const emptyIngesting = await evaluate(collectKb)
  evidence.emptyIngesting = { ...emptyIngesting, screenshot: await screenshot('t017-empty-ingesting.png') }
  record(
    'tc02-empty-ingesting',
    emptyIngesting.rowCount === 0 &&
      emptyIngesting.emptyText.includes(EMPTY_FILTER_TEXT) &&
      emptyIngesting.layout.fileDisabled === false &&
      emptyIngesting.layout.uploadDisabled === false,
    EMPTY_FILTER_TEXT,
    { emptyText: emptyIngesting.emptyText, rowCount: emptyIngesting.rowCount, uploadDisabled: emptyIngesting.layout.uploadDisabled },
  )
  await clickFilter('请重新上传')
  const emptyFailed = await evaluate(collectKb)
  evidence.emptyFailed = { ...emptyFailed, screenshot: await screenshot('t017-empty-failed.png') }
  record(
    'tc02-empty-failed',
    emptyFailed.rowCount === 0 && emptyFailed.emptyText.includes(EMPTY_FILTER_TEXT),
    EMPTY_FILTER_TEXT,
    { emptyText: emptyFailed.emptyText, rowCount: emptyFailed.rowCount },
  )
  await evaluate(`sessionStorage.setItem('customer_service_mock_documents_v4', '[]')`)
  await send('Page.reload', { ignoreCache: true })
  await Promise.race([send('Page.loadEventFired').catch(() => null), delay(5000)])
  await waitFor(`document.querySelector('.kb-page')`, 8000)
  const emptyAll = await evaluate(collectKb)
  evidence.emptyAll = { ...emptyAll, screenshot: await screenshot('t017-empty-all.png') }
  record(
    'tc02-empty-all-copy',
    emptyAll.rowCount === 0 && emptyAll.emptyText.includes(EMPTY_ALL_TEXT) && emptyAll.layout.uploadDisabled === false,
    EMPTY_ALL_TEXT,
    { emptyText: emptyAll.emptyText, rowCount: emptyAll.rowCount },
  )

  const kbShell = await evaluate(collectShell)
  evidence.kbShell = kbShell
  record(
    'tc05-knowledge-topbar',
    kbShell.topbarUser === '已登录：[Mock] it-help' && kbShell.logoutText === '退出' && kbShell.activeNav.includes('知识库'),
    '已登录：[Mock] it-help + 退出',
    kbShell,
  )
  const afterKbLogout = await logoutAndExpectLogin()
  evidence.logoutKnowledge = { ...afterKbLogout, screenshot: await screenshot('t017-logout-knowledge.png') }
  record('tc05-logout-knowledge', afterKbLogout.pathname === '/login' && afterKbLogout.hasLoggedOutHint, '/login 当前未登录', afterKbLogout)

  await login()
  const empShell = await evaluate(collectShell)
  evidence.employeeShell = empShell
  record(
    'tc05-employee-topbar',
    empShell.topbarUser === '已登录：[Mock] it-help' && empShell.logoutText === '退出' && empShell.pathname === '/employee',
    '已登录：[Mock] it-help',
    empShell,
  )
  const faq = await sendChat('Outlook 打不开')
  evidence.employeeFaq = { ...faq, screenshot: await screenshot('t017-employee-faq.png') }
  record(
    'tc05-employee-faq',
    faq.lastOther && /FAQ/.test(String(faq.lastOther.tag || '')) && faq.pageHasMock,
    'FAQ bubble',
    { tag: faq.lastOther?.tag, text: faq.lastOther?.text?.slice(0, 80), tags: faq.systemTags },
  )
  const vague = await sendChat('连不上')
  evidence.employeeClarify = vague
  record(
    'tc05-employee-clarify',
    /反问/.test(String(vague.lastOther?.tag || '')),
    '反问',
    { tag: vague.lastOther?.tag, text: vague.lastOther?.text?.slice(0, 80) },
  )
  const afterEmpLogout = await logoutAndExpectLogin()
  evidence.logoutEmployee = afterEmpLogout
  record('tc05-logout-employee', afterEmpLogout.pathname === '/login' && afterEmpLogout.hasLoggedOutHint, '/login 当前未登录', afterEmpLogout)

  await login()
  await clickNav('客服端')
  await waitFor(`location.pathname === '/agent'`, 5000)
  const agentShell = await evaluate(collectShell)
  const agentEmpty = await evaluate(collectAgent)
  evidence.agentEmpty = { shell: agentShell, agent: agentEmpty, screenshot: await screenshot('t017-agent-empty.png') }
  record(
    'tc05-agent-topbar',
    agentShell.topbarUser === '已登录：[Mock] it-help' && agentShell.logoutText === '退出' && agentShell.activeNav.includes('客服端'),
    '已登录：[Mock] it-help',
    agentShell,
  )
  record(
    'tc05-agent-empty',
    agentEmpty.emptyText.some((t) => t.includes('还没有需要人工处理的对话')),
    '还没有需要人工处理的对话',
    agentEmpty,
  )
  const afterAgentLogout = await logoutAndExpectLogin()
  evidence.logoutAgent = { ...afterAgentLogout, screenshot: await screenshot('t017-logout-agent.png') }
  record('tc05-logout-agent', afterAgentLogout.pathname === '/login' && afterAgentLogout.hasLoggedOutHint, '/login 当前未登录', afterAgentLogout)

  evidence.checks = checks
  evidence.failed = checks.filter((c) => !c.pass).map((c) => c.id)
  await writeFile(path.join(OUT_DIR, 't017-browser-evidence.json'), JSON.stringify(evidence, null, 2))
  console.log(`failed=${JSON.stringify(evidence.failed)}`)
  if (evidence.failed.length) {
    process.exitCode = 1
  }
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
