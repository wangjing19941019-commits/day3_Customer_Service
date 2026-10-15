import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT_DIR = path.resolve(
  'C:\\Users\\慈海客服\\Desktop\\demo\\Develop_Helper\\Projects_Repo\\Customer_Service\\.sdd\\test-reports',
)
const BASE = process.env.T014_BASE || 'http://127.0.0.1:8766'
const CDP_PORT = Number(process.env.T014_CDP_PORT || 9433)
const FORBIDDEN_HOSTS = ['5199', '8099', 'dashscope', 'aliyuncs.com', '9413', '9415']

let chromeProc
let ws
let sessionId
let msgId = 0
const pending = new Map()
const checks = []
const networkUrls = []

function record(id, pass, expected, actual, extra = {}) {
  checks.push({ id, pass: Boolean(pass), expected, actual, ...extra })
  const tag = pass ? 'PASS' : 'FAIL'
  console.log(`${tag} ${id}`)
  if (!pass) console.error(`  expected ${JSON.stringify(expected)} actual ${JSON.stringify(actual)}`)
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

async function setViewport(width, height) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width <= 720,
  })
}

async function screenshot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  await writeFile(path.join(OUT_DIR, name), Buffer.from(data, 'base64'))
  return name
}

async function goto(url) {
  const loaded = new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), 8000)
    const handler = (event) => {
      const msg = JSON.parse(String(event.data))
      if (msg.method === 'Page.loadEventFired' && (!msg.sessionId || msg.sessionId === sessionId)) {
        clearTimeout(timer)
        ws.removeEventListener('message', handler)
        resolve('loaded')
      }
    }
    ws.addEventListener('message', handler)
  })
  await send('Page.navigate', { url })
  await loaded
  await delay(250)
}

const collectLayout = `(() => {
  const docEl = document.documentElement;
  const body = document.body;
  const nav = document.querySelector('nav');
  const main = document.querySelector('main');
  const wrap = document.querySelector('.wrap');
  const navRect = nav ? nav.getBoundingClientRect() : null;
  const mainRect = main ? main.getBoundingClientRect() : null;
  const overlap = navRect && mainRect
    ? !(navRect.right <= mainRect.left + 1 || mainRect.right <= navRect.left + 1 || navRect.bottom <= mainRect.top + 1 || mainRect.bottom <= navRect.top + 1)
      && getComputedStyle(wrap).gridTemplateColumns !== '1fr'
    : false;
  const text = document.body.innerText || '';
  const algChips = [...document.querySelectorAll('#alg-chunk .chip, #alg-cosine-faq .chip, #alg-qa-state .chip, #alg-retrieve .chip')].map((n) => ({
    parent: n.closest('.card')?.id,
    text: n.textContent,
  }));
  const algStatus = {};
  for (const card of document.querySelectorAll('article.card[id^="alg-"]')) {
    algStatus[card.id] = card.querySelector('.chip')?.textContent || null;
  }
  return {
    title: document.title,
    h1: document.querySelector('nav h1')?.textContent || null,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrollWidth: docEl.scrollWidth,
    clientWidth: docEl.clientWidth,
    bodyScrollWidth: body.scrollWidth,
    overflowX: getComputedStyle(body).overflowX,
    wrapColumns: wrap ? getComputedStyle(wrap).gridTemplateColumns : null,
    navBottom: navRect ? Math.round(navRect.bottom) : null,
    mainTop: mainRect ? Math.round(mainRect.top) : null,
    navRight: navRect ? Math.round(navRect.right) : null,
    mainLeft: mainRect ? Math.round(mainRect.left) : null,
    desktopOverlap: overlap,
    pageIds: [...document.querySelectorAll('section.card[id^="page-"]')].map((n) => n.id),
    pageNames: [...document.querySelectorAll('section.card[id^="page-"] h2')].map((n) => n.textContent.trim()),
    navPageLinks: [...document.querySelectorAll('nav a')].map((a) => ({ href: a.getAttribute('href'), text: a.textContent })),
    featureIds: [...document.querySelectorAll('article.card[id^="feat-"]')].map((n) => n.id),
    hasTrigger: Boolean(document.querySelector('#feat-login .kv')),
    detailsCount: document.querySelectorAll('details').length,
    openDetails: [...document.querySelectorAll('details')].filter((d) => d.open).length,
    sixZone: ['项目概况', '启动指南', '验收看板', '决策看板'].filter((s) => text.includes(s)),
    hasPluginTool: /工单工具|Plugin 层|Agent 工具循环/.test(text) && /编造/.test(text),
    notPresent: text.includes('无 Plugin') || text.includes('无 Agent'),
    statusText: document.getElementById('status')?.innerText || '',
    appTextHead: (document.getElementById('app')?.innerText || '').slice(0, 200),
    loadError: document.getElementById('load-error')?.innerText || null,
    staleBanner: document.getElementById('stale-banner')?.innerText || null,
    algStatus,
    algChips,
    chunkChip: document.querySelector('#alg-chunk .chip')?.textContent || null,
    qaChip: document.querySelector('#alg-qa-state .chip')?.textContent || null,
    cosineChip: document.querySelector('#alg-cosine-faq .chip')?.textContent || null,
    retrieveChip: document.querySelector('#alg-retrieve .chip')?.textContent || null,
    handoffChip: document.querySelector('#alg-handoff .chip')?.textContent || null,
    loginChip: document.querySelector('#alg-login .chip')?.textContent || null,
    copyFailVisible: [...document.querySelectorAll('input.copy-fail')].some((el) => !el.hidden),
    copyBtnText: document.querySelector('[data-copy]')?.textContent || null,
    focusedId: document.querySelector('#api-001') ? 'present' : null,
    api001InView: (() => {
      const el = document.getElementById('api-001');
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.top < window.innerHeight && r.bottom > 0;
    })(),
    chunk800: text.includes('800'),
    chunk160: text.includes('160'),
    clarify5: text.includes('clarification_max_rounds') || text.includes('反问 5') || text.includes('连续反问上限'),
    bailianHttpx: text.includes('httpx'),
    noAgentLoop: text.includes('不是 Agent 工具') || text.includes('无 Agent'),
  };
})()`

function layoutOk(info, mode) {
  const hOverflow = info.scrollWidth > info.clientWidth + 2 || info.bodyScrollWidth > info.innerWidth + 2
  if (mode === 'desktop') {
    const twoCol = info.wrapColumns && !info.wrapColumns.includes('1fr') && info.wrapColumns.split(' ').length >= 2
    const sideBySide = info.navRight && info.mainLeft && info.navRight <= info.mainLeft + 4
    return { hOverflow, twoCol, sideBySide, occlude: Boolean(info.desktopOverlap && !sideBySide) }
  }
  const stacked = info.wrapColumns === '1fr' || (info.navBottom && info.mainTop && info.navBottom <= info.mainTop + 8)
  return { hOverflow, stacked, occlude: false }
}

function forbiddenNetwork() {
  return networkUrls.filter((u) => FORBIDDEN_HOSTS.some((h) => String(u).includes(h)))
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const userData = await mkdtemp(path.join(os.tmpdir(), 't014-chrome-'))
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
      '--disable-background-networking',
      '--window-size=1280,900',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  const version = await waitJson(`http://127.0.0.1:${CDP_PORT}/json/version`)
  console.log('chrome version', version.Browser, 'ws', version.webSocketDebuggerUrl)
  ws = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', (ev) => reject(new Error(`ws error ${ev.message || ''}`)), { once: true })
  })
  ws.addEventListener('close', (ev) => {
    console.error('cdp closed', ev.code, ev.reason)
  })
  ws.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(String(event.data))
      if (msg.method === 'Network.requestWillBeSent') {
        const url = msg.params?.request?.url
        if (url) networkUrls.push(url)
      }
      const replyId = msg.id
      if (replyId && pending.has(replyId)) {
        const item = pending.get(replyId)
        clearTimeout(item.timer)
        pending.delete(replyId)
        if (msg.error) item.reject(new Error(JSON.stringify(msg.error)))
        else item.resolve(msg.result)
      }
    } catch (err) {
      console.error('cdp message parse', err)
    }
  })

  const created = await send('Target.createTarget', { url: 'about:blank' })
  const attached = await send('Target.attachToTarget', { targetId: created.targetId, flatten: true })
  sessionId = attached.sessionId
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Network.enable')

  const evidence = {
    base: BASE,
    cdpPort: CDP_PORT,
    userDataDir: userData,
    steps: {},
  }

  try {
    const staticRes = await fetch(`${BASE}/project-console.html`)
    const mapRes = await fetch(`${BASE}/project-map.json`)
    evidence.staticStatus = staticRes.status
    evidence.mapStatus = mapRes.status
    record('static-html', staticRes.status === 200, 200, staticRes.status)
    record('static-map', mapRes.status === 200, 200, mapRes.status)

    console.log('setViewport')
    await setViewport(1280, 900)
    console.log('goto console')
    await goto(`${BASE}/project-console.html`)
    console.log('wait feat-login')
    await waitFor(`document.querySelector('#feat-login')`, 8000)
    console.log('collect desktop')
    const desktop = await evaluate(collectLayout)
    evidence.steps.desktop = desktop
    const desk = layoutOk(desktop, 'desktop')
    evidence.steps.desktopLayout = desk
    record('del001-pages', JSON.stringify(desktop.pageIds) === JSON.stringify(['page-login', 'page-employee', 'page-agent', 'page-knowledge']), ['page-login', 'page-employee', 'page-agent', 'page-knowledge'], desktop.pageIds)
    record('del001-no-sixzone', desktop.sixZone.length === 0, [], desktop.sixZone)
    record('del001-h1', desktop.h1 === '页面功能导航', '页面功能导航', desktop.h1)
    record('del001-desktop-overflow', desk.hOverflow === false, false, desk)
    record('del001-desktop-columns', Boolean(desk.twoCol && desk.sideBySide), true, desk)
    record('del001-features-present', desktop.featureIds.includes('feat-login') && desktop.featureIds.includes('feat-kb-ingest'), true, desktop.featureIds)
    record('del003-chunk-params', desktop.chunk800 && desktop.chunk160 && desktop.clarify5, true, { chunk800: desktop.chunk800, chunk160: desktop.chunk160, clarify5: desktop.clarify5 })
    record('del003-bailian-httpx', desktop.bailianHttpx && desktop.noAgentLoop, true, { httpx: desktop.bailianHttpx, noAgent: desktop.noAgentLoop })
    record('del003-live-checked', desktop.chunkChip === '源码已核对' && desktop.qaChip === '源码已核对' && desktop.handoffChip === '源码已核对', '源码已核对', { chunk: desktop.chunkChip, qa: desktop.qaChip, handoff: desktop.handoffChip })
    await screenshot('t014-desktop.png')

    await evaluate(`document.querySelector('a[href="#feat-ask"]').click()`)
    await delay(300)
    const afterNav = await evaluate(`(() => {
      const el = document.getElementById('feat-ask');
      const r = el.getBoundingClientRect();
      return { inView: r.top < window.innerHeight && r.bottom > 0, trigger: el.querySelector('.kv')?.textContent || null };
    })()`)
    evidence.steps.navFeature = afterNav
    record('del001-nav-feature', afterNav.inView && /触发/.test(afterNav.trigger || ''), true, afterNav)

    await evaluate(`(() => {
      const details = document.querySelector('#feat-ask details');
      details.open = true;
      return details.open;
    })()`)
    const expanded = await evaluate(`document.querySelector('#feat-ask details')?.open === true && Boolean(document.querySelector('#feat-ask .src'))`)
    evidence.steps.expand = expanded
    record('del001-expand-source', expanded === true, true, expanded)

    await evaluate(`document.querySelector('#feat-login a[href="#api-001"]').click()`)
    await delay(300)
    const apiJump = await evaluate(`(() => {
      const el = document.getElementById('api-001');
      const r = el.getBoundingClientRect();
      return {
        inView: r.top < window.innerHeight && r.bottom > 0,
        method: el.querySelector('code')?.textContent || null,
      };
    })()`)
    evidence.steps.apiJump = apiJump
    record('del002-api-jump', apiJump.inView && String(apiJump.method).includes('POST /api/sessions'), true, apiJump)

    await evaluate(`document.querySelector('#api-001 [data-copy]')?.click()`)
    await delay(200)
    const copyLive = await evaluate(`(() => {
      const btn = document.querySelector('#api-001 [data-copy]');
      const input = btn?.nextElementSibling;
      return { btn: btn?.textContent || null, failVisible: input ? !input.hidden : false, value: input?.value || null };
    })()`)
    evidence.steps.copyLive = copyLive
    const copyOk = copyLive.btn === '已复制' || copyLive.btn === '请手选' || copyLive.failVisible
    record('del004-copy-or-hand', copyOk, '已复制|请手选', copyLive)

    await setViewport(375, 812)
    await delay(200)
    const narrow = await evaluate(collectLayout)
    const nar = layoutOk(narrow, 'narrow')
    evidence.steps.narrow = { ...narrow, layout: nar }
    record('del001-narrow-overflow', nar.hOverflow === false, false, nar)
    record('del001-narrow-stacked', Boolean(nar.stacked), true, nar)
    await screenshot('t014-narrow.png')

    await setViewport(1280, 900)
    await goto(`${BASE}/project-console.html?sample=stale&expand=all&focus=alg-chunk`)
    await waitFor(`document.getElementById('stale-banner') || document.querySelector('#alg-chunk .chip')`, 8000)
    const stale = await evaluate(collectLayout)
    evidence.steps.stale = { chunk: stale.chunkChip, cosine: stale.cosineChip, qa: stale.qaChip, banner: stale.staleBanner, status: stale.statusText }
    record(
      'del005-stale-chunk',
      stale.chunkChip === '来源已变化待复核' && stale.chunkChip !== '源码已核对',
      '来源已变化待复核',
      stale.chunkChip,
    )
    record(
      'del005-stale-cosine',
      stale.cosineChip === '来源已变化待复核',
      '来源已变化待复核',
      stale.cosineChip,
    )
    record(
      'del005-stale-other-login',
      stale.loginChip === '源码已核对',
      '源码已核对',
      stale.loginChip,
    )
    await screenshot('t014-sample-stale.png')

    await goto(`${BASE}/project-console.html?sample=missing`)
    await waitFor(`document.querySelector('#alg-qa-state')`, 8000)
    const missing = await evaluate(collectLayout)
    evidence.steps.missing = { qa: missing.qaChip, retrieve: missing.retrieveChip, cosine: missing.cosineChip, chunk: missing.chunkChip, status: missing.statusText }
    record('del005-missing-qa', missing.qaChip === '未找到实现', '未找到实现', missing.qaChip)
    record('del005-missing-retrieve', missing.retrieveChip === '未找到实现', '未找到实现', missing.retrieveChip)
    record('del005-missing-chunk-still-ok', missing.chunkChip === '源码已核对', '源码已核对', missing.chunkChip)
    await screenshot('t014-sample-missing.png')

    await goto(`${BASE}/project-console.html?sample=invalid`)
    await waitFor(`document.getElementById('load-error')`, 8000)
    const invalid = await evaluate(collectLayout)
    evidence.steps.invalid = { loadError: invalid.loadError, featureIds: invalid.featureIds, app: invalid.appTextHead }
    record('del005-invalid-banner', Boolean(invalid.loadError) && /解析失败/.test(invalid.loadError), '解析失败', invalid.loadError)
    record('del005-invalid-no-features', invalid.featureIds.length === 0, [], invalid.featureIds)
    await screenshot('t014-sample-invalid.png')

    await goto(`${BASE}/project-console.html`)
    await waitFor(`document.querySelector('#btn-reload')`, 8000)
    await evaluate(`document.getElementById('btn-reload').click()`)
    await delay(400)
    const reloaded = await evaluate(`document.getElementById('status')?.innerText || ''`)
    evidence.steps.reload = reloaded
    record('del005-reload', /已从 project-map.json 重新加载/.test(reloaded), '已从 project-map.json 重新加载', reloaded.slice(0, 180))

    await goto(`${BASE}/project-console.html?copytest=1`)
    await waitFor(`document.querySelector('[data-copy]')`, 8000)
    await delay(400)
    const copyTest = await evaluate(`(() => {
      const btn = document.querySelector('[data-copy]');
      const input = document.querySelector('input.copy-fail');
      return {
        btn: btn?.textContent || null,
        failVisible: input ? !input.hidden : false,
        value: input?.value || null,
      };
    })()`)
    evidence.steps.copytest = copyTest
    record('del004-copytest', copyTest.btn === '已复制' || copyTest.btn === '请手选' || copyTest.failVisible, '已复制|请手选', copyTest)
    await screenshot('t014-copytest.png')

    const badNet = forbiddenNetwork()
    evidence.networkSample = networkUrls.slice(0, 30)
    evidence.forbiddenNetwork = badNet
    record('del004-no-business-net', badNet.length === 0, [], badNet)
  } catch (err) {
    evidence.error = String(err && err.stack ? err.stack : err)
    record('runner', false, 'no throw', evidence.error)
  }

  const failed = checks.filter((c) => !c.pass).map((c) => c.id)
  evidence.checks = checks
  evidence.failed = failed
  await writeFile(path.join(OUT_DIR, 't014-browser-evidence.json'), JSON.stringify(evidence, null, 2), 'utf8')
  console.log(JSON.stringify({ failed, pass: failed.length === 0, cdpPort: CDP_PORT, userData }, null, 2))

  try {
    if (sessionId) await send('Browser.close').catch(() => null)
  } catch {
    /* ignore */
  }
  if (chromeProc && !chromeProc.killed) chromeProc.kill()
  process.exit(failed.length ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  if (chromeProc && !chromeProc.killed) chromeProc.kill()
  process.exit(1)
})
