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
    const text =
      result.exceptionDetails.exception?.description ||
      result.exceptionDetails.text ||
      JSON.stringify(result.exceptionDetails)
    throw new Error(`eval failed: ${text}`)
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

const collectPage = `(() => {
  const rows = [...document.querySelectorAll('.kb-row')].map((row) => ({
    filename: row.querySelector('.kb-row-title')?.textContent?.trim() ?? '',
    statusText: row.querySelector('.hint')?.innerText?.replace(/\\s+/g, ' ').trim() ?? '',
    selected: row.classList.contains('selected'),
  }));
  const detail = document.querySelector('.kb-detail');
  const detailText = detail?.innerText ?? '';
  const chunks = [...document.querySelectorAll('.kb-chunk')].map((chunk) => ({
    meta: chunk.querySelector('.kb-chunk-meta')?.textContent?.trim() ?? '',
    content: chunk.querySelector('.kb-chunk-body')?.textContent ?? '',
    contentEditable: chunk.querySelector('.kb-chunk-body')?.getAttribute('contenteditable'),
    hasInput: Boolean(chunk.querySelector('textarea, input')),
  }));
  const editForm = document.querySelector('form.kb-edit');
  const saveButtons = [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => t.includes('保存'));
  const uploadBar = document.querySelector('.kb-upload');
  const list = document.querySelector('.kb-list');
  const topbar = document.querySelector('.topbar');
  const primary = document.querySelector('.kb-upload .btn-primary');
  const readyDot = document.querySelector('.kb-dot.ok');
  const warnDot = document.querySelector('.kb-dot.warn');
  const badDot = document.querySelector('.kb-dot.bad');
  const chunkBody = document.querySelector('.kb-chunk-body');
  const chunkMeta = document.querySelector('.kb-chunk-meta');
  return {
    href: location.href,
    pathname: location.pathname,
    rows,
    rowCount: rows.length,
    filenames: rows.map((r) => r.filename),
    statuses: rows.map((r) => r.statusText),
    detailText,
    hasChunks: chunks.length > 0,
    chunkCount: chunks.length,
    chunks,
    hasEditForm: Boolean(editForm),
    editDisabled: Boolean(editForm?.querySelector('input, textarea, select, button[type="submit"]')?.disabled) && Boolean(editForm),
    saveButtons,
    uploadError: document.querySelector('.kb-upload [role="alert"]')?.textContent?.trim() ?? '',
    saveMessage: [...document.querySelectorAll('.kb-edit .hint')].at(-1)?.textContent?.trim() ?? '',
    saveError: document.querySelector('.kb-edit [role="alert"]')?.textContent?.trim() ?? '',
    bodyHasMock: (document.body.innerText || '').includes('[Mock]'),
    statusWords: {
      ingesting: (document.body.innerText || '').includes('入库中'),
      ready: (document.body.innerText || '').includes('已完成'),
      failed: (document.body.innerText || '').includes('请重新上传'),
      englishIngest: /\\bingest(ing|ed)?\\b/i.test(document.body.innerText || ''),
      rawReady: (document.body.innerText || '').includes('ready') && !(document.body.innerText || '').includes('already'),
    },
    layout: {
      topbarHeight: topbar ? getComputedStyle(topbar).height : null,
      uploadMinHeight: uploadBar ? getComputedStyle(uploadBar).minHeight : null,
      uploadHeight: uploadBar ? Math.round(uploadBar.getBoundingClientRect().height) : null,
      listWidth: list ? Math.round(list.getBoundingClientRect().width) : null,
      detailWidth: detail ? Math.round(detail.getBoundingClientRect().width) : null,
      detailMinWidth: detail ? getComputedStyle(detail).minWidth : null,
      primaryBg: primary ? getComputedStyle(primary).backgroundColor : null,
      primaryHeight: primary ? getComputedStyle(primary).height : null,
      canvas: getComputedStyle(document.querySelector('.kb-page') || document.body).backgroundColor,
      readyDot: readyDot ? getComputedStyle(readyDot).backgroundColor : null,
      warnDot: warnDot ? getComputedStyle(warnDot).backgroundColor : null,
      badDot: badDot ? getComputedStyle(badDot).backgroundColor : null,
      chunkBodyFont: chunkBody ? getComputedStyle(chunkBody).fontSize : null,
      chunkMetaFont: chunkMeta ? getComputedStyle(chunkMeta).fontSize : null,
    },
    currentTags: (detailText.split('\\n').find((line) => line.includes('当前标签：')) || null),
    faqQuestion: document.querySelector('.kb-faq input')?.value ?? '',
    faqAnswer: document.querySelector('.kb-faq textarea')?.value ?? '',
    strategyHit: {
      titlePara: /标题与段落/.test(detailText),
      max800: /800/.test(detailText),
      overlap80: /80/.test(detailText),
    },
  };
})()`

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

async function clickUpload() {
  await evaluate(`document.querySelector('.kb-upload button[type="submit"]').click()`)
}

async function clickNav(label) {
  await evaluate(`(() => {
    const a = [...document.querySelectorAll('.sidebar a')].find((el) => el.textContent.trim() === ${JSON.stringify(label)});
    if (!a) throw new Error('missing nav ' + ${JSON.stringify(label)});
    a.click();
  })()`)
}

async function clickRowContaining(namePart) {
  await evaluate(`(() => {
    const row = [...document.querySelectorAll('.kb-row')].find((el) => (el.querySelector('.kb-row-title')?.textContent || '').includes(${JSON.stringify(namePart)}));
    if (!row) throw new Error('missing row ' + ${JSON.stringify(namePart)});
    row.click();
  })()`)
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const userData = await mkdtemp(path.join(os.tmpdir(), 't003-chrome-'))
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

  const evidence = { mock: true, viewport: '1440x900', url: `${BASE}/knowledge`, steps: [] }

  async function goto(url) {
    const nav = send('Page.navigate', { url })
    await Promise.race([send('Page.loadEventFired').catch(() => null), delay(4000)])
    await nav
  }

  await goto(`${BASE}/knowledge`)
  await waitFor(`document.querySelector('.login-card') || document.querySelector('.kb-page')`, 12000)
  const onLogin = await evaluate(`Boolean(document.querySelector('.login-card'))`)
  if (onLogin) {
    await evaluate(fillScript('#user', 'it-help'))
    await evaluate(fillScript('#pass', 'it-help123'))
    await evaluate(`document.querySelector('button[type="submit"]').click()`)
  }
  await waitFor(`document.querySelector('.topbar') && location.pathname !== '/login'`, 12000)
  if ((await evaluate(`location.pathname`)) !== '/knowledge') {
    await clickNav('知识库')
    await waitFor(`location.pathname === '/knowledge' && document.querySelector('.kb-page')`, 8000)
  }
  await waitFor(`document.querySelector('.kb-page')`)
  await waitFor(`document.querySelectorAll('.kb-row').length > 0`, 8000)

  const seed = await evaluate(collectPage)
  evidence.seed = {
    pathname: seed.pathname,
    rows: seed.rows,
    chunkCount: seed.chunkCount,
    strategyHit: seed.strategyHit,
    hasEditForm: seed.hasEditForm,
    saveButtons: seed.saveButtons,
    bodyHasMock: seed.bodyHasMock,
    layout: seed.layout,
    screenshot: await screenshot('t003-seed-vpn.png'),
  }

  const seedChunks = seed.chunks.map((c) => c.content)
  const listBeforeTxt = seed.rowCount
  await setInputFile('notes.txt', 'this is not markdown', 'text/plain')
  await clickUpload()
  await waitFor(
    `(document.querySelector('.kb-upload [role="alert"]')?.textContent || '').includes('请重新上传')`,
    6000,
  )
  const afterTxt = await evaluate(collectPage)
  evidence.nonMd = {
    uploadError: afterTxt.uploadError,
    rowCount: afterTxt.rowCount,
    listGrew: afterTxt.rowCount > listBeforeTxt,
    filenames: afterTxt.filenames,
    screenshot: await screenshot('t003-non-md.png'),
  }

  const mdBody = `# 测试入库

## 第一节
这是一篇用于 Mock 入库中状态的 Markdown。内容需要足够长，以便切出多于一块，并覆盖标题路径。处理顺序先看账号再核对配置，最后检查证书与时间。连接前确认网络与代理，失败三次后停止重试。导入配置后名称必须与公司标准一致。Windows 与 Mac 提示不同但原则相同。
${'重复说明以便超过一块上限。'.repeat(40)}

## 第二节
导入客户端配置后先断开再连接一次。若出现重复名称只保留最新发放的文件。TLS handshake failed 多半是拦截或证书过期。
${'第二节补充段落用于形成第二块正文。'.repeat(20)}
`
  const uploadStartedAt = Date.now()
  await setInputFile('ingesting-demo.md', mdBody, 'text/markdown')
  await clickUpload()
  await waitFor(
    `[...document.querySelectorAll('.kb-row')].some((r) => (r.innerText || '').includes('ingesting-demo.md') && (r.innerText || '').includes('入库中'))`,
    5000,
  )
  const afterMd = await evaluate(collectPage)
  evidence.mdImmediate = {
    elapsedMs: Date.now() - uploadStartedAt,
    rows: afterMd.rows,
    selected: afterMd.rows.find((r) => r.filename.includes('ingesting-demo')),
    hasChunks: afterMd.hasChunks,
    hasEditForm: afterMd.hasEditForm,
    detailText: afterMd.detailText,
    screenshot: await screenshot('t003-md-ingesting.png'),
  }

  await clickNav('员工端')
  await waitFor(`location.pathname === '/employee'`, 5000)
  const awayPath = await evaluate(`location.pathname`)
  await clickNav('知识库')
  await waitFor(`location.pathname === '/knowledge' && document.querySelector('.kb-page')`, 5000)
  await waitFor(
    `[...document.querySelectorAll('.kb-row')].some((r) => (r.innerText || '').includes('ingesting-demo.md'))`,
    5000,
  )
  await clickRowContaining('ingesting-demo.md')
  await delay(300)
  const afterReturn = await evaluate(collectPage)
  evidence.leaveAndReturn = {
    awayPath,
    backPath: afterReturn.pathname,
    elapsedMs: Date.now() - uploadStartedAt,
    rows: afterReturn.rows,
    ingestingStill: afterReturn.rows.some(
      (r) => r.filename.includes('ingesting-demo') && r.statusText.includes('入库中'),
    ),
    hasChunks: afterReturn.hasChunks,
    hasEditForm: afterReturn.hasEditForm,
    saveButtons: afterReturn.saveButtons,
    detailText: afterReturn.detailText,
    screenshot: await screenshot('t003-leave-return-ingesting.png'),
  }

  const readyWaitStart = Date.now()
  await waitFor(
    `[...document.querySelectorAll('.kb-row')].some((r) => (r.innerText || '').includes('ingesting-demo.md') && (r.innerText || '').includes('已完成'))`,
    20000,
  )
  await clickRowContaining('ingesting-demo.md')
  await waitFor(`document.querySelectorAll('.kb-chunk').length > 0`, 8000)
  const readyDoc = await evaluate(collectPage)
  evidence.mdReady = {
    waitMs: Date.now() - readyWaitStart,
    totalMs: Date.now() - uploadStartedAt,
    rows: readyDoc.rows,
    chunkCount: readyDoc.chunkCount,
    chunks: readyDoc.chunks.map((c) => ({
      meta: c.meta,
      contentLen: c.content.length,
      contentEditable: c.contentEditable,
      hasInput: c.hasInput,
      preview: c.content.slice(0, 80),
    })),
    strategyHit: readyDoc.strategyHit,
    hasEditForm: readyDoc.hasEditForm,
    saveButtons: readyDoc.saveButtons,
    detailHasStrategy: /标题与段落/.test(readyDoc.detailText) && /800/.test(readyDoc.detailText) && /80/.test(readyDoc.detailText),
    screenshot: await screenshot('t003-md-ready.png'),
  }
  const chunksBeforeSave = readyDoc.chunks.map((c) => c.content)

  await evaluate(`(() => {
    const boxes = [...document.querySelectorAll('.kb-fieldset')];
    const objectBox = boxes.find((fs) => (fs.querySelector('legend')?.textContent || '').includes('对象'));
    const hardware = [...(objectBox?.querySelectorAll('label') ?? [])].find((l) => l.textContent.includes('硬件设备'));
    const cb = hardware?.querySelector('input[type="checkbox"]');
    if (!cb) throw new Error('missing hardware checkbox');
    if (!cb.checked) cb.click();
    const faqQ = document.querySelector('.kb-faq input');
    const faqA = document.querySelector('.kb-faq textarea');
    if (!faqQ || !faqA) throw new Error('missing faq fields');
    const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    proto.set.call(faqQ, '保存后的新问法');
    faqQ.dispatchEvent(new Event('input', { bubbles: true }));
    const tproto = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    tproto.set.call(faqA, '保存后的新答案');
    faqA.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await evaluate(`document.querySelector('.kb-edit button[type="submit"]').click()`)
  await waitFor(
    `(document.querySelector('.kb-edit')?.innerText || '').includes('已保存')`,
    8000,
  )
  const afterSave = await evaluate(collectPage)
  evidence.saveTagsFaq = {
    currentTags: afterSave.currentTags,
    faqQuestion: afterSave.faqQuestion,
    faqAnswer: afterSave.faqAnswer,
    saveMessage: afterSave.saveMessage,
    chunkCount: afterSave.chunkCount,
    chunksUnchanged: JSON.stringify(afterSave.chunks.map((c) => c.content)) === JSON.stringify(chunksBeforeSave),
    screenshot: await screenshot('t003-save-tags.png'),
  }

  await clickRowContaining('vpn-faq.md')
  await waitFor(
    `[...document.querySelectorAll('.kb-row.selected')].some((r) => (r.innerText || '').includes('vpn-faq')) && document.querySelectorAll('.kb-chunk').length > 1`,
    6000,
  )
  const vpn = await evaluate(collectPage)
  evidence.vpnReady = {
    rows: vpn.rows.filter((r) => r.filename.includes('vpn-faq')),
    chunkCount: vpn.chunkCount,
    strategyHit: vpn.strategyHit,
    headingPaths: vpn.chunks.map((c) => c.meta),
    hasEditForm: vpn.hasEditForm,
    saveButtons: vpn.saveButtons,
    bodyHasMock: vpn.bodyHasMock,
    layout: vpn.layout,
    screenshot: await screenshot('t003-vpn-ready.png'),
  }

  const failStartedAt = Date.now()
  await setInputFile('fail.md', '# 失败文档\n\n这篇 Mock 应在约 8 秒后变成请重新上传。\n', 'text/markdown')
  await clickUpload()
  await waitFor(
    `[...document.querySelectorAll('.kb-row')].some((r) => (r.innerText || '').includes('fail.md') && (r.innerText || '').includes('入库中'))`,
    5000,
  )
  const failIngesting = await evaluate(collectPage)
  evidence.failIngesting = {
    elapsedMs: Date.now() - failStartedAt,
    rows: failIngesting.rows.filter((r) => r.filename.includes('fail.md')),
    hasChunks: failIngesting.hasChunks,
    hasEditForm: failIngesting.hasEditForm,
  }
  await waitFor(
    `[...document.querySelectorAll('.kb-row')].some((r) => (r.innerText || '').includes('fail.md') && (r.innerText || '').includes('请重新上传'))`,
    20000,
  )
  await clickRowContaining('fail.md')
  await delay(300)
  const failDone = await evaluate(collectPage)
  evidence.failReady = {
    waitMs: Date.now() - failStartedAt,
    rows: failDone.rows.filter((r) => r.filename.includes('fail.md')),
    detailText: failDone.detailText,
    hasChunks: failDone.hasChunks,
    hasEditForm: failDone.hasEditForm,
    screenshot: await screenshot('t003-fail.md.png'),
  }

  const allText = await evaluate(`document.body.innerText`)
  evidence.statusScan = {
    hasIngestingWord: allText.includes('入库中'),
    hasReadyWord: allText.includes('已完成'),
    hasFailedWord: allText.includes('请重新上传'),
    hasIngestingEn: /\bingesting\b/i.test(allText),
    hasReadyEn: /\bready\b/i.test(allText),
    hasFailedEn: /\bfailed\b/i.test(allText),
    hasMock: allText.includes('[Mock]'),
    listStatuses: failDone.statuses,
  }

  const outFile = path.join(OUT_DIR, 't003-browser-evidence.json')
  await writeFile(outFile, JSON.stringify(evidence, null, 2), 'utf8')
  console.log(
    JSON.stringify(
      {
        ok: true,
        outFile,
        nonMd: evidence.nonMd,
        mdImmediate: {
          elapsedMs: evidence.mdImmediate.elapsedMs,
          selected: evidence.mdImmediate.selected,
          hasChunks: evidence.mdImmediate.hasChunks,
          hasEditForm: evidence.mdImmediate.hasEditForm,
        },
        leaveAndReturn: {
          ingestingStill: evidence.leaveAndReturn.ingestingStill,
          hasChunks: evidence.leaveAndReturn.hasChunks,
          hasEditForm: evidence.leaveAndReturn.hasEditForm,
          elapsedMs: evidence.leaveAndReturn.elapsedMs,
        },
        mdReady: {
          chunkCount: evidence.mdReady.chunkCount,
          detailHasStrategy: evidence.mdReady.detailHasStrategy,
          saveButtons: evidence.mdReady.saveButtons,
          waitMs: evidence.mdReady.waitMs,
        },
        saveTagsFaq: evidence.saveTagsFaq,
        vpnReady: {
          chunkCount: evidence.vpnReady.chunkCount,
          strategyHit: evidence.vpnReady.strategyHit,
          saveButtons: evidence.vpnReady.saveButtons,
        },
        failReady: {
          waitMs: evidence.failReady.waitMs,
          rows: evidence.failReady.rows,
          hasChunks: evidence.failReady.hasChunks,
          hasEditForm: evidence.failReady.hasEditForm,
        },
        statusScan: evidence.statusScan,
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
