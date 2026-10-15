const KEY = "cs_proto_v6";
const DEMO_USER = "it-help";
const DEMO_PASS = "it-help123";
const FALLBACK =
  "抱歉，这个问题我暂时无法根据现有知识准确回答。你可以换个说法再问，或点击转人工。";
const CHUNK_MAX_CHARS = 800;
const CHUNK_OVERLAP_CHARS = 160;
const CHUNK_RULE =
  "分块策略：所有格式先转为 Markdown；再按标题与段落切块；单块不超过 800 字，相邻块重叠 160 字（上限的 20%）；有标题时保留标题路径，没有标题则路径为空。";

const SAMPLE_VPN_MD = `# VPN 使用说明
## 连接失败
公司 VPN 认证失败时，先确认账号未被锁定，再检查是否使用了过期的配置文件。重新导入 IT 发放的 ovpn 文件后再登录。
若仍失败，不要反复尝试以免触发锁定，改为联系现场支持。
## 配置导入
Windows 打开客户端后选择导入配置，选择公司提供的文件。Mac 用户需先允许系统扩展。导入后配置名称应显示为公司标准名称。
## 常见报错
提示 TLS handshake failed 时，多半是网络拦截或证书过期。提示 authentication failed 时，优先重置密码而不是重装系统。
`;

const SAMPLE_WIFI_TXT = Array.from({ length: 12 }, (_, i) =>
  "步骤" +
  (i + 1) +
  "：办公区无线网络无法连接时，先确认电脑连的是公司办公网络，而不是访客网络或手机热点。关闭飞行模式后在系统设置里忘记该网络，再重新输入 IT 发放的密码。若仍失败，重启无线网卡并避开微波干扰，不要反复输错密码以免账号锁定。"
).join("");

function splitWithOverlap(text, max, overlap) {
  const t = text.trim();
  if (!t) return [];
  if (t.length <= max) return [t];
  const out = [];
  let start = 0;
  while (start < t.length) {
    const end = Math.min(start + max, t.length);
    out.push(t.slice(start, end));
    if (end >= t.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return out;
}

function chunkMarkdown(raw) {
  const text = String(raw || "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const sections = [];
  let path = [];
  let body = [];
  function currentPath() {
    return path.filter(Boolean).join(" / ");
  }
  function pushSection() {
    const content = body.join("\n").trim();
    body = [];
    if (!content && !currentPath()) return;
    const prefixed = currentPath() ? currentPath() + "\n" + content : content;
    splitWithOverlap(prefixed, CHUNK_MAX_CHARS, CHUNK_OVERLAP_CHARS).forEach((part) => {
      sections.push({ heading_path: currentPath(), content: part });
    });
  }
  lines.forEach((line) => {
    const m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) {
      pushSection();
      const level = m[1].length;
      path = path.slice(0, level - 1);
      path[level - 1] = m[2].trim();
      return;
    }
    body.push(line);
  });
  pushSection();
  return sections.map((c, i) => ({ position: i + 1, heading_path: c.heading_path, content: c.content }));
}

function fileExt(name) {
  const lower = String(name || "").toLowerCase();
  const i = lower.lastIndexOf(".");
  return i >= 0 ? lower.slice(i) : "";
}

function unescapePdfString(s) {
  return String(s)
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\")
    .replace(/\\\)/g, ")")
    .replace(/\\\(/g, "(");
}

function extractPdfText(buffer) {
  const bytes = new Uint8Array(buffer);
  let raw = "";
  for (let i = 0; i < bytes.length; i++) raw += String.fromCharCode(bytes[i]);
  const parts = [];
  const tjRe = /\(((?:\\.|[^\\)])*)\)\s*Tj/g;
  let m;
  while ((m = tjRe.exec(raw))) parts.push(unescapePdfString(m[1]));
  const arrRe = /\[([\s\S]*?)\]\s*TJ/g;
  while ((m = arrRe.exec(raw))) {
    const innerRe = /\(((?:\\.|[^\\)])*)\)/g;
    let im;
    while ((im = innerRe.exec(m[1]))) parts.push(unescapePdfString(im[1]));
  }
  return parts
    .join("")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toMarkdownFromSource(text) {
  return String(text || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .trim();
}


function load() {
  const raw = sessionStorage.getItem(KEY);
  if (raw) return JSON.parse(raw);
  return {
    loggedIn: false,
    username: "",
    conversation: { handedOff: false, unclear: 0, messages: [] },
    documents: [
      {
        id: "d2",
        name: "outlook.md",
        status: "ingesting",
        step: "chunk",
        tags: "",
        faqs: [],
        chunks: [],
        updated_at: "2026-09-14T04:12:00.000Z"
      },
      {
        id: "d1",
        name: "vpn-faq.md",
        status: "ready",
        tags: "网络与远程接入 · 故障与异常排查",
        faqs: [{ q: "VPN 提示认证失败怎么办", a: "先确认账号未锁定，再重装客户端配置文件。" }],
        chunks: chunkMarkdown(SAMPLE_VPN_MD),
        updated_at: "2026-09-13T10:00:00.000Z"
      },
      {
        id: "d4",
        name: "wifi-reset.txt",
        status: "ready",
        tags: "网络与远程接入 · 故障与异常排查",
        faqs: [{ q: "办公区无线连不上怎么办", a: "先确认连的是公司网络，忘记后重输密码。" }],
        chunks: chunkMarkdown(SAMPLE_WIFI_TXT),
        updated_at: "2026-09-13T08:00:00.000Z"
      },
      {
        id: "d3",
        name: "scan-only.pdf",
        status: "failed",
        tags: "",
        faqs: [],
        chunks: [],
        updated_at: "2026-09-12T08:00:00.000Z"
      }
    ]
  };
}

function save(state) {
  sessionStorage.setItem(KEY, JSON.stringify(state));
}

function stepLabel(step) {
  return { chunk: "正在转 Markdown 并分块", tag: "正在打标", faq: "正在抽取 FAQ" }[step] || "入库中";
}

function ingestProgressHtml(doc) {
  const steps = [
    ["chunk", "1. 转为 Markdown 并按标题和段落分块"],
    ["tag", "2. 按标签体系打标"],
    ["faq", "3. 抽取 FAQ"]
  ];
  const order = ["chunk", "tag", "faq"];
  const cur = order.indexOf(doc.step || "chunk");
  const items = steps
    .map(([key, label], i) => {
      const mark = i < cur ? "已完成" : i === cur ? "进行中" : "等待";
      return "<div>" + (i === cur ? "<strong>" : "") + label + " · " + mark + (i === cur ? "</strong>" : "") + "</div>";
    })
    .join("");
  return (
    CHUNK_RULE +
    "<br><br>当前：" +
    stepLabel(doc.step) +
    "。分块预览将在三步都完成后展示。<br><br>" +
    items
  );
}

function patchDoc(id, updater) {
  const cur = load();
  const doc = cur.documents.find((d) => d.id === id);
  if (!doc) return null;
  updater(doc);
  doc.updated_at = new Date().toISOString();
  save(cur);
  return cur;
}

function requireLogin() {
  const s = load();
  if (!s.loggedIn) {
    location.href = "../01-login/index.html";
    return null;
  }
  return s;
}

function mountSession(state) {
  const bar = document.querySelector(".topbar");
  if (!bar || bar.querySelector(".session")) return;
  const box = document.createElement("div");
  box.className = "session";
  box.innerHTML =
    '<span class="user">已登录：' +
    escapeHtml(state.username || DEMO_USER) +
    '</span><button class="btn btn-secondary" type="button" id="logout">退出</button>';
  bar.appendChild(box);
  document.getElementById("logout").addEventListener("click", () => {
    const s = load();
    s.loggedIn = false;
    s.username = "";
    save(s);
    location.href = "../01-login/index.html";
  });
}

function markNav(id) {
  document.querySelectorAll(".sidebar a").forEach((a) => {
    a.classList.toggle("active", a.dataset.page === id);
  });
}

function initLogin() {
  const s = load();
  if (s.loggedIn) {
    location.href = "../02-employee/index.html";
    return;
  }
  const form = document.getElementById("login-form");
  const err = document.getElementById("login-error");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const user = document.getElementById("user").value.trim();
    const pass = document.getElementById("pass").value;
    if (!user || !pass) {
      err.textContent = "请输入用户名和密码";
      return;
    }
    if (user !== DEMO_USER || pass !== DEMO_PASS) {
      err.textContent = "用户名或密码不正确";
      return;
    }
    s.loggedIn = true;
    s.username = user;
    save(s);
    location.href = "../02-employee/index.html";
  });
}

function renderMessages(box, conv) {
  box.innerHTML = "";
  if (!conv.messages.length) {
    box.innerHTML = '<div class="empty">描述你的购物问题</div>';
    return;
  }
  conv.messages.forEach((m) => {
    const el = document.createElement("div");
    el.className = "msg " + (m.role === "user" ? "user" : "bot");
    el.innerHTML =
      (m.tag ? '<div class="tag">' + m.tag + "</div>" : "") +
      '<div class="bubble">' +
      escapeHtml(m.text) +
      "</div>" +
      (m.rewrite ? '<div class="rewrite">改写为：' + escapeHtml(m.rewrite) + "</div>" : "");
    box.appendChild(el);
  });
  box.scrollTop = box.scrollHeight;
}

function escapeHtml(t) {
  return t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function replyFor(text, conv) {
  if (conv.handedOff) return null;
  const t = text.trim();
  if (/你好|谢谢|哈哈/.test(t)) return { tag: "闲聊", text: "你好，可以问商品规格、退换货或发票规则。" };
  if (/物流到哪|订单现在|库存还有|支付成功了没/.test(t)) return { tag: "兜底", text: FALLBACK };
  if (/连衣裙|七天|尺码/.test(t)) {
    conv.unclear = 0;
    return {
      tag: "知识问答",
      text: "服饰美妆在商品完好的前提下支持七天无理由退货。具体能否退，还要看是否穿过或影响二次销售。",
      rewrite: t.includes("能退") ? "询问该服饰商品是否支持退货" : t
    };
  }
  if (/耳机|保修|充电器/.test(t)) {
    conv.unclear = 0;
    return {
      tag: "知识问答",
      text: "3C 数码以签收后的质保说明为准，不适用服饰的七天无理由口径。",
      rewrite: t
    };
  }
  if (conv.unclear >= 5) {
    conv.unclear = 0;
    return { tag: "兜底", text: FALLBACK };
  }
  if (t.length < 8 || /能不能退|怎么办|不行/.test(t)) {
    conv.unclear += 1;
    return { tag: "反问", text: "请问是哪件商品？例如连衣裙、耳机，还是订单和发票问题。" };
  }
  conv.unclear = 0;
  return {
    tag: "知识问答",
    text: "1. 先按商品或售后类型核对是否在知识范围内。\n2. 实时订单、物流、库存或支付状态请转人工处理。",
    rewrite: t
  };
}

function initEmployee() {
  const s = requireLogin();
  if (!s) return;
  mountSession(s);
  markNav("employee");
  const conv = s.conversation;
  const box = document.getElementById("messages");
  const status = document.getElementById("status-text");
  const transferBtn = document.getElementById("transfer");
  const form = document.getElementById("composer");
  const input = document.getElementById("ask");

  function refresh() {
    status.textContent = conv.handedOff ? "已转人工，等待客服" : "AI 接待中";
    transferBtn.disabled = conv.handedOff;
    transferBtn.textContent = conv.handedOff ? "已转人工" : "转人工";
    renderMessages(box, conv);
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    const bot = replyFor(text, conv);
    conv.messages.push({
      role: "user",
      text,
      rewrite: conv.handedOff ? "" : bot && bot.rewrite ? bot.rewrite : ""
    });
    if (bot) conv.messages.push({ role: "bot", tag: bot.tag, text: bot.text });
    input.value = "";
    save(s);
    refresh();
  });

  transferBtn.addEventListener("click", () => {
    if (conv.handedOff) return;
    conv.handedOff = true;
    conv.messages.push({ role: "bot", tag: "系统", text: "已转交客服，后续消息将等待人工回复。" });
    save(s);
    refresh();
  });

  refresh();
}

function lastUserText(conv) {
  const msgs = (conv.messages || []).filter((m) => m.role === "user");
  return msgs.length ? msgs[msgs.length - 1].text : "电商咨询";
}

function userCorpus(conv) {
  return (conv.messages || [])
    .filter((m) => m.role === "user")
    .map((m) => m.text)
    .join(" ");
}

function ensureTicket(conv) {
  if (!conv.ticket) {
    conv.ticket = {
      status: "draft",
      ticket_type: "",
      business_line: "",
      extract_status: "idle",
      fields: {},
      agent_edited: {}
    };
  }
  return conv.ticket;
}

function ticketFieldsFor(type) {
  const common = [
    ["order_no", "订单号"],
    ["product", "商品信息"],
    ["amount", "相关金额"],
    ["summary", "用户诉求摘要"]
  ];
  if (type === "return_exchange") return common.concat([["return_method", "售后方式"], ["reason", "退换原因"], ["qty", "数量"]]);
  if (type === "address_change") return common.concat([["old_address", "原地址"], ["new_address", "新地址"], ["receiver", "收件人"], ["phone", "联系电话"]]);
  if (type === "invoice") return common.concat([["invoice_kind", "发票种类"], ["title", "抬头"], ["tax_id", "纳税人识别号"], ["contact", "接收邮箱或手机"]]);
  if (type === "complaint") return common.concat([["category", "投诉类别"], ["facts", "事实经过"], ["expect", "用户期望"], ["escalate", "是否要求升级"]]);
  return [];
}

function extractGuess(conv, type) {
  const text = userCorpus(conv);
  const out = {};
  ticketFieldsFor(type).forEach(([key]) => {
    out[key] = { value: "", state: "待补全" };
  });
  if (/连衣裙/.test(text)) out.product = { value: "连衣裙", state: "已提取" };
  if (/耳机/.test(text)) out.product = { value: "耳机", state: "已提取" };
  const order = text.match(/订单号?\s*([A-Za-z0-9-]{4,})/);
  if (order) out.order_no = { value: order[1], state: "已提取" };
  const money = text.match(/(\d+(?:\.\d+)?)\s*元/);
  if (money && out.amount) out.amount = { value: money[1] + " 元", state: "已提取" };
  if (/能退|退货|换货/.test(text) && out.reason) out.reason = { value: "用户询问退换", state: "已提取" };
  if (/地址/.test(text) && out.new_address && !/[\u4e00-\u9fa5]{6,}/.test(text.replace(/地址|改|修改/g, ""))) {
    out.new_address = { value: "", state: "待补全" };
  }
  if (out.summary) out.summary = { value: lastUserText(conv).slice(0, 40), state: "已提取" };
  return out;
}

function knowledgeFor(ticket) {
  if (!ticket.business_line) return { title: "知识推送", body: "未指定业务线，不套用单一口径。" };
  if (ticket.ticket_type === "return_exchange" && ticket.business_line === "fashion") {
    return { title: "服饰美妆七天无理由退货", body: "商品完好、不影响二次销售时可七天无理由退货。该口径不适用于 3C 质保。" };
  }
  if (ticket.ticket_type === "return_exchange" && ticket.business_line === "3c") {
    return { title: "3C 退换与质保", body: "以签收后的保修说明为准，不适用服饰七天无理由。" };
  }
  if (ticket.ticket_type === "complaint") {
    return { title: "当前没有可推送的政策", body: "知识库没有对应的投诉升级时限，请按会话说明下一步，不要编造时限。" };
  }
  if (ticket.business_line === "fashion") {
    return { title: "服饰美妆咨询", body: "优先核对尺码、材质与退换政策，不引用 3C 保修年限。" };
  }
  return { title: "3C 数码咨询", body: "优先核对规格、兼容与质保，不引用服饰七天无理由。" };
}

function polishText(raw) {
  const t = String(raw || "").trim();
  if (!t) return "";
  if (/全额退|一定退|赔付\d+/.test(t)) {
    return "您好，我先根据现有规则帮你核对处理方式，确认后才能说明具体结果。";
  }
  if (/^您好/.test(t)) return t;
  return "您好，" + t.replace(/。?$/, "。") + "如需继续办理，请补充订单号或收货信息。";
}

function initAgent() {
  const s = requireLogin();
  if (!s) return;
  mountSession(s);
  markNav("agent");
  const conv = s.conversation;
  const list = document.getElementById("conv-list");
  const box = document.getElementById("messages");
  const work = document.getElementById("agent-work");
  const form = document.getElementById("composer");
  const input = document.getElementById("reply");
  const sendBtn = document.getElementById("send-reply");
  const polishBtn = document.getElementById("polish");

  function paintWork() {
    const ticket = ensureTicket(conv);
    if (!conv.handedOff) {
      work.innerHTML = "";
      return;
    }
    const typeDisabled = ticket.status === "confirmed" ? " disabled" : "";
    const confirmDisabled =
      ticket.status === "confirmed" || !ticket.ticket_type || !ticket.business_line ? " disabled" : "";
    const fields = ticketFieldsFor(ticket.ticket_type);
    const extracting = ticket.extract_status === "extracting";
    const fieldHtml = fields
      .map(([key, label]) => {
        const item = (ticket.fields && ticket.fields[key]) || { value: "", state: "待补全" };
        return (
          '<div class="field"><label>' +
          label +
          '</label><input data-field="' +
          key +
          '" value="' +
          escapeHtml(item.value || "") +
          '"><div class="field-status">' +
          escapeHtml(item.state || "待补全") +
          "</div></div>"
        );
      })
      .join("");
    const know = knowledgeFor(ticket);
    work.innerHTML =
      '<div class="work-block"><h2>工单</h2>' +
      (ticket.status === "confirmed" ? '<p class="hint">已确认，不再自动预填；可手改字段和业务线，不能改类型。</p>' : "") +
      (extracting ? '<p class="hint">正在根据对话补全…</p>' : "") +
      '<div class="field"><label>业务线</label><select id="biz-line">' +
      '<option value="">请选择</option>' +
      '<option value="3c"' +
      (ticket.business_line === "3c" ? " selected" : "") +
      ">3C 数码</option>" +
      '<option value="fashion"' +
      (ticket.business_line === "fashion" ? " selected" : "") +
      ">服饰美妆</option></select></div>" +
      '<div class="field"><label>工单类型</label><select id="ticket-type"' +
      typeDisabled +
      ">" +
      '<option value="">售前咨询（不建单）</option>' +
      '<option value="return_exchange"' +
      (ticket.ticket_type === "return_exchange" ? " selected" : "") +
      ">退换货</option>" +
      '<option value="address_change"' +
      (ticket.ticket_type === "address_change" ? " selected" : "") +
      ">修改地址</option>" +
      '<option value="invoice"' +
      (ticket.ticket_type === "invoice" ? " selected" : "") +
      ">开发票</option>" +
      '<option value="complaint"' +
      (ticket.ticket_type === "complaint" ? " selected" : "") +
      ">投诉维权</option></select></div>" +
      fieldHtml +
      '<button class="btn btn-primary" type="button" id="confirm-ticket"' +
      confirmDisabled +
      ">" +
      (ticket.status === "confirmed" ? "已确认" : "确认工单") +
      "</button></div>" +
      '<div class="work-block"><h2>知识推送</h2><article class="knowledge-card"><div class="tag">' +
      escapeHtml(know.title) +
      '</div><div>' +
      escapeHtml(know.body) +
      '</div></article><p class="hint">仅坐席可见，不会发给用户。</p></div>';

    document.getElementById("biz-line").addEventListener("change", (e) => {
      ticket.business_line = e.target.value;
      save(s);
      paintWork();
    });
    document.getElementById("ticket-type").addEventListener("change", (e) => {
      if (ticket.status === "confirmed") return;
      ticket.ticket_type = e.target.value;
      ticket.fields = {};
      ticket.agent_edited = {};
      if (!ticket.ticket_type) {
        ticket.extract_status = "idle";
        save(s);
        paintWork();
        return;
      }
      ticket.extract_status = "extracting";
      save(s);
      paintWork();
      setTimeout(() => {
        const guessed = extractGuess(conv, ticket.ticket_type);
        Object.keys(guessed).forEach((key) => {
          if (ticket.agent_edited[key]) return;
          ticket.fields[key] = guessed[key];
        });
        ticket.extract_status = "ready";
        save(s);
        paintWork();
      }, 1200);
    });
    work.querySelectorAll("input[data-field]").forEach((el) => {
      el.addEventListener("change", () => {
        const key = el.dataset.field;
        ticket.fields[key] = { value: el.value, state: "坐席已改" };
        ticket.agent_edited[key] = true;
        save(s);
        paintWork();
      });
    });
    const confirmBtn = document.getElementById("confirm-ticket");
    confirmBtn.addEventListener("click", () => {
      if (!ticket.ticket_type || !ticket.business_line || ticket.status === "confirmed") return;
      ticket.status = "confirmed";
      ticket.extract_status = "idle";
      save(s);
      paintWork();
    });
  }

  if (!conv.handedOff) {
    list.innerHTML = '<div class="empty">还没有需要人工处理的对话</div>';
    box.innerHTML = '<div class="empty">从左侧选择已转人工的会话</div>';
    sendBtn.disabled = true;
    polishBtn.disabled = true;
    paintWork();
    return;
  }

  list.innerHTML =
    '<div class="row selected"><div class="title" title="' +
    escapeHtml(lastUserText(conv)) +
    '">' +
    escapeHtml(lastUserText(conv)) +
    '</div><div class="hint">已转人工</div></div>';
  renderMessages(box, conv);
  sendBtn.disabled = false;
  polishBtn.disabled = false;
  paintWork();

  polishBtn.addEventListener("click", () => {
    const next = polishText(input.value);
    if (next) input.value = next;
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    conv.messages.push({ role: "bot", tag: "客服", text });
    input.value = "";
    save(s);
    renderMessages(box, conv);
  });
}

function formatDocTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function sortDocsByUpdated(docs) {
  return [...docs].sort((a, b) => {
    const left = a.updated_at || "";
    const right = b.updated_at || "";
    if (left === right) return 0;
    return left < right ? 1 : -1;
  });
}

function initKnowledge() {
  const s = requireLogin();
  if (!s) return;
  mountSession(s);
  markNav("knowledge");
  const list = document.getElementById("doc-list");
  const err = document.getElementById("upload-error");
  const detail = document.getElementById("detail");
  const file = document.getElementById("file");
  const uploadBtn = document.getElementById("upload");
  const filterBtns = document.querySelectorAll(".kb-filter-btn");
  let currentFilter = "all";

  (s.documents || []).forEach((doc, index) => {
    if (!doc.updated_at) {
      doc.updated_at = new Date(Date.now() - index * 3600000).toISOString();
    }
  });
  save(s);

  function visibleDocs() {
    const sorted = sortDocsByUpdated(s.documents);
    if (currentFilter === "all") return sorted;
    return sorted.filter((d) => d.status === currentFilter);
  }

  function setFilter(next) {
    currentFilter = next;
    filterBtns.forEach((btn) => {
      const on = btn.dataset.filter === currentFilter;
      btn.classList.toggle("selected", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function paint(selectedId) {
    const shown = visibleDocs();
    if (shown.length === 0) {
      list.innerHTML =
        '<p class="empty">' +
        (s.documents.length === 0 && currentFilter === "all"
          ? "还没有知识文档。请上传 Markdown、TXT 或能抽出文字的 PDF。"
          : "当前没有该状态的文档") +
        "</p>";
    } else {
      list.innerHTML = shown
        .map((d) => {
          const st =
            d.status === "ready"
              ? '<span class="dot ok"></span>已完成'
              : d.status === "ingesting"
                ? '<span class="dot warn"></span>入库中'
                : '<span class="dot bad"></span>请重新上传';
          const time = formatDocTime(d.updated_at);
          return (
            '<div class="row' +
            (d.id === selectedId ? " selected" : "") +
            '" data-id="' +
            d.id +
            '"><div class="title" title="' +
            escapeHtml(d.name) +
            '">' +
            escapeHtml(d.name) +
            '</div><div class="hint">' +
            st +
            (d.status === "ready" && d.chunks && d.chunks.length ? " · " + d.chunks.length + " 块" : "") +
            (time ? " · " + time : "") +
            "</div></div>"
          );
        })
        .join("");
      list.querySelectorAll(".row").forEach((row) => {
        row.addEventListener("click", () => paint(row.dataset.id));
      });
    }
    const doc = shown.find((d) => d.id === selectedId) || null;
    if (!doc || doc.status !== "ready") {
      detail.innerHTML =
        '<div class="hint">' +
        (doc && doc.status === "ingesting"
          ? ingestProgressHtml(doc)
          : doc && doc.status === "failed"
            ? "请重新上传"
            : shown.length === 0
              ? "当前没有该状态的文档"
              : "选择一篇已完成的文档以查看分块并编辑标签。") +
        "</div>";
      return;
    }
    const chunks = doc.chunks || [];
    const chunkHtml = chunks
      .map(
        (c) =>
          '<article class="chunk-card"><div class="tag">分块 ' +
          c.position +
          (c.heading_path ? " · " + escapeHtml(c.heading_path) : "") +
          '</div><div class="body">' +
          escapeHtml(c.content) +
          "</div></article>"
      )
      .join("");
    detail.innerHTML =
      '<p class="hint">' +
      CHUNK_RULE +
      " 本篇共 " +
      chunks.length +
      " 块（只读）。</p>" +
      chunkHtml +
      '<div class="field"><label>标签</label><input id="tags" value="' +
      escapeHtml(doc.tags) +
      '"></div>' +
      (doc.faqs || [])
        .map(
          (f, i) =>
            '<div class="field"><label>FAQ ' +
            (i + 1) +
            '</label><input data-fq="' +
            i +
            '" value="' +
            escapeHtml(f.q) +
            " / " +
            escapeHtml(f.a) +
            '"></div>'
        )
        .join("") +
      '<button class="btn btn-primary" id="save">保存</button><p class="hint" id="saved"></p>';
    document.getElementById("save").addEventListener("click", () => {
      doc.tags = document.getElementById("tags").value;
      document.getElementById("saved").textContent = "已保存，将立即用于后续提问。";
      save(s);
      paint(doc.id);
    });
  }

  filterBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      setFilter(btn.dataset.filter);
      const shown = visibleDocs();
      paint(shown[0] ? shown[0].id : null);
    });
  });

  function startIngest(filename, markdown) {
    if (currentFilter === "ready" || currentFilter === "failed") {
      setFilter("all");
    }
    const id = "d" + Date.now();
    s.documents.unshift({
      id,
      name: filename,
      status: "ingesting",
      step: "chunk",
      tags: "",
      faqs: [],
      chunks: [],
      updated_at: new Date().toISOString()
    });
    save(s);
    paint(id);
    const chunks = chunkMarkdown(markdown);
    setTimeout(() => {
      const cur = patchDoc(id, (doc) => {
        doc.step = "tag";
        doc.chunks = chunks;
      });
      if (!cur) return;
      s.documents = cur.documents;
      paint(id);
      setTimeout(() => {
        const cur2 = patchDoc(id, (doc) => {
          doc.step = "faq";
        });
        if (!cur2) return;
        s.documents = cur2.documents;
        paint(id);
        setTimeout(() => {
          const cur3 = patchDoc(id, (doc) => {
            doc.status = "ready";
            doc.step = "";
            doc.tags = "软件与操作系统 · 故障与异常排查";
            doc.faqs = [{ q: "文档中的典型问题", a: "请根据分块正文中的步骤处理。" }];
            doc.chunks = chunks;
          });
          if (!cur3) return;
          s.documents = cur3.documents;
          paint(id);
        }, 900);
      }, 900);
    }, 900);
  }

  uploadBtn.addEventListener("click", () => {
    err.textContent = "";
    const f = file.files[0];
    if (!f) {
      err.textContent = "请选择文件";
      return;
    }
    const ext = fileExt(f.name);
    if (![".md", ".txt", ".pdf"].includes(ext) || f.size === 0) {
      err.textContent = "请重新上传";
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => {
      err.textContent = "请重新上传";
    };
    reader.onload = () => {
      let markdown = "";
      if (ext === ".pdf") {
        markdown = toMarkdownFromSource(extractPdfText(reader.result));
      } else {
        markdown = toMarkdownFromSource(String(reader.result || ""));
      }
      if (!markdown) {
        err.textContent = "请重新上传";
        return;
      }
      startIngest(f.name, markdown);
    };
    if (ext === ".pdf") reader.readAsArrayBuffer(f);
    else reader.readAsText(f, "UTF-8");
  });

  const first = visibleDocs()[0];
  paint(first && first.id);
}
