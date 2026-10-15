import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const BASE = process.env.T034_BASE || 'http://127.0.0.1:5288'
const CHROME = process.env.T034_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT_DIR = path.resolve(
  'C:\\Users\\慈海客服\\Desktop\\demo\\Develop_Helper\\Projects_Repo\\Customer_Service\\.sdd\\test-reports',
)
const CDP_PORT = Number(process.env.T034_CDP_PORT || 9488)
const ADMIN_USER = process.env.T034_ADMIN_USER || 'admin'
const AGENT_USER = process.env.T034_AGENT_USER || 'agent'
const DEMO_PASS = process.env.T034_DEMO_PASS || ''
const SAMPLE = '我很生气，订单JD20260922001还没按七天无理由退货处理。'
const CHANGE_SUMMARY = 'T034-tester 退货售后说明补充'
const BODY_MARK = '【T034修订】请结合用户情绪{{emotion}}、订单{{order}}与政策{{policy}}给出售后说明。'

let chromeProc
let ws
let sessionId
let msgId = 0
const pending = new Map()
const failed = []
const checks = []

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
    throw new Error(`eval failed: ${text}\n${expression.slice(0, 240)}`)
  }
  return result.result?.value
}

async function waitFor(expression, timeoutMs = 12000) {
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

function record(id, ok, expected, actual) {
  checks.push({ id, ok, expected, actual })
  if (!ok) failed.push({ id, expected, actual })
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

async function clickText(selector, text) {
  return evaluate(`(() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const el = nodes.find((n) => (n.textContent || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(text)}));
    if (!el) return false;
    el.click();
    return true;
  })()`)
}

async function loginAs(username, password) {
  await waitFor(`document.querySelector('#user') && document.querySelector('#pass')`)
  await evaluate(fillScript('#user', username))
  await evaluate(fillScript('#pass', password))
  await evaluate(`(() => {
    const btn = document.querySelector('.btn-primary');
    if (!btn) throw new Error('missing login button');
    btn.click();
    return true;
  })()`)
}

async function clickLogout() {
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '退出');
    if (!btn) throw new Error('missing logout');
    btn.click();
    return true;
  })()`)
  await waitFor(`location.pathname.includes('/login') && document.body.innerText.includes('当前未登录')`)
}

const collectPage = `(() => {
  const nav = [...document.querySelectorAll('.sidebar a')].map((a) => ({
    text: (a.textContent || '').trim(),
    href: a.getAttribute('href'),
    className: a.className,
  }));
  const editorBtns = [...document.querySelectorAll('.tpl-editor button')].map((b) => ({
    text: (b.textContent || '').trim(),
    cls: b.className,
    disabled: b.disabled,
  }));
  const primary = editorBtns.filter((b) => /btn-primary/.test(b.cls));
  const grayBtn = editorBtns.find((b) => b.text.includes('灰度'));
  const rollbackBtn = editorBtns.find((b) => b.text.includes('回滚'));
  const previewEl = document.querySelector('.tpl-preview');
  const alertEls = [...document.querySelectorAll('.tpl-alert, .tpl-alert-inline')];
  const alertCs = alertEls[0] ? getComputedStyle(alertEls[0]) : null;
  const saveHint = [...document.querySelectorAll('.tpl-edit .hint')].map((n) => n.textContent.trim());
  const bodyText = document.body.innerText || '';
  return {
    href: location.href,
    pathname: location.pathname,
    mockEnabledHint: bodyText.includes('[Mock]'),
    topbarUser: document.querySelector('.session .user')?.textContent ?? null,
    nav,
    navLabels: nav.map((n) => n.text),
    navHasTemplate: nav.some((n) => n.text === '模板' || n.href === '/templates'),
    rows: [...document.querySelectorAll('.tpl-row')].map((row) => ({
      title: row.querySelector('.tpl-row-title')?.textContent?.trim() ?? '',
      hint: row.querySelector('.hint')?.textContent?.trim() ?? '',
      alert: row.querySelector('.tpl-alert')?.textContent?.trim() ?? '',
      selected: row.classList.contains('selected'),
    })),
    h1: document.querySelector('.tpl-editor h1')?.textContent?.trim() ?? '',
    editorBtns,
    primary,
    grayBtn,
    rollbackBtn,
    grayReason: document.querySelector('.tpl-block [role="status"]')?.textContent?.trim() ?? '',
    rollbackMessage: [...document.querySelectorAll('.tpl-block [role="status"]')].map((n) => n.textContent.trim()),
    previewText: previewEl?.textContent?.trim() ?? '',
    previewHasEmotionToken: (previewEl?.textContent || '').includes('{{emotion}}'),
    previewHasOrderToken: (previewEl?.textContent || '').includes('{{order}}'),
    chatBubbles: document.querySelectorAll('.bubble, .msg, [data-role="assistant"]').length,
    alerts: alertEls.map((n) => ({
      text: n.textContent.trim(),
      color: getComputedStyle(n).color,
    })),
    alertColor: alertCs?.color ?? null,
    saveHint,
    amountHint: document.querySelector('.tpl-toolbar-block .hint')?.textContent?.trim() ?? '',
    amountMessage: [...document.querySelectorAll('.tpl-toolbar-block .hint')].map((n) => n.textContent.trim()),
    evalHint: [...document.querySelectorAll('.tpl-toolbar-block .hint')].map((n) => n.textContent.trim()),
    versions: [...document.querySelectorAll('.tpl-versions li')].map((n) => n.textContent.trim()),
    diff: [...document.querySelectorAll('.tpl-block .tpl-preview')].map((n) => n.textContent.trim()),
    hasSaveNewVersion: editorBtns.some((b) => b.text === '保存新版本' && /btn-primary/.test(b.cls)),
    primaryOnlySave: primary.length === 1 && primary[0]?.text === '保存新版本',
    layout: {
      listWidth: document.querySelector('.tpl-list') ? Math.round(document.querySelector('.tpl-list').getBoundingClientRect().width) : null,
      editorLeft: document.querySelector('.tpl-editor') ? Math.round(document.querySelector('.tpl-editor').getBoundingClientRect().left) : null,
      listLeft: document.querySelector('.tpl-list') ? Math.round(document.querySelector('.tpl-list').getBoundingClientRect().left) : null,
    },
    store: (() => {
      try { return JSON.parse(sessionStorage.getItem('mock_prompt_templates_v1') || 'null'); }
      catch { return null; }
    })(),
    convStoreKeys: Object.keys((() => {
      try { return JSON.parse(sessionStorage.getItem('mock_conversations') || '{}'); }
      catch { return {}; }
    })()),
    net: window.__t034Net || [],
  };
})()`

async function main() {
  if (!DEMO_PASS) throw new Error('missing T034_DEMO_PASS')
  await mkdir(OUT_DIR, { recursive: true })
  const userData = await mkdtemp(path.join(os.tmpdir(), 't034-chrome-'))
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
      const { resolve, reject, timer } = pending.get(msg.id)
      clearTimeout(timer)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
    }
  })

  const targets = await waitJson(`http://127.0.0.1:${CDP_PORT}/json/list`)
  const pageTarget = targets.find((t) => t.type === 'page') || targets[0]
  const attached = await send('Target.attachToTarget', { targetId: pageTarget.id, flatten: true })
  sessionId = attached.sessionId
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Network.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })

  const evidence = {
    chrome: version.Browser,
    cdpPort: CDP_PORT,
    base: BASE,
    mock: true,
    screenshots: [],
  }

  await send('Page.navigate', { url: `${BASE}/login` })
  await waitFor(`document.querySelector('#user')`, 15000)

  const mockFlag = await evaluate(`document.body.innerText.includes('[Mock]')`)
  evidence.mockFlag = { pageHasMockLabel: mockFlag }

  await loginAs(ADMIN_USER, DEMO_PASS)
  await waitFor(`document.querySelector('.session .user')`, 15000)
  const afterAdminLogin = await evaluate(`({ pathname: location.pathname, user: document.querySelector('.session .user')?.textContent || '' })`)
  record(
    'TC-login-admin',
    /admin/.test(afterAdminLogin.user) && afterAdminLogin.pathname !== '/login',
    'admin 登录后进入受保护页',
    afterAdminLogin,
  )

  const clickedTpl = await clickText('.sidebar a', '模板')
  record('TC-nav-template', clickedTpl === true, '管理端侧栏有模板入口并可点击', clickedTpl)
  await waitFor(`location.pathname === '/templates' && document.querySelector('.tpl-page')`, 15000)
  await waitFor(`document.querySelectorAll('.tpl-row').length > 0`, 15000)
  evidence.screenshots.push(await screenshot('t034-admin-templates.png'))

  const clickedReturn = await evaluate(`(() => {
    const row = [...document.querySelectorAll('.tpl-row')].find((n) => {
      const t = n.textContent || '';
      return t.includes('3C') && t.includes('退换货') && t.includes('售后');
    });
    if (!row) return false;
    row.click();
    return true;
  })()`)
  record('TC-select-return', clickedReturn === true, '选中 3C 数码退换货售后模板', clickedReturn)
  await waitFor(`document.querySelector('#tpl-body')`, 8000)
  await delay(300)

  const initial = await evaluate(collectPage)
  evidence.initial = {
    pathname: initial.pathname,
    navLabels: initial.navLabels,
    rows: initial.rows,
    primary: initial.primary,
    grayBtn: initial.grayBtn,
    grayReason: initial.grayReason,
    alerts: initial.alerts,
    alertColor: initial.alertColor,
    layout: initial.layout,
    h1: initial.h1,
    evalHint: initial.evalHint,
    amountHint: initial.amountHint,
    mockEnabledHint: initial.mockEnabledHint,
  }

  record(
    'TC-11-layout',
    initial.layout.listLeft != null &&
      initial.layout.editorLeft != null &&
      initial.layout.listLeft < initial.layout.editorLeft &&
      initial.rows.length >= 1,
    '左列表右编辑',
    initial.layout,
  )
  record(
    'TC-07-primary',
    initial.primaryOnlySave === true &&
      !initial.editorBtns.some((b) => /btn-primary/.test(b.cls) && b.text !== '保存新版本'),
    '编辑区主按钮只有「保存新版本」',
    { primary: initial.primary, editorBtns: initial.editorBtns },
  )
  record(
    'TC-03-gray-blocked',
    initial.grayBtn?.disabled === true &&
      /没有不少于 5000 条的评测集，不能开始灰度/.test(initial.grayReason || '') &&
      /\[Mock\]/.test(initial.grayReason || ''),
    '不足 5000 灰度禁用并写明原因，带 [Mock]',
    { grayBtn: initial.grayBtn, grayReason: initial.grayReason, evalHint: initial.evalHint },
  )
  record(
    'TC-06-alert',
    initial.alerts.some((a) => /合规拦截率突然升高/.test(a.text) && /\[Mock\]/.test(a.text)) &&
      initial.alertColor === 'rgb(180, 35, 24)',
    '告警 Danger 文字 #B42318 且带 [Mock]',
    { alerts: initial.alerts, alertColor: initial.alertColor },
  )
  record(
    'TC-08-mock',
    initial.mockEnabledHint === true && /\[Mock\]/.test(initial.h1),
    '页面 Mock 数据带 [Mock]',
    { h1: initial.h1, mockEnabledHint: initial.mockEnabledHint },
  )

  await evaluate(fillScript('#tpl-body', BODY_MARK))
  await evaluate(fillScript('#tpl-summary', CHANGE_SUMMARY))
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('.tpl-primary-row .btn-primary')].find((b) => (b.textContent || '').includes('保存新版本'));
    if (!btn) throw new Error('missing save');
    if (btn.disabled) throw new Error('save disabled');
    btn.click();
    return true;
  })()`)
  await waitFor(`document.body.innerText.includes('新版本 v') && document.body.innerText.includes(${JSON.stringify(CHANGE_SUMMARY)})`, 8000)
  evidence.screenshots.push(await screenshot('t034-after-save.png'))
  const afterSave = await evaluate(collectPage)
  evidence.afterSave = {
    saveHint: afterSave.saveHint,
    versions: afterSave.versions,
    diff: afterSave.diff,
    rows: afterSave.rows,
  }
  const savedOk =
    afterSave.saveHint.some((t) => /新版本 v2/.test(t) && /admin/.test(t) && t.includes(CHANGE_SUMMARY)) &&
    afterSave.versions.some((t) => /v2/.test(t) && /admin/.test(t) && t.includes(CHANGE_SUMMARY)) &&
    afterSave.diff.some((t) => t.includes('T034修订') || t.includes('+'))
  record(
    'TC-01-save',
    savedOk,
    '保存出现新版本号、修改人/时间/内容，对比可见正文差异',
    { saveHint: afterSave.saveHint, versions: afterSave.versions, diff: afterSave.diff },
  )

  await evaluate(`(() => {
    window.__t034Net = [];
    const push = (kind, url) => window.__t034Net.push({ kind, url: String(url || '') });
    const origFetch = window.fetch;
    window.fetch = function(input, init) {
      push('fetch', typeof input === 'string' ? input : input && input.url);
      return origFetch.apply(this, arguments);
    };
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      this.__t034Url = url;
      return origOpen.apply(this, arguments);
    };
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function() {
      push('xhr', this.__t034Url);
      return origSend.apply(this, arguments);
    };
    window.__t034ConvBefore = sessionStorage.getItem('mock_conversations');
    return true;
  })()`)
  await evaluate(fillScript('#tpl-sample', SAMPLE))
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('.tpl-block button')].find((b) => (b.textContent || '').trim() === '预览');
    if (!btn) throw new Error('missing preview');
    btn.click();
    return true;
  })()`)
  await waitFor(`document.querySelector('.tpl-preview') && document.querySelector('.tpl-preview').textContent.includes('JD20260922001')`, 8000)
  evidence.screenshots.push(await screenshot('t034-preview.png'))
  const afterPreview = await evaluate(collectPage)
  const previewText = afterPreview.previewText || ''
  const replyUrls = (afterPreview.net || []).filter((n) =>
    /chat\/completions|\/messages|polish|agent\/reply|completions/i.test(n.url),
  )
  const previewOk =
    /生气/.test(previewText) &&
    /JD20260922001/.test(previewText) &&
    /七天无理由/.test(previewText) &&
    !afterPreview.previewHasEmotionToken &&
    !afterPreview.previewHasOrderToken &&
    afterPreview.chatBubbles === 0 &&
    replyUrls.length === 0 &&
    JSON.stringify(afterPreview.convStoreKeys) === JSON.stringify(initial.convStoreKeys)
  record(
    'TC-02-preview',
    previewOk,
    '预览只替换占位，不发坐席回复，无模型回复路径请求',
    {
      previewText,
      tokensLeft: {
        emotion: afterPreview.previewHasEmotionToken,
        order: afterPreview.previewHasOrderToken,
      },
      chatBubbles: afterPreview.chatBubbles,
      net: afterPreview.net,
      replyUrls,
      convStoreKeys: afterPreview.convStoreKeys,
    },
  )

  await evaluate(fillScript('.tpl-toolbar input[type="number"]', '8888'))
  await clickText('.tpl-toolbar button', '保存金额线')
  await waitFor(`document.body.innerText.includes('金额线已保存') && document.body.innerText.includes('8888')`, 8000)
  const afterAmountSave = await evaluate(collectPage)
  record(
    'TC-10a-amount-save',
    afterAmountSave.amountMessage.some((t) => /当前金额线 8888/.test(t) || /金额线已保存/.test(t)) &&
      afterAmountSave.store?.settings?.high_risk_amount_threshold === 8888,
    '金额线可保存',
    { amountMessage: afterAmountSave.amountMessage, settings: afterAmountSave.store?.settings },
  )
  await clickText('.tpl-toolbar button', '清空')
  await waitFor(`document.body.innerText.includes('金额线已清空') && document.body.innerText.includes('未配置金额线')`, 8000)
  const afterAmountClear = await evaluate(collectPage)
  record(
    'TC-10b-amount-clear',
    afterAmountClear.amountMessage.some((t) => /未配置金额线/.test(t) || /金额线已清空/.test(t)) &&
      afterAmountClear.store?.settings?.high_risk_amount_threshold == null,
    '金额线可清空',
    { amountMessage: afterAmountClear.amountMessage, settings: afterAmountClear.store?.settings },
  )

  await evaluate(`(() => {
    const input = document.querySelector('.tpl-toolbar input[type="file"]');
    if (!input) throw new Error('missing eval file');
    const dt = new DataTransfer();
    dt.items.add(new File(['{"item_count":5000}\\n'], 'eval.jsonl', { type: 'application/json' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return { name: input.files[0]?.name, size: input.files[0]?.size };
  })()`)
  await clickText('.tpl-toolbar button', '导入评测集')
  await waitFor(`document.body.innerText.includes('当前 5000 条，可灰度')`, 8000)
  const afterEval = await evaluate(collectPage)
  evidence.screenshots.push(await screenshot('t034-eval-ready.png'))
  record(
    'TC-04a-eval-ready',
    afterEval.grayBtn?.disabled === false &&
      afterEval.evalHint.some((t) => /当前 5000 条，可灰度/.test(t)),
    '满 5000 灰度按钮可用',
    { grayBtn: afterEval.grayBtn, evalHint: afterEval.evalHint },
  )

  await clickText('.tpl-block button', '灰度约 5%')
  await waitFor(`[...document.querySelectorAll('.tpl-row .hint')].some((n) => /灰度 v/.test(n.textContent || '') && /5%/.test(n.textContent || ''))`, 8000)
  const afterGray = await evaluate(collectPage)
  evidence.afterGray = { rows: afterGray.rows }
  record(
    'TC-04b-gray-release',
    afterGray.rows.some((r) => /灰度 v/.test(r.hint) && /5%/.test(r.hint)),
    '灰度约 5% 后列表显示灰度版本',
    afterGray.rows,
  )

  await clickText('.tpl-block button', '回滚')
  await waitFor(`document.body.innerText.includes('新会话将使用该版本')`, 8000)
  evidence.screenshots.push(await screenshot('t034-rollback.png'))
  const afterRollback = await evaluate(collectPage)
  evidence.afterRollback = {
    rollbackMessage: afterRollback.rollbackMessage,
    rows: afterRollback.rows,
  }
  record(
    'TC-05-rollback',
    afterRollback.rollbackMessage.some((t) => /新会话将使用该版本/.test(t) && /\[Mock\]/.test(t)),
    '回滚后提示新会话将使用该版本',
    afterRollback.rollbackMessage,
  )

  await clickLogout()
  await loginAs(AGENT_USER, DEMO_PASS)
  await waitFor(`document.querySelector('.session .user')`, 15000)
  const agentHome = await evaluate(collectPage)
  evidence.screenshots.push(await screenshot('t034-agent-home.png'))
  record(
    'TC-09a-agent-nav',
    agentHome.navHasTemplate === false &&
      agentHome.navLabels.every((t) => t !== '模板') &&
      /agent/.test(agentHome.topbarUser || ''),
    '坐席侧栏无模板入口',
    { navLabels: agentHome.navLabels, user: agentHome.topbarUser, pathname: agentHome.pathname },
  )

  await send('Page.navigate', { url: `${BASE}/templates` })
  await waitFor(`location.pathname === '/agent' && !document.querySelector('.tpl-page')`, 8000)
  const agentForced = await evaluate(collectPage)
  evidence.screenshots.push(await screenshot('t034-agent-blocked.png'))
  record(
    'TC-09b-agent-blocked',
    agentForced.pathname !== '/templates' && !documentHasTpl(agentForced),
    '坐席直接打开 /templates 被挡回，打不开编辑发布',
    { pathname: agentForced.pathname, h1: agentForced.h1, navLabels: agentForced.navLabels },
  )

  evidence.checks = checks
  evidence.failed = failed
  evidence.pass = failed.length === 0
  await writeFile(path.join(OUT_DIR, 't034-browser-evidence.json'), JSON.stringify(evidence, null, 2), 'utf8')
  if (failed.length) {
    console.error('FAILS:', JSON.stringify(failed, null, 2))
    process.exitCode = 1
  } else {
    console.log('PASS', checks.length, 'checks')
  }
}

function documentHasTpl(snapshot) {
  return Boolean(snapshot.h1 && snapshot.h1.includes('模板配置'))
}

main()
  .catch(async (err) => {
    console.error(err)
    try {
      await writeFile(
        path.join(OUT_DIR, 't034-browser-evidence.json'),
        JSON.stringify({ pass: false, error: String(err), checks, failed }, null, 2),
        'utf8',
      )
    } catch {}
    process.exitCode = 1
  })
  .finally(() => {
    if (ws && ws.close) ws.close()
    if (chromeProc && !chromeProc.killed) chromeProc.kill()
  })
