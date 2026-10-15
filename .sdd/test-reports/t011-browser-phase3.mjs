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
const CDP_PORT = 9388
const MD_NAME = 't011-helix-vpn.md'
const STAY_NAME = 't011-stay-ingesting.md'
const FAQ_QUESTION = 'T011HELIX 重置 VPN 密码的要点是什么'
const FAQ_ANSWER = 'T011HELIX-FAQ-NEW 先在账号中心完成手机验证，再重新导入公司 VPN 配置文件。'
const OLD_FAQ_Q = 'T011Helix VPN 密码重置流程是什么？'
const STAY_MD = `# T011STAY

T011STAY 用于离开再回来时仍显示入库中。
${'丁'.repeat(800)}
`

const readyDocs = JSON.parse(await readFile(path.join(OUT_DIR, 't011-ready-docs.json'), 'utf8'))
const mdDoc = readyDocs.find((d) => d.filename === MD_NAME)

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
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeoutMs)
  if (result.exceptionDetails) {
    throw new Error(`eval failed: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`)
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
    return {
      filename,
      hint,
      status: (hint.match(statusRe) || [''])[0],
      selected: row.classList.contains('selected'),
    };
  });
  const detail = document.querySelector('.kb-detail');
  return {
    pageHasMock: (document.body.innerText || '').includes('[Mock]'),
    rows,
    filenames: rows.map((r) => r.filename),
    statuses: rows.map((r) => r.status),
    selected: rows.find((r) => r.selected)?.filename ?? null,
    detailText: (detail?.innerText || '').replace(/\\s+/g, ' ').trim(),
    hasChunks: document.querySelectorAll('.kb-chunk').length,
    hasEditForm: Boolean(document.querySelector('.kb-edit')),
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
  return {
    conversationId: sessionStorage.getItem('conversation_id'),
    errorText: document.querySelector('.employee-composer-error')?.textContent ?? '',
    messageCount: msgs.length,
    lastOther: msgs.filter((m) => m.side === 'other').at(-1) ?? null,
    lastEmployee: msgs.filter((m) => m.side === 'employee').at(-1) ?? null,
    pageHasMock: (document.body.innerText || '').includes('[Mock]'),
    taDisabled: ta ? ta.disabled : null,
  };
})()`

async function clickNav(label) {
  await evaluate(`(() => {
    const a = [...document.querySelectorAll('.sidebar a')].find((el) => el.textContent.trim() === ${JSON.stringify(label)});
    if (!a) throw new Error('missing nav');
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

async function apiFetch(pathname, options = {}) {
  return evaluate(
    `(async () => {
      const token = localStorage.getItem('access_token');
      const res = await fetch(${JSON.stringify(pathname)}, {
        method: ${JSON.stringify(options.method || 'GET')},
        headers: Object.assign({ Authorization: 'Bearer ' + token }, ${options.body ? `{ 'Content-Type': 'application/json' }` : '{}'}),
        ${options.body ? `body: ${JSON.stringify(JSON.stringify(options.body))},` : ''}
      });
      let body = null;
      try { body = await res.json(); } catch {}
      return { status: res.status, body };
    })()`,
    options.timeoutMs || 20000,
  )
}

async function sendChat(text, timeoutMs = 90000) {
  await waitFor(`document.querySelector('.employee-composer textarea') && !document.querySelector('.employee-composer textarea').disabled`, 15000)
  await evaluate(`document.querySelector('.employee-composer textarea').focus()`)
  await evaluate(`(() => {
    const el = document.querySelector('.employee-composer textarea');
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await send('Input.insertText', { text })
  await waitFor(`(document.querySelector('.employee-composer textarea')?.value || '').length >= 4`, 5000)
  const before = await evaluate(collectChat)
  await evaluate(`document.querySelector('.employee-composer').requestSubmit()`)
  const start = Date.now()
  let last = before
  while (Date.now() - start < timeoutMs) {
    last = await evaluate(collectChat)
    const employeeSent = (last.lastEmployee?.text || '').includes(text.slice(0, 16))
    if (employeeSent && last.lastOther && last.messageCount > before.messageCount && !last.taDisabled) return last
    await delay(400)
  }
  return { ...last, timeout: true }
}

async function fillFocused(text) {
  await send('Input.insertText', { text })
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const evidence = { phase: 3, cdpPort: CDP_PORT, steps: {} }
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

  async function goto(url) {
    const nav = send('Page.navigate', { url })
    await Promise.race([send('Page.loadEventFired').catch(() => null), delay(3000)])
    await nav
  }

  await goto(`${BASE}/login`)
  await waitFor(`document.querySelector('#user')`, 8000)
  await evaluate(`(() => {
    const set = (sel, val) => {
      const el = document.querySelector(sel);
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      desc.set.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('#user', 'it-help');
    set('#pass', 'it-help123');
    document.querySelector('button[type="submit"]').click();
  })()`)
  await waitFor(`document.querySelector('.app')`, 10000)
  await clickNav('知识库')
  await waitFor(`document.querySelector('.kb-page')`, 8000)
  await waitFor(`[...document.querySelectorAll('.kb-row-title')].some((el) => el.textContent.includes(${JSON.stringify(MD_NAME)}))`, 8000)
  await clickRowIncludes(MD_NAME)
  await waitFor(`document.querySelector('.kb-edit') && [...document.querySelectorAll('.kb-check')].some((l) => l.textContent.includes('硬件设备') && l.querySelector('input')?.checked)`, 15000)
  const mdOpen = await evaluate(collectKb)
  evidence.mdOpen = { ...mdOpen, screenshot: await screenshot('t011-p3-md-hardware.png') }
  record('ac017-md-shows-hardware', mdOpen.selected === MD_NAME && mdOpen.objectChecked.some((n) => n.includes('硬件设备')), '硬件设备', { selected: mdOpen.selected, checked: mdOpen.objectChecked })

  for (let i = 0; i < 6; i += 1) {
    const faqCount = await evaluate(`document.querySelectorAll('.kb-faq').length`)
    if (faqCount <= 1) break
    await evaluate(`(() => {
      const btn = [...document.querySelectorAll('.kb-faq button')].find((b) => b.textContent.includes('删除 FAQ'));
      if (btn) btn.click();
      return true;
    })()`)
    await delay(200)
  }
  const faqCount = await evaluate(`document.querySelectorAll('.kb-faq').length`)
  if (!faqCount) {
    await evaluate(`(() => {
      const add = [...document.querySelectorAll('.kb-edit button')].find((b) => b.textContent.trim() === '添加 FAQ');
      if (add) add.click();
      return true;
    })()`)
    await delay(200)
  }
  await evaluate(`(() => {
    const q = document.querySelector('.kb-faq input');
    const a = document.querySelector('.kb-faq textarea');
    if (!q || !a) throw new Error('missing faq fields');
    const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const setArea = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setInput.call(q, ${JSON.stringify(FAQ_QUESTION)});
    q.dispatchEvent(new Event('input', { bubbles: true }));
    q.dispatchEvent(new Event('change', { bubbles: true }));
    setArea.call(a, ${JSON.stringify(FAQ_ANSWER)});
    a.dispatchEvent(new Event('input', { bubbles: true }));
    a.dispatchEvent(new Event('change', { bubbles: true }));
    return { q: q.value, a: a.value };
  })()`)
  const beforeSave = await evaluate(collectKb)
  evidence.faqDraft = { q: beforeSave.faqQuestions, a: beforeSave.faqAnswers }
  await evaluate(`document.querySelector('.kb-edit button[type="submit"]').click()`)
  await waitFor(`(document.body.innerText || '').includes('已保存，将立即用于后续提问')`, 20000)
  const afterSave = await evaluate(collectKb)
  const apiAfter = await apiFetch(`/api/documents/${mdDoc.id}`)
  evidence.faqSaved = { questions: afterSave.faqQuestions, answers: afterSave.faqAnswers, api: (apiAfter.body?.data?.faqs || []).map((f) => ({ q: f.question, a: f.answer })), screenshot: await screenshot('t011-p3-faq-saved.png') }
  record(
    'ac018-page-shows-new-faq',
    afterSave.faqQuestions.some((q) => q.includes('T011HELIX 重置 VPN')) &&
      (afterSave.faqAnswers.some((a) => a.includes('T011HELIX-FAQ-NEW')) || (apiAfter.body?.data?.faqs || []).some((f) => String(f.answer).includes('T011HELIX-FAQ-NEW'))),
    FAQ_QUESTION,
    { questions: afterSave.faqQuestions, answers: afterSave.faqAnswers, api: evidence.faqSaved.api },
  )

  await clickNav('员工端')
  await waitFor(`location.pathname === '/employee'`, 8000)
  const newFaqAsk = await sendChat(FAQ_QUESTION)
  evidence.newFaqAsk = newFaqAsk
  record(
    'ac018-new-faq-hit',
    /FAQ/.test(String(newFaqAsk.lastOther?.tag || '')) && /T011HELIX-FAQ-NEW/.test(String(newFaqAsk.lastOther?.text || '')),
    { tag: 'FAQ', token: 'T011HELIX-FAQ-NEW' },
    { tag: newFaqAsk.lastOther?.tag, text: newFaqAsk.lastOther?.text, timeout: newFaqAsk.timeout },
  )
  const oldFaqAsk = await sendChat(OLD_FAQ_Q)
  evidence.oldFaqAsk = oldFaqAsk
  record(
    'ac018-old-faq-not-hit',
    oldFaqAsk.timeout !== true &&
      !(/FAQ/.test(String(oldFaqAsk.lastOther?.tag || '')) && String(oldFaqAsk.lastOther?.text || '').includes('等待一分钟')),
    { notOldFaqAnswer: true },
    { tag: oldFaqAsk.lastOther?.tag, text: oldFaqAsk.lastOther?.text, timeout: oldFaqAsk.timeout },
  )

  await clickNav('知识库')
  await waitFor(`document.querySelector('.kb-page')`, 8000)
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('.kb-filter-btn')].find((el) => el.textContent.trim() === '全部');
    btn && btn.click();
  })()`)
  await waitFor(`document.querySelector('#kb-file')`, 5000)
  await evaluate(`(() => {
    const input = document.querySelector('#kb-file');
    const file = new File([${JSON.stringify(STAY_MD)}], ${JSON.stringify(STAY_NAME)}, { type: 'text/markdown' });
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('.kb-upload button[type="submit"]').click();
  })()`)
  await waitFor(`[...document.querySelectorAll('.kb-row-title')].some((el) => el.textContent.includes(${JSON.stringify(STAY_NAME)}))`, 8000)
  await clickRowIncludes(STAY_NAME)
  await waitFor(`(document.querySelector('.kb-detail')?.innerText || '').includes('正在入库中')`, 8000)
  const ingestingView = await evaluate(collectKb)
  evidence.stayIngesting = { ...ingestingView, screenshot: await screenshot('t011-p3-stay-ingesting.png') }
  record(
    'ac023-ingesting-hint-no-edit',
    ingestingView.selected === STAY_NAME &&
      ingestingView.statuses[ingestingView.filenames.indexOf(STAY_NAME)] === '入库中' &&
      ingestingView.hasChunks === 0 &&
      ingestingView.hasEditForm === false &&
      ingestingView.detailText.includes('正在入库中'),
    { hint: '正在入库中', noEdit: true },
    { selected: ingestingView.selected, status: ingestingView.statuses[ingestingView.filenames.indexOf(STAY_NAME)], chunks: ingestingView.hasChunks, edit: ingestingView.hasEditForm, detail: ingestingView.detailText.slice(0, 80) },
  )

  await clickNav('员工端')
  await waitFor(`location.pathname === '/employee'`, 8000)
  await clickNav('知识库')
  await waitFor(`document.querySelector('.kb-page')`, 8000)
  await waitFor(`[...document.querySelectorAll('.kb-row-title')].some((el) => el.textContent.includes(${JSON.stringify(STAY_NAME)}))`, 8000)
  await clickRowIncludes(STAY_NAME)
  const back = await evaluate(collectKb)
  evidence.stayBack = { ...back, screenshot: await screenshot('t011-p3-stay-back.png') }
  const stay = back.rows.find((r) => r.filename === STAY_NAME)
  record(
    'ac023-leave-return-still-ingesting',
    Boolean(stay) && stay.status === '入库中' && back.hasEditForm === false && back.hasChunks === 0 && (back.detailText.includes('正在入库中') || stay.status === '入库中'),
    { stillIngesting: true, noEdit: true },
    { stay, selected: back.selected, chunks: back.hasChunks, edit: back.hasEditForm, detail: back.detailText.slice(0, 80) },
  )

  evidence.checks = checks
  evidence.failed = checks.filter((c) => !c.pass).map((c) => c.id)
  await writeFile(path.join(OUT_DIR, 't011-browser-phase3.json'), JSON.stringify(evidence, null, 2))
  console.log(`failed=${JSON.stringify(evidence.failed)}`)
  if (evidence.failed.length) process.exitCode = 1
}

main()
  .catch(async (err) => {
    console.error(err)
    try {
      await writeFile(path.join(OUT_DIR, 't011-browser-phase3.json'), JSON.stringify({ error: String(err), checks, failed: checks.filter((c) => !c.pass).map((c) => c.id) }, null, 2))
    } catch {}
    process.exitCode = 1
  })
  .finally(() => {
    try { ws?.close() } catch {}
    try { if (chromeProc?.pid) chromeProc.kill() } catch {}
  })
