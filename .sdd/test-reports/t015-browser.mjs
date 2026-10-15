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
const CDP_PORT = 9346

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

const collectKb = `(() => {
  const statusRe = /入库中|已完成|请重新上传/;
  const timeRe = /(\\d+)月(\\d+)日\\s+(\\d{2}):(\\d{2})(?!:)/;
  const secondsRe = /\\d{1,2}:\\d{2}:\\d{2}/;
  const isoRe = /\\d{4}-\\d{2}-\\d{2}T/;
  const rows = [...document.querySelectorAll('.kb-row')].map((row) => {
    const filename = row.querySelector('.kb-row-title')?.textContent?.trim() ?? '';
    const hint = row.querySelector('.hint')?.innerText?.replace(/\\s+/g, ' ').trim() ?? '';
    const timeEl = row.querySelector('.kb-row-time');
    const timeCs = timeEl ? getComputedStyle(timeEl) : null;
    const statusMatch = hint.match(statusRe);
    return {
      filename,
      hint,
      status: statusMatch ? statusMatch[0] : '',
      timeText: timeEl?.textContent?.trim() ?? '',
      timeFontSize: timeCs?.fontSize ?? null,
      timeColor: timeCs?.color ?? null,
      hasSeconds: secondsRe.test(hint),
      hasIso: isoRe.test(hint) || isoRe.test(filename),
      hasCreatedAt: /created_at/i.test(hint) || /created_at/i.test(row.innerText),
      selected: row.classList.contains('selected'),
    };
  });
  const filterBar = document.querySelector('.kb-filter');
  const filterBtns = [...document.querySelectorAll('.kb-filter-btn')].map((btn) => {
    const cs = getComputedStyle(btn);
    const rect = btn.getBoundingClientRect();
    return {
      label: btn.textContent.trim(),
      value: btn.getAttribute('data-filter'),
      pressed: btn.getAttribute('aria-pressed') === 'true',
      selectedClass: btn.classList.contains('selected'),
      height: Math.round(rect.height),
      radius: cs.borderRadius,
      fontSize: cs.fontSize,
      color: cs.color,
      background: cs.backgroundColor,
      borderColor: cs.borderColor,
    };
  });
  const upload = document.querySelector('.kb-upload');
  const uploadRect = upload?.getBoundingClientRect();
  const list = document.querySelector('.kb-list');
  const listRect = list?.getBoundingClientRect();
  const listScroll = document.querySelector('.kb-list-scroll');
  const empty = document.querySelector('.kb-empty');
  const fileInput = document.querySelector('#kb-file');
  const uploadBtn = document.querySelector('.kb-upload button[type="submit"]');
  const filterInUpload = Boolean(document.querySelector('.kb-upload .kb-filter, .kb-upload [data-filter]'));
  const uploadBtnLabels = [...document.querySelectorAll('.kb-upload button')].map((b) => b.textContent.trim());
  const detail = document.querySelector('.kb-detail');
  return {
    pathname: location.pathname,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    pageHasMock: (document.body.innerText || '').includes('[Mock]'),
    rows,
    rowCount: rows.length,
    filenames: rows.map((r) => r.filename),
    statuses: rows.map((r) => r.status),
    emptyText: empty?.textContent?.trim() ?? '',
    listError: document.querySelector('.kb-list .error-text')?.textContent?.trim() ?? '',
    uploadError: document.querySelector('.kb-upload [role="alert"]')?.textContent?.trim() ?? '',
    uploadHint: document.querySelector('.kb-upload-hint')?.textContent?.trim() ?? '',
    detailText: detail?.innerText?.replace(/\\s+/g, ' ').trim() ?? '',
    filterAria: filterBar?.getAttribute('aria-label') ?? null,
    filterLabels: filterBtns.map((b) => b.label),
    filterPressed: filterBtns.filter((b) => b.pressed).map((b) => b.label),
    filterPressedValue: filterBtns.find((b) => b.pressed)?.value ?? null,
    filterBtns,
    layout: {
      uploadHeight: uploadRect ? Math.round(uploadRect.height) : null,
      uploadTop: uploadRect ? Math.round(uploadRect.top) : null,
      listWidth: listRect ? Math.round(listRect.width) : null,
      filterTop: filterBar ? Math.round(filterBar.getBoundingClientRect().top) : null,
      listScrollTop: listScroll ? Math.round(listScroll.getBoundingClientRect().top) : null,
      filterInList: Boolean(list?.querySelector(':scope > .kb-filter')),
      filterInUpload,
      uploadBtnLabels,
      fileDisabled: fileInput ? fileInput.disabled : null,
      uploadDisabled: uploadBtn ? uploadBtn.disabled : null,
    },
  };
})()`

async function setInputFile(name, content, mime = 'text/markdown') {
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

async function setViewport(width, height) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  })
}

async function snapshotQueries() {
  return evaluate(`({
    listQueries: Array.isArray(window.__kbListQueries) ? window.__kbListQueries.slice() : [],
    filterCalls: Array.isArray(window.__kbFilterCalls) ? window.__kbFilterCalls.slice() : [],
  })`)
}

function newestFirst(rows) {
  const times = rows.map((r) => r.timeText)
  const parsed = rows.map((r) => {
    const m = r.timeText.match(/(\d+)月(\d+)日\s+(\d{2}):(\d{2})/)
    if (!m) return null
    return Number(m[1]) * 1e8 + Number(m[2]) * 1e4 + Number(m[3]) * 100 + Number(m[4])
  })
  if (parsed.some((v) => v == null)) return { ok: false, times }
  const sorted = [...parsed].sort((a, b) => b - a)
  return { ok: parsed.every((v, i) => v === sorted[i]), times, parsed }
}

function rgbOf(cssColor) {
  const m = String(cssColor || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function hasName(text, name) {
  return String(text || '').includes(name)
}

function near(a, b, tol = 8) {
  if (!a || !b) return false
  return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const userData = await mkdtemp(path.join(os.tmpdir(), 't015-chrome-'))
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
  await send('Debugger.enable')
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__kbListQueries = []; window.__kbFilterCalls = [];`,
  })
  await setViewport(1440, 900)

  async function installQueryBreakpoints() {
    const hookSrc = await evaluate(`fetch('/src/hooks/useDocuments.ts', { cache: 'no-store' }).then((r) => r.text())`)
    const svcSrc = await evaluate(`fetch('/src/services/documentService.ts', { cache: 'no-store' }).then((r) => r.text())`)
    const hookLine = String(hookSrc).split('\n').findIndex((line) => line.includes('return query'))
    const svcLine = String(svcSrc)
      .split('\n')
      .findIndex((line) => line.includes('const ingestStatus = query.ingest_status'))
    if (hookLine < 0 || svcLine < 0) {
      throw new Error(`breakpoint lines not found hook=${hookLine} svc=${svcLine}`)
    }
    await send('Debugger.setBreakpointByUrl', {
      urlRegex: 'useDocuments\\.ts',
      lineNumber: hookLine,
      condition:
        'void (window.__kbFilterCalls = window.__kbFilterCalls || []).push({filter: filter, queryKeys: Object.keys(query||{}), ingest_status: query && query.ingest_status, t: Date.now()}); false',
    })
    await send('Debugger.setBreakpointByUrl', {
      urlRegex: 'documentService\\.ts',
      lineNumber: svcLine,
      condition:
        'void (window.__kbListQueries = window.__kbListQueries || []).push({ingest_status: query && query.ingest_status, keys: query ? Object.keys(query) : [], page: query && query.page, t: Date.now()}); false',
    })
    return { hookLine, svcLine }
  }

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
    steps: [],
  }

  const vite = await fetch(BASE)
  evidence.viteStatus = vite.status

  await goto(`${BASE}/login`)
  await waitFor(`document.querySelector('.login-card')`)
  await evaluate(fillScript('#user', 'it-help'))
  await evaluate(fillScript('#pass', 'it-help123'))
  await evaluate(`document.querySelector('button[type="submit"]').click()`)
  await waitFor(`document.querySelector('.app') && location.pathname === '/employee'`, 8000)
  await clickNav('知识库')
  await waitFor(`location.pathname === '/knowledge'`)
  await send('Page.reload', { ignoreCache: true })
  await Promise.race([send('Page.loadEventFired').catch(() => null), delay(5000)])
  await waitFor(`location.pathname === '/knowledge' && document.querySelector('.kb-page')`, 8000)
  await waitFor(
    `document.querySelectorAll('.kb-row').length >= 2 || Boolean(document.querySelector('.kb-empty'))`,
    8000,
  )
  evidence.breakpoints = await installQueryBreakpoints()
  await evaluate(`window.__kbListQueries = []; window.__kbFilterCalls = [];`)
  await clickFilter('全部')
  await delay(150)

  const baseline = await evaluate(collectKb)
  evidence.baseline = {
    ...baseline,
    expectedOutlookLocal: await evaluate(`(() => {
      const d = new Date('2026-09-14T04:12:00.000Z');
      const vpn = new Date('2026-09-13T10:00:00.000Z');
      const fmt = (date) => (date.getMonth()+1) + '月' + date.getDate() + '日 ' + String(date.getHours()).padStart(2,'0') + ':' + String(date.getMinutes()).padStart(2,'0');
      return { tz: Intl.DateTimeFormat().resolvedOptions().timeZone, outlook: fmt(d), vpn: fmt(vpn) };
    })()`),
    screenshot: await screenshot('t015-baseline-all.png'),
  }

  await clickFilter('入库中')
  await delay(200)
  const ingestingOnly = await evaluate(collectKb)
  evidence.ingestingFilter = {
    ...ingestingOnly,
    queries: await snapshotQueries(),
    screenshot: await screenshot('t015-filter-ingesting.png'),
  }

  await clickFilter('已完成')
  await delay(200)
  const readyOnly = await evaluate(collectKb)
  evidence.readyFilter = {
    ...readyOnly,
    screenshot: await screenshot('t015-filter-ready.png'),
  }

  await clickFilter('请重新上传')
  await delay(200)
  const failedEmpty = await evaluate(collectKb)
  evidence.failedEmpty = {
    ...failedEmpty,
    screenshot: await screenshot('t015-filter-failed-empty.png'),
  }

  const mdBody = '# T-015 验收\\n\\n这是一篇用于知识库列表增量验收的 Markdown。\\n'
  await setInputFile('t015-from-failed.md', mdBody)
  await evaluate(`document.querySelector('.kb-upload button[type="submit"]').click()`)
  await waitFor(`([...document.querySelectorAll('.kb-filter-btn')].find(b => b.textContent.trim()==='全部')?.getAttribute('aria-pressed') === 'true')`, 5000)
  await waitFor(`[...document.querySelectorAll('.kb-row-title')].some((n) => (n.textContent||'').includes('t015-from-failed.md'))`, 5000)
  const afterFailedUpload = await evaluate(collectKb)
  evidence.afterFailedUpload = {
    ...afterFailedUpload,
    nowLocal: await evaluate(`(() => {
      const d = new Date();
      return (d.getMonth()+1) + '月' + d.getDate() + '日 ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
    })()`),
    screenshot: await screenshot('t015-upload-from-failed.png'),
  }

  await clickFilter('已完成')
  await delay(200)
  const readyBeforeUpload = await evaluate(collectKb)
  await setInputFile('t015-from-ready.md', mdBody)
  await evaluate(`document.querySelector('.kb-upload button[type="submit"]').click()`)
  await waitFor(`([...document.querySelectorAll('.kb-filter-btn')].find(b => b.textContent.trim()==='全部')?.getAttribute('aria-pressed') === 'true')`, 5000)
  await waitFor(`[...document.querySelectorAll('.kb-row-title')].some((n) => (n.textContent||'').includes('t015-from-ready.md'))`, 5000)
  const afterReadyUpload = await evaluate(collectKb)
  evidence.readyBeforeUpload = { filterPressed: readyBeforeUpload.filterPressed, filenames: readyBeforeUpload.filenames }
  evidence.afterReadyUpload = {
    ...afterReadyUpload,
    screenshot: await screenshot('t015-upload-from-ready.png'),
  }

  await clickFilter('入库中')
  await delay(200)
  const ingestingBeforeKeep = await evaluate(collectKb)
  await setInputFile('t015-keep-ingesting.md', mdBody)
  await evaluate(`document.querySelector('.kb-upload button[type="submit"]').click()`)
  await waitFor(`[...document.querySelectorAll('.kb-row-title')].some((n) => (n.textContent||'').includes('t015-keep-ingesting.md'))`, 5000)
  await delay(200)
  const afterKeepIngesting = await evaluate(collectKb)
  evidence.afterKeepIngesting = {
    beforePressed: ingestingBeforeKeep.filterPressed,
    ...afterKeepIngesting,
    screenshot: await screenshot('t015-keep-ingesting.png'),
  }

  await clickFilter('全部')
  await delay(200)
  await setInputFile('t015-keep-all.md', mdBody)
  await evaluate(`document.querySelector('.kb-upload button[type="submit"]').click()`)
  await waitFor(`[...document.querySelectorAll('.kb-row-title')].some((n) => (n.textContent||'').includes('t015-keep-all.md'))`, 5000)
  await delay(200)
  const afterKeepAll = await evaluate(collectKb)
  evidence.afterKeepAll = {
    ...afterKeepAll,
    screenshot: await screenshot('t015-keep-all.png'),
  }

  const vpnRow = afterKeepAll.rows.find((r) => hasName(r.filename, 'vpn-faq.md'))
  if (vpnRow) {
    await evaluate(`(() => {
      const row = [...document.querySelectorAll('.kb-row')].find((el) => (el.querySelector('.kb-row-title')?.textContent || '').includes('vpn-faq.md'));
      if (row) row.click();
    })()`)
    await delay(400)
  }
  const strategy = await evaluate(collectKb)
  evidence.strategy = {
    detailHasOverlap80: /重叠\s*80\s*字/.test(strategy.detailText),
    detailHasOverlap160: /重叠\s*160\s*字/.test(strategy.detailText),
    detailText: strategy.detailText.slice(0, 240),
  }

  const raceHits = []
  for (let i = 0; i < 3; i += 1) {
    await clickFilter('全部')
    await delay(2800 + i * 150)
    await clickFilter('已完成')
    const start = Date.now()
    while (Date.now() - start < 2200) {
      const snap = await evaluate(collectKb)
      const ingestingVisible = snap.rows.some((r) => r.status === '入库中')
      if (snap.filterPressedValue === 'ready' && ingestingVisible) {
        raceHits.push({
          i,
          elapsed: Date.now() - start,
          filenames: snap.filenames,
          statuses: snap.statuses,
          pressed: snap.filterPressed,
        })
        break
      }
      await delay(80)
    }
  }
  const raceSettled = await evaluate(collectKb)
  evidence.race = {
    observedStaleAllOverwrite: raceHits.length > 0,
    hits: raceHits,
    settledPressed: raceSettled.filterPressed,
    settledStatuses: raceSettled.statuses,
    screenshot: await screenshot('t015-race-ready.png'),
  }

  const queries = await snapshotQueries()
  evidence.queries = queries

  const selected = baseline.filterBtns.find((b) => b.pressed)
  const unselected = baseline.filterBtns.find((b) => !b.pressed)
  const order = newestFirst(baseline.rows)
  const outlook = baseline.rows.find((r) => hasName(r.filename, 'outlook.md'))
  const vpn = baseline.rows.find((r) => hasName(r.filename, 'vpn-faq.md'))
  const outlookTimeOk = Boolean(
    outlook && evidence.baseline.expectedOutlookLocal && outlook.timeText.includes(evidence.baseline.expectedOutlookLocal.outlook),
  )
  const vpnTimeOk = Boolean(
    vpn && evidence.baseline.expectedOutlookLocal && vpn.timeText.includes(evidence.baseline.expectedOutlookLocal.vpn),
  )

  function allRowsMatch(snap, status) {
    return snap.rowCount > 0 && snap.rows.every((r) => r.status === status)
  }

  const failedUploadFirst = afterFailedUpload.rows[0]
  const readyUploadFirst = afterReadyUpload.rows[0]
  const keepIngestFirst = afterKeepIngesting.rows[0]
  const keepAllFirst = afterKeepAll.rows[0]

  const allQuerySamples = (queries.filterCalls || []).filter((c) => c.filter === 'all')
  const ingestQuerySamples = (queries.filterCalls || []).filter((c) => c.filter === 'ingesting')
  const readyQuerySamples = (queries.filterCalls || []).filter((c) => c.filter === 'ready')
  const failedQuerySamples = (queries.filterCalls || []).filter((c) => c.filter === 'failed')
  const listAll = (queries.listQueries || []).filter((c) => c.ingest_status == null || c.ingest_status === undefined)
  const listTyped = (queries.listQueries || []).filter((c) => c.ingest_status)

  evidence.assertions = {
    vite200: evidence.viteStatus === 200,
    viewport1440: baseline.viewport.w >= 1440 && baseline.viewport.h >= 900,
    mockVisible: baseline.pageHasMock === true && baseline.rows.every((r) => r.filename.includes('[Mock]')),
    atLeastTwoDocs: baseline.rowCount >= 2,
    newestFirst: order.ok === true && hasName(baseline.filenames[0], 'outlook.md') && hasName(baseline.filenames[1], 'vpn-faq.md'),
    rowFilename: Boolean(outlook && vpn),
    chineseStatus: Boolean(outlook && outlook.status === '入库中' && vpn && vpn.status === '已完成'),
    localTimeToMinute: outlookTimeOk && vpnTimeOk && baseline.rows.every((r) => /(\d+)月(\d+)日\s+(\d{2}):(\d{2})/.test(r.timeText)),
    noSeconds: baseline.rows.every((r) => r.hasSeconds === false),
    noCreatedAt: baseline.rows.every((r) => r.hasCreatedAt === false && r.hasIso === false),
    timeMuted12: baseline.rows.every((r) => r.timeFontSize === '12px' && near(rgbOf(r.timeColor), [92, 107, 122], 12)),
    filterInLeftTop:
      baseline.layout.filterInList === true &&
      baseline.layout.filterInUpload === false &&
      baseline.layout.filterTop != null &&
      baseline.layout.listScrollTop != null &&
      baseline.layout.filterTop < baseline.layout.listScrollTop,
    uploadHasNoFilter: baseline.layout.uploadBtnLabels.every((t) => !['全部', '入库中', '已完成', '请重新上传'].includes(t)),
    uploadMinHeight: baseline.layout.uploadHeight >= 64,
    leftCol320: baseline.layout.listWidth >= 300 && baseline.layout.listWidth <= 340,
    fourFilters: JSON.stringify(baseline.filterLabels) === JSON.stringify(['全部', '入库中', '已完成', '请重新上传']),
    defaultAll: JSON.stringify(baseline.filterPressed) === JSON.stringify(['全部']),
    chipSize: baseline.filterBtns.every((b) => b.height === 32 && b.fontSize === '12px' && (b.radius === '6px' || b.radius.startsWith('6px'))),
    chipSelectedColor: Boolean(selected && near(rgbOf(selected.background), [232, 241, 250], 12) && near(rgbOf(selected.color), [29, 78, 137], 12)),
    chipUnselected: Boolean(unselected && near(rgbOf(unselected.background), [255, 255, 255], 12)),
    ingestingOnly: ingestingOnly.filterPressedValue === 'ingesting' && allRowsMatch(ingestingOnly, '入库中') && newestFirst(ingestingOnly.rows).ok,
    readyOnly: readyOnly.filterPressedValue === 'ready' && allRowsMatch(readyOnly, '已完成') && newestFirst(readyOnly.rows).ok,
    failedEmptyText:
      failedEmpty.filterPressedValue === 'failed' &&
      failedEmpty.rowCount === 0 &&
      failedEmpty.emptyText.includes('当前没有该状态的文档') &&
      failedEmpty.emptyText.includes('[Mock]'),
    failedEmptyUploadEnabled: failedEmpty.layout.fileDisabled === false && failedEmpty.layout.uploadDisabled === false,
    uploadFromFailedGoesAll:
      afterFailedUpload.filterPressedValue === 'all' &&
      hasName(failedUploadFirst?.filename, 't015-from-failed.md') &&
      failedUploadFirst?.status === '入库中',
    uploadFromFailedCurrentTime: Boolean(
      failedUploadFirst && failedUploadFirst.timeText.includes(evidence.afterFailedUpload.nowLocal),
    ),
    uploadFromReadyGoesAll:
      afterReadyUpload.filterPressedValue === 'all' &&
      hasName(readyUploadFirst?.filename, 't015-from-ready.md') &&
      readyUploadFirst?.status === '入库中',
    keepIngesting:
      afterKeepIngesting.filterPressedValue === 'ingesting' &&
      hasName(keepIngestFirst?.filename, 't015-keep-ingesting.md') &&
      keepIngestFirst?.status === '入库中' &&
      afterKeepIngesting.rows.every((r) => r.status === '入库中'),
    keepAll:
      afterKeepAll.filterPressedValue === 'all' &&
      hasName(keepAllFirst?.filename, 't015-keep-all.md') &&
      keepAllFirst?.status === '入库中',
    overlap80Expected: evidence.strategy.detailHasOverlap80 === true,
    queryAllOmits:
      allQuerySamples.length === 0
        ? listAll.length > 0 && (queries.listQueries || []).every((c) => (c.keys || []).includes('page'))
        : allQuerySamples.every((c) => c.ingest_status == null || c.ingest_status === undefined) &&
          allQuerySamples.every((c) => !(c.queryKeys || []).includes('ingest_status')),
    queryOthersMap:
      (ingestQuerySamples.length === 0 && readyQuerySamples.length === 0 && failedQuerySamples.length === 0
        ? listTyped.some((c) => c.ingest_status === 'ingesting') &&
          listTyped.some((c) => c.ingest_status === 'ready') &&
          listTyped.some((c) => c.ingest_status === 'failed')
        : ingestQuerySamples.every((c) => c.ingest_status === 'ingesting') &&
          readyQuerySamples.every((c) => c.ingest_status === 'ready') &&
          failedQuerySamples.every((c) => c.ingest_status === 'failed')),
  }

  if (allQuerySamples.length === 0 && listAll.length === 0) {
    evidence.assertions.queryAllOmits = false
  }

  const failed = Object.entries(evidence.assertions)
    .filter(([, v]) => v !== true)
    .map(([k]) => k)
  evidence.failedAssertions = failed
  evidence.newestFirstDetail = order

  const outFile = path.join(OUT_DIR, 't015-browser-evidence.json')
  await writeFile(outFile, JSON.stringify(evidence, null, 2), 'utf8')
  console.log(
    JSON.stringify(
      {
        ok: failed.length === 0,
        outFile,
        failed,
        raceObserved: evidence.race.observedStaleAllOverwrite,
        queryCounts: {
          list: (queries.listQueries || []).length,
          filter: (queries.filterCalls || []).length,
        },
        baselineFiles: baseline.filenames,
        assertions: evidence.assertions,
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
