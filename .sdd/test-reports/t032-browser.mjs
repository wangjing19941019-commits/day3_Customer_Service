import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const BASE = process.env.T032_BASE || 'http://127.0.0.1:5216'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT_DIR = path.resolve(
  'C:\\Users\\慈海客服\\Desktop\\demo\\Develop_Helper\\Projects_Repo\\Customer_Service\\.sdd\\test-reports',
)
const CDP_PORT = Number(process.env.T032_CDP_PORT || 9462)
const DEMO_USER = process.env.T032_DEMO_USER || 'it-help'
const DEMO_PASS = process.env.T032_DEMO_PASS || ''
const NO_TICKET = '目前没有可查询的工单进度。'
const FAQ_ANSWER = '开具增值税发票请提供公司抬头与税号'
const SMALL_TALK = '可以问商品规格、退换货或发票规则'
const ORDER_NO = 'AP20260921011'
const PRODUCT = '连衣裙'
const EXPECTED_WITH_TICKET = `仓储已完成收货核验。订单 ${ORDER_NO}，${PRODUCT} 的退货退款正在处理中，尚未到账。`

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
    return el.value.length;
  })()`
}

function assert(cond, label, extra) {
  if (!cond) {
    const detail = extra === undefined ? '' : ` ${JSON.stringify(extra)}`
    throw new Error(`ASSERT FAIL: ${label}${detail}`)
  }
}

const collectChat = `(() => {
  const status = document.querySelector('.employee-status-text');
  const transfer = [...document.querySelectorAll('.employee-status button')].at(0);
  const bodyText = document.body.innerText || '';
  const msgs = [...document.querySelectorAll('.chat-msg')].map((n) => {
    const tagEl = n.querySelector('.chat-msg-tag');
    const bubble = n.querySelector('.chat-bubble');
    const tagCs = tagEl ? getComputedStyle(tagEl) : null;
    const bubbleCs = bubble ? getComputedStyle(bubble) : null;
    return {
      side: n.classList.contains('employee') ? 'employee' : 'other',
      tag: tagEl?.textContent ?? null,
      text: bubble?.textContent ?? '',
      rewrite: n.querySelector('.chat-rewrite')?.textContent ?? null,
      alignSelf: getComputedStyle(n).alignSelf,
      tagFontSize: tagCs?.fontSize ?? null,
      tagLineHeight: tagCs?.lineHeight ?? null,
      tagColor: tagCs?.color ?? null,
      bubbleBg: bubbleCs?.backgroundColor ?? null,
      bubbleColor: bubbleCs?.color ?? null,
    };
  });
  const progress = msgs.filter((m) => m.tag === '进度说明');
  return {
    href: location.href,
    pathname: location.pathname,
    statusText: status?.textContent ?? null,
    transferText: transfer?.textContent?.trim() ?? null,
    transferDisabled: transfer ? transfer.disabled : null,
    pageHasMock: bodyText.includes('[Mock]'),
    pageHasEnum: bodyText.includes('ticket_progress'),
    bodyHasArrived: /已到账|已经到账|到账成功/.test(bodyText),
    bodyHasFaqAnswer: bodyText.includes(${JSON.stringify(FAQ_ANSWER)}),
    bodyHasSmallTalk: bodyText.includes(${JSON.stringify(SMALL_TALK)}),
    messageCount: msgs.length,
    messages: msgs,
    systemTags: msgs.filter((m) => m.side === 'other').map((m) => m.tag),
    otherCount: msgs.filter((m) => m.side === 'other').length,
    lastEmployee: msgs.filter((m) => m.side === 'employee').at(-1) ?? null,
    lastOther: msgs.filter((m) => m.side === 'other').at(-1) ?? null,
    progress,
    lastProgress: progress.at(-1) ?? null,
    conversationId: sessionStorage.getItem('conversation_id'),
    topbarUser: document.querySelector('.session .user')?.textContent ?? null,
  };
})()`

async function sendChat(text) {
  const before = await evaluate(`document.querySelectorAll('.chat-msg').length`)
  await evaluate(fillScript('.employee-composer textarea', text))
  await evaluate(`document.querySelector('.employee-composer button[type="submit"]').click()`)
  await waitFor(`document.querySelectorAll('.chat-msg').length > ${before}`)
  await waitFor(
    `document.querySelector('.employee-composer textarea') && !document.querySelector('.employee-composer textarea').disabled`,
  )
  return evaluate(collectChat)
}

async function main() {
  if (!DEMO_PASS) {
    throw new Error('missing T032_DEMO_PASS')
  }
  await mkdir(OUT_DIR, { recursive: true })
  const userData = await mkdtemp(path.join(os.tmpdir(), 't032-chrome-'))
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

  async function goto(url) {
    const nav = send('Page.navigate', { url })
    await Promise.race([send('Page.loadEventFired').catch(() => null), delay(3000)])
    await nav
  }

  const evidence = {
    mock: true,
    task: 'T-032',
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

    const flagSource = await fetch(`${BASE}/src/utils/mockFlag.ts`)
    const flagText = await flagSource.text()
    evidence.viteUseMock = /"VITE_USE_MOCK":\s*"true"/.test(flagText)
    assert(evidence.viteUseMock, 'VITE_USE_MOCK true on 5216')

    await goto(`${BASE}/employee`)
    await waitFor(`document.querySelector('.login-card') || document.querySelector('.employee-chat')`)
    const onLogin = await evaluate(`Boolean(document.querySelector('.login-card'))`)
    evidence.landedOnLogin = onLogin
    if (onLogin) {
      await evaluate(fillScript('#user', DEMO_USER))
      await evaluate(fillScript('#pass', DEMO_PASS))
      await evaluate(`document.querySelector('button[type="submit"]').click()`)
    }
    await waitFor(`document.querySelector('.employee-chat') && location.pathname === '/employee'`)
    await waitFor(
      `document.querySelector('.employee-empty') && document.querySelector('.employee-empty').textContent.includes('购物问题')`,
    )

    await evaluate(`document.querySelector('.employee-status button').click()`)
    await waitFor(
      `document.querySelector('.employee-status-text') && document.querySelector('.employee-status-text').textContent.includes('已转人工')`,
    )
    const handed = await evaluate(collectChat)
    evidence.steps.handoff = {
      statusText: handed.statusText,
      transferText: handed.transferText,
      transferDisabled: handed.transferDisabled,
      otherCount: handed.otherCount,
      conversationId: handed.conversationId,
      topbarUser: handed.topbarUser,
    }
    try {
      assert(handed.statusText?.includes('已转人工，等待客服'), 'handoff status', handed.statusText)
      assert(handed.transferDisabled === true, 'transfer disabled')
      assert(handed.topbarUser?.includes('it-help'), 'logged in it-help', handed.topbarUser)
      assert(Boolean(handed.conversationId), 'conversation_id stored')
    } catch (err) {
      evidence.failed.push({ id: 'TC-setup', error: String(err.message) })
    }

    const faq = await sendChat('怎么开发票')
    evidence.steps.ordinaryFaq = {
      lastEmployee: faq.lastEmployee,
      lastOther: faq.lastOther,
      otherCount: faq.otherCount,
      systemTags: faq.systemTags,
      bodyHasFaqAnswer: faq.bodyHasFaqAnswer,
    }
    try {
      assert(faq.lastEmployee?.text?.includes('怎么开发票'), 'FAQ question visible')
      assert(faq.otherCount === 0, 'no system bubble after FAQ', {
        otherCount: faq.otherCount,
        tags: faq.systemTags,
        lastOther: faq.lastOther,
      })
      assert(!faq.bodyHasFaqAnswer, 'no FAQ auto answer after handoff')
      assert(!faq.systemTags.includes('FAQ'), 'no FAQ tag')
    } catch (err) {
      evidence.failed.push({ id: 'TC-03a', error: String(err.message) })
    }

    const hi = await sendChat('你好')
    evidence.steps.ordinaryHi = {
      lastEmployee: hi.lastEmployee,
      lastOther: hi.lastOther,
      otherCount: hi.otherCount,
      systemTags: hi.systemTags,
      bodyHasSmallTalk: hi.bodyHasSmallTalk,
    }
    await screenshot('t032-ordinary.png')
    try {
      assert(hi.lastEmployee?.text?.includes('你好'), 'small-talk question visible')
      assert(hi.otherCount === 0, 'still no system auto-reply', {
        otherCount: hi.otherCount,
        tags: hi.systemTags,
      })
      assert(!hi.bodyHasSmallTalk, 'no small-talk auto answer')
      assert(!hi.systemTags.includes('闲聊') && !hi.systemTags.includes('FAQ') && !hi.systemTags.includes('知识问答'), 'no AI/FAQ tags')
    } catch (err) {
      evidence.failed.push({ id: 'TC-03b', error: String(err.message) })
    }

    const none = await sendChat('我的退款到哪了')
    evidence.steps.noTicket = {
      lastEmployee: none.lastEmployee,
      lastProgress: none.lastProgress,
      lastOther: none.lastOther,
      systemTags: none.systemTags,
      pageHasEnum: none.pageHasEnum,
      bodyHasArrived: none.bodyHasArrived,
      pageHasMock: none.pageHasMock,
    }
    await screenshot('t032-no-ticket.png')
    try {
      assert(none.lastEmployee?.text?.includes('我的退款到哪了'), 'progress question visible')
      assert(none.lastProgress?.tag === '进度说明', 'no-ticket tag 进度说明', none.lastProgress)
      assert(
        none.lastProgress?.text?.includes(NO_TICKET),
        'no-ticket copy',
        none.lastProgress?.text,
      )
      assert(none.lastProgress?.text?.includes('[Mock]'), 'no-ticket [Mock]', none.lastProgress?.text)
      assert(!none.pageHasEnum, 'no internal enum ticket_progress on page')
      assert(!none.bodyHasArrived, 'no fabricated arrival')
      assert(!/已到账|已经到账/.test(none.lastProgress?.text || ''), 'progress text no fake arrival')
      assert(none.lastProgress?.alignSelf === 'flex-start', 'progress left aligned')
      assert(none.lastProgress?.tagFontSize === '12px', 'tag 12px', none.lastProgress?.tagFontSize)
      assert(none.lastProgress?.tagLineHeight === '18px', 'tag 18px line', none.lastProgress?.tagLineHeight)
      assert(none.lastProgress?.tagColor === 'rgb(92, 107, 122)', 'tag TextMuted', none.lastProgress?.tagColor)
      assert(
        none.lastProgress?.bubbleBg === 'rgb(232, 241, 250)',
        'system bubble PrimarySubtle',
        none.lastProgress?.bubbleBg,
      )
    } catch (err) {
      evidence.failed.push({ id: 'TC-01', error: String(err.message) })
    }

    const seeded = await evaluate(`(() => {
      const cid = sessionStorage.getItem('conversation_id');
      if (!cid) throw new Error('missing conversation_id');
      const now = new Date().toISOString();
      const ticket = {
        id: 'tkt_t032_seed',
        conversation_id: cid,
        status: 'in_progress',
        ticket_no: 'TKT-20260923-0001',
        ticket_type: 'return_exchange',
        business_line: 'apparel_beauty',
        fields: {
          order_no: { value: ${JSON.stringify(ORDER_NO)}, status: 'filled', candidates: [], conflict_value: null },
          product_info: { value: ${JSON.stringify(PRODUCT)}, status: 'filled', candidates: [], conflict_value: null },
        },
        confirmed_at: now,
        created_at: now,
        updated_at: now,
      };
      const store = {};
      store[cid] = ticket;
      sessionStorage.setItem('mock_tickets', JSON.stringify(store));
      return { conversationId: cid, status: ticket.status, ticket_type: ticket.ticket_type };
    })()`)
    evidence.steps.seedTicket = seeded

    await waitFor(
      `([...document.querySelectorAll('.chat-msg-tag')].some((el) => el.textContent === '进度说明') && document.body.innerText.includes(${JSON.stringify(ORDER_NO)}))`,
      10000,
    )
    const written = await evaluate(collectChat)
    evidence.steps.writtenProgress = {
      lastProgress: written.lastProgress,
      progressCount: written.progress.length,
      progressTexts: written.progress.map((m) => m.text),
      pageHasEnum: written.pageHasEnum,
    }
    await screenshot('t032-with-ticket.png')
    try {
      assert(written.progress.length >= 2, 'writeback adds progress bubble', {
        count: written.progress.length,
        texts: written.progress.map((m) => m.text),
      })
      assert(
        written.lastProgress?.text?.includes(ORDER_NO) && written.lastProgress?.text?.includes(PRODUCT),
        'writeback has order and product',
        written.lastProgress?.text,
      )
      assert(
        written.lastProgress?.text?.includes(EXPECTED_WITH_TICKET) ||
          written.lastProgress?.text?.includes('退货退款正在处理中，尚未到账'),
        'writeback matches ticket fields',
        written.lastProgress?.text,
      )
      assert(written.lastProgress?.tag === '进度说明', 'writeback tag 进度说明')
      assert(written.lastProgress?.text?.includes('[Mock]'), 'writeback [Mock]')
      assert(!written.pageHasEnum, 'still no enum name')
    } catch (err) {
      evidence.failed.push({ id: 'TC-02a', error: String(err.message) })
    }

    const asked = await sendChat('我的退款到哪了')
    evidence.steps.askWithTicket = {
      lastEmployee: asked.lastEmployee,
      lastProgress: asked.lastProgress,
      progressCount: asked.progress.length,
      progressTexts: asked.progress.map((m) => m.text),
      systemTags: asked.systemTags,
    }
    await screenshot('t032-ask-with-ticket.png')
    try {
      assert(asked.lastEmployee?.text?.includes('我的退款到哪了'), 'ask again visible')
      assert(asked.lastProgress?.tag === '进度说明', 'ask-with-ticket tag')
      assert(
        asked.lastProgress?.text?.includes(ORDER_NO) && asked.lastProgress?.text?.includes(PRODUCT),
        'ask reply has order/product',
        asked.lastProgress?.text,
      )
      assert(
        asked.lastProgress?.text?.includes('尚未到账'),
        'ask reply states not arrived from ticket',
        asked.lastProgress?.text,
      )
      assert(!asked.lastProgress?.text?.includes('已到账'), 'ask reply not fabricated arrived')
      assert(
        asked.lastProgress?.text?.includes(written.lastProgress?.text?.replace('[Mock] ', '') || '___none___') ||
          asked.lastProgress?.text === written.lastProgress?.text,
        'ask reply matches writeback progress',
        { asked: asked.lastProgress?.text, written: written.lastProgress?.text },
      )
    } catch (err) {
      evidence.failed.push({ id: 'TC-02b', error: String(err.message) })
    }

    const after = await sendChat('这件连衣裙能退吗')
    evidence.steps.ordinaryAfter = {
      lastEmployee: after.lastEmployee,
      lastOther: after.lastOther,
      systemTags: after.systemTags,
      otherCount: after.otherCount,
      progressCount: after.progress.length,
      bodyHasKnowledge: (after.messages || []).some((m) => (m.text || '').includes('七天无理由')),
    }
    try {
      assert(after.lastEmployee?.text?.includes('这件连衣裙能退吗'), 'knowledge-like question visible')
      assert(!after.systemTags.includes('知识问答'), 'no knowledge auto after handoff', after.systemTags)
      assert(!after.systemTags.includes('FAQ'), 'no FAQ after later ordinary', after.systemTags)
      assert(!evidence.steps.ordinaryAfter.bodyHasKnowledge, 'no knowledge copy auto-reply')
      const extraSystem = after.otherCount - asked.otherCount
      assert(extraSystem === 0, 'ordinary question adds no new system bubble', {
        before: asked.otherCount,
        after: after.otherCount,
        lastOther: after.lastOther,
      })
    } catch (err) {
      evidence.failed.push({ id: 'TC-03c', error: String(err.message) })
    }

    evidence.pass = evidence.failed.length === 0
    await writeFile(path.join(OUT_DIR, 't032-browser-evidence.json'), JSON.stringify(evidence, null, 2))
    console.log(JSON.stringify({ pass: evidence.pass, failed: evidence.failed, cdpPort: CDP_PORT, base: BASE }, null, 2))
    if (!evidence.pass) process.exitCode = 1
  } finally {
    try {
      if (ws) ws.close()
    } catch {}
    if (chromeProc && !chromeProc.killed) chromeProc.kill()
  }
}

main().catch(async (err) => {
  console.error(String(err && err.stack ? err.stack : err))
  try {
    await writeFile(
      path.join(OUT_DIR, 't032-browser-evidence.json'),
      JSON.stringify({ pass: false, error: String(err && err.message ? err.message : err) }, null, 2),
    )
  } catch {}
  try {
    if (ws) ws.close()
  } catch {}
  if (chromeProc && !chromeProc.killed) chromeProc.kill()
  process.exit(1)
})
