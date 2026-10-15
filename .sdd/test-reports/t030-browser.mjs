import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const BASE = process.env.T030_BASE || 'http://127.0.0.1:5288'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT_DIR = path.resolve(
  'C:\\Users\\慈海客服\\Desktop\\demo\\Develop_Helper\\Projects_Repo\\Customer_Service\\.sdd\\test-reports',
)
const CDP_PORT = Number(process.env.T030_CDP_PORT || 9460)
const DEMO_USER = process.env.T030_DEMO_USER || 'admin'
const DEMO_PASS = process.env.T030_DEMO_PASS || ''
const TARGET_READY = '服饰美妆常见问题.md'
const OTHER_READY = '发票开具说明.md'
const INGESTING = '订单配送时效说明.md'
const FROM_VALUE = '2026-03-01T09:00'
const TO_VALUE = '2026-06-30T18:00'

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

function assert(cond, label, extra) {
  if (!cond) {
    const detail = extra === undefined ? '' : ` ${JSON.stringify(extra)}`
    throw new Error(`ASSERT FAIL: ${label}${detail}`)
  }
}

const collectEditor = `(() => {
  const fieldset = [...document.querySelectorAll('fieldset')].find((el) =>
    /可见范围与政策生效时间/.test(el.querySelector('legend')?.textContent || ''),
  )
  const radios = [...document.querySelectorAll('input[name="kb-visibility"]')].map((input) => ({
    value: input.value,
    label: (input.parentElement?.textContent || '').replace(/\\s+/g, ' ').trim(),
    checked: input.checked,
  }))
  const saveBtn = [...document.querySelectorAll('button')].find((b) =>
    /保存可见范围和生效时间|保存中/.test(b.textContent || ''),
  )
  const tagSave = [...document.querySelectorAll('button')].find((b) =>
    /保存标签/.test(b.textContent || ''),
  )
  const saveStyle = saveBtn ? getComputedStyle(saveBtn) : null
  const primaryStyle = tagSave ? getComputedStyle(tagSave) : null
  const from = document.querySelector('input[aria-label="生效开始时间"]')
  const to = document.querySelector('input[aria-label="生效结束时间"]')
  const detail = document.querySelector('.kb-detail')
  const detailText = detail?.innerText || ''
  return {
    pathname: location.pathname,
    hasEditor: Boolean(fieldset),
    legend: fieldset?.querySelector('legend')?.textContent?.trim() ?? null,
    radios,
    radioLabels: radios.map((item) => item.label),
    checkedLabel: radios.find((item) => item.checked)?.label ?? null,
    checkedValue: radios.find((item) => item.checked)?.value ?? null,
    from: from?.value ?? null,
    to: to?.value ?? null,
    datetimeCount: document.querySelectorAll('input[type="datetime-local"]').length,
    saveText: saveBtn?.textContent?.trim() ?? null,
    saveClass: saveBtn?.className ?? null,
    saveBg: saveStyle?.backgroundColor ?? null,
    saveColor: saveStyle?.color ?? null,
    saveBorder: saveStyle?.borderColor ?? null,
    tagSaveClass: tagSave?.className ?? null,
    tagSaveBg: primaryStyle?.backgroundColor ?? null,
    hint: [...(fieldset?.querySelectorAll('.hint') || [])].map((el) => el.textContent.trim()),
    saveMessage: [...document.querySelectorAll('.kb-edit .hint, .kb-detail .hint')].map((el) => el.textContent.trim()),
    saveError: document.querySelector('.kb-edit .error-text, .kb-detail .error-text')?.textContent?.trim() ?? '',
    detailHasMock: detailText.includes('[Mock]'),
    detailHasUserVisible: /用户可见/.test(detailText),
    detailHasAgentOnly: /仅坐席可见/.test(detailText),
    detailHasHighRisk: /高风险仅人工/.test(detailText),
    detailHasEnum: /user_visible|agent_only|high_risk_human_only/.test(detailText),
    ingestHint: /入库中/.test(detailText) ? detailText.slice(0, 240) : null,
    bodyHasMock: (document.body.innerText || '').includes('[Mock]'),
  }
})()`

async function clickRow(filename) {
  const found = await evaluate(`(() => {
    const row = [...document.querySelectorAll('.kb-row')].find((el) =>
      (el.querySelector('.kb-row-title')?.textContent || '').includes(${JSON.stringify(filename)}),
    )
    if (!row) {
      return {
        found: false,
        titles: [...document.querySelectorAll('.kb-row-title')].map((el) => el.textContent.trim()),
      }
    }
    row.scrollIntoView({ block: 'center' })
    row.click()
    return { found: true, title: row.querySelector('.kb-row-title')?.textContent?.trim() ?? '' }
  })()`)
  assert(found?.found, 'click row ' + filename, found)
}

async function clickVisibilitySave() {
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      /保存可见范围和生效时间/.test(b.textContent || ''),
    )
    if (!btn) throw new Error('missing visibility save')
    btn.scrollIntoView({ block: 'center' })
    btn.click()
    return true
  })()`)
}

async function main() {
  if (!DEMO_PASS) throw new Error('missing T030_DEMO_PASS')
  await mkdir(OUT_DIR, { recursive: true })
  const userData = await mkdtemp(path.join(os.tmpdir(), 't030-chrome-'))
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
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      const item = pending.get(msg.id)
      pending.delete(msg.id)
      clearTimeout(item.timer)
      item.resolve(msg.result)
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

  async function goto(url) {
    const nav = send('Page.navigate', { url })
    await Promise.race([send('Page.loadEventFired').catch(() => null), delay(3000)])
    await nav
  }

  const evidence = {
    mock: true,
    base: BASE,
    viewport: '1440x900',
    cdpPort: CDP_PORT,
    chrome: version.Browser,
    userDataDir: userData,
    demoUser: DEMO_USER,
    steps: {},
    failed: [],
  }

  try {
    const health = await fetch(BASE)
    evidence.viteStatus = health.status
    evidence.viteUrl = BASE
    assert(health.status === 200, 'vite HTTP 200', health.status)

    await goto(`${BASE}/login`)
    await waitFor(`document.querySelector('.login-card')`)
    await evaluate(fillScript('#user', DEMO_USER))
    await evaluate(fillScript('#pass', DEMO_PASS))
    await evaluate(`document.querySelector('button[type="submit"]').click()`)
    await waitFor(`location.pathname !== '/login'`, 8000)
    const afterLogin = await evaluate(`({
      pathname: location.pathname,
      user: document.querySelector('.session .user')?.textContent ?? null,
    })`)
    evidence.steps.login = afterLogin
    assert(afterLogin.pathname === '/knowledge' || afterLogin.pathname === '/', 'admin lands knowledge', afterLogin)

    if (afterLogin.pathname !== '/knowledge') {
      await evaluate(`([...document.querySelectorAll('.sidebar a')].find((a) => a.textContent.trim() === '知识库') || { click() {} }).click()`)
      await waitFor(`location.pathname === '/knowledge'`)
    }

    await waitFor(`document.querySelectorAll('.kb-row').length > 0`)
    const list = await evaluate(`(() => {
      return [...document.querySelectorAll('.kb-row')].map((row) => ({
        filename: row.querySelector('.kb-row-title')?.textContent?.trim() ?? '',
        status: (row.querySelector('.kb-row-status')?.textContent || row.textContent).replace(/\\s+/g, ' ').trim(),
      }))
    })()`)
    evidence.steps.list = list
    await screenshot('t030-list.png')

    await clickRow(TARGET_READY)
    await waitFor(`document.querySelector('input[name="kb-visibility"]')`)
    await evaluate(`document.querySelector('.kb-visibility')?.scrollIntoView({ block: 'center' })`)
    const readyEditor = await evaluate(collectEditor)
    evidence.steps.readyEditor = readyEditor
    await screenshot('t030-ready-editor.png')
    try {
      assert(readyEditor.hasEditor, 'ready doc has visibility editor')
      assert(readyEditor.radioLabels.includes('用户可见'), 'label 用户可见', readyEditor.radioLabels)
      assert(readyEditor.radioLabels.includes('仅坐席可见'), 'label 仅坐席可见', readyEditor.radioLabels)
      assert(readyEditor.radioLabels.includes('高风险仅人工'), 'label 高风险仅人工', readyEditor.radioLabels)
      assert(!readyEditor.detailHasEnum, 'no enum codes in detail', readyEditor)
      assert(readyEditor.saveClass?.includes('btn-secondary'), 'visibility save is secondary', readyEditor.saveClass)
      assert(readyEditor.tagSaveClass?.includes('btn-primary'), 'tag save remains primary', readyEditor.tagSaveClass)
      assert(readyEditor.saveBg !== readyEditor.tagSaveBg, 'secondary not same as primary bg', {
        saveBg: readyEditor.saveBg,
        tagSaveBg: readyEditor.tagSaveBg,
      })
      assert(readyEditor.detailHasMock, '[Mock] on ready detail')
      assert(readyEditor.hint.some((text) => text.includes('[Mock]')), '[Mock] on visibility hint', readyEditor.hint)
    } catch (err) {
      evidence.failed.push({ id: 'TC-labels-ui04', error: String(err.message) })
    }

    await evaluate(`(() => {
      const radio = [...document.querySelectorAll('input[name="kb-visibility"]')].find((el) => el.value === 'agent_only')
      if (!radio) throw new Error('missing agent_only')
      radio.click()
      return true
    })()`)
    await evaluate(fillScript('input[aria-label="生效开始时间"]', FROM_VALUE))
    await evaluate(fillScript('input[aria-label="生效结束时间"]', TO_VALUE))
    const beforeSave = await evaluate(collectEditor)
    evidence.steps.beforeSave = {
      checkedLabel: beforeSave.checkedLabel,
      from: beforeSave.from,
      to: beforeSave.to,
    }
    await clickVisibilitySave()
    await waitFor(`(document.body.innerText || '').includes('已保存')`, 8000)
    const afterSave = await evaluate(collectEditor)
    evidence.steps.afterSave = {
      checkedLabel: afterSave.checkedLabel,
      from: afterSave.from,
      to: afterSave.to,
      saveMessage: afterSave.saveMessage,
      saveError: afterSave.saveError,
    }
    await screenshot('t030-after-save.png')
    try {
      assert(afterSave.checkedLabel === '仅坐席可见', 'saved 仅坐席可见', afterSave.checkedLabel)
      assert(afterSave.from === FROM_VALUE, 'saved from', afterSave.from)
      assert(afterSave.to === TO_VALUE, 'saved to', afterSave.to)
    } catch (err) {
      evidence.failed.push({ id: 'TC-save', error: String(err.message) })
    }

    await clickRow(OTHER_READY)
    await waitFor(`document.querySelector('input[name="kb-visibility"]')`)
    const otherDoc = await evaluate(collectEditor)
    evidence.steps.leftToOther = {
      checkedLabel: otherDoc.checkedLabel,
      from: otherDoc.from,
      to: otherDoc.to,
    }
    await clickRow(TARGET_READY)
    await waitFor(`document.querySelector('input[name="kb-visibility"]')`)
    const reopened = await evaluate(collectEditor)
    evidence.steps.reopened = {
      checkedLabel: reopened.checkedLabel,
      from: reopened.from,
      to: reopened.to,
    }
    await screenshot('t030-reopen.png')
    try {
      assert(reopened.checkedLabel === '仅坐席可见', 'reopen visibility', reopened.checkedLabel)
      assert(reopened.from === FROM_VALUE, 'reopen from', reopened.from)
      assert(reopened.to === TO_VALUE, 'reopen to', reopened.to)
    } catch (err) {
      evidence.failed.push({ id: 'TC-reopen', error: String(err.message) })
    }

    await send('Page.reload', { ignoreCache: true })
    await Promise.race([send('Page.loadEventFired').catch(() => null), delay(4000)])
    await waitFor(`document.querySelectorAll('.kb-row').length > 0`, 8000)
    await clickRow(TARGET_READY)
    await waitFor(`document.querySelector('input[name="kb-visibility"]')`)
    const afterReload = await evaluate(collectEditor)
    evidence.steps.afterReload = {
      checkedLabel: afterReload.checkedLabel,
      from: afterReload.from,
      to: afterReload.to,
    }
    await screenshot('t030-reload.png')
    try {
      assert(afterReload.checkedLabel === '仅坐席可见', 'reload visibility', afterReload.checkedLabel)
      assert(afterReload.from === FROM_VALUE, 'reload from', afterReload.from)
      assert(afterReload.to === TO_VALUE, 'reload to', afterReload.to)
    } catch (err) {
      evidence.failed.push({ id: 'TC-reload', error: String(err.message) })
    }

    await evaluate(fillScript('input[aria-label="生效开始时间"]', ''))
    await evaluate(fillScript('input[aria-label="生效结束时间"]', ''))
    await clickVisibilitySave()
    await waitFor(`(document.body.innerText || '').includes('已保存')`, 8000)
    const afterClear = await evaluate(collectEditor)
    evidence.steps.afterClear = {
      checkedLabel: afterClear.checkedLabel,
      from: afterClear.from,
      to: afterClear.to,
      saveError: afterClear.saveError,
    }
    await screenshot('t030-cleared.png')
    await clickRow(OTHER_READY)
    await waitFor(`document.querySelector('input[name="kb-visibility"]')`)
    await clickRow(TARGET_READY)
    await waitFor(`document.querySelector('input[name="kb-visibility"]')`)
    const clearedReopen = await evaluate(collectEditor)
    evidence.steps.clearedReopen = {
      checkedLabel: clearedReopen.checkedLabel,
      from: clearedReopen.from,
      to: clearedReopen.to,
    }
    await screenshot('t030-cleared-reopen.png')
    try {
      assert(clearedReopen.from === '', 'cleared from empty', clearedReopen.from)
      assert(clearedReopen.to === '', 'cleared to empty', clearedReopen.to)
      assert(clearedReopen.checkedLabel === '仅坐席可见', 'visibility kept after clearing times', clearedReopen.checkedLabel)
    } catch (err) {
      evidence.failed.push({ id: 'TC-clear', error: String(err.message) })
    }

    await clickRow(INGESTING)
    await waitFor(`(document.querySelector('.kb-detail')?.innerText || '').includes('入库中')`)
    const ingesting = await evaluate(collectEditor)
    evidence.steps.ingesting = ingesting
    await screenshot('t030-ingesting.png')
    try {
      assert(!ingesting.hasEditor, 'ingesting has no editor')
      assert(ingesting.datetimeCount === 0, 'ingesting no datetime', ingesting.datetimeCount)
      assert(!ingesting.saveText, 'ingesting no visibility save')
      assert(/可见范围或生效时间/.test(ingesting.ingestHint || ''), 'ingesting copy mentions visibility', ingesting.ingestHint)
    } catch (err) {
      evidence.failed.push({ id: 'TC-ingesting', error: String(err.message) })
    }
  } finally {
    await writeFile(
      path.join(OUT_DIR, 't030-browser-evidence.json'),
      JSON.stringify(evidence, null, 2),
      'utf8',
    )
    try {
      ws?.close()
    } catch {
      // ignore
    }
    if (chromeProc?.pid) {
      try {
        process.kill(chromeProc.pid)
      } catch {
        // ignore
      }
    }
  }

  if (evidence.failed.length) {
    console.error(JSON.stringify({ ok: false, failed: evidence.failed, steps: evidence.steps }, null, 2))
    process.exit(1)
  }
  console.log(JSON.stringify({ ok: true, steps: evidence.steps }, null, 2))
}

main().catch((err) => {
  console.error(String(err && err.stack ? err.stack : err))
  try {
    if (chromeProc?.pid) process.kill(chromeProc.pid)
  } catch {
    // ignore
  }
  process.exit(1)
})
