// CoT Trace Explorer：静态页面，数据在 data/ 下（由 src/corpus/export_site.py 导出）。
// 路由：#/ 列表；#/t/<traj_id> 单条轨迹；#/review 人工核对列表；#/review/<traj_id> 核对一条；#/about 说明
const LABELS = {SU: "Setup", PL: "Plan", RC: "Recall", CP: "Compute", EX: "Explore", VF: "Verify",
  MB: "Monitor", CS: "Consolidate", AN: "Answer"};
const REVIEW_KEY = "cot-review-v1";
const REVIEW_BASE = "27B·default";   // 核对时的默认值来自哪份标注
let INDEX = null;
const cache = {};

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));

function store() {
  try { return JSON.parse(localStorage.getItem(REVIEW_KEY)) || {items: {}}; } catch (e) { return {items: {}}; }
}
function save(s) { try { localStorage.setItem(REVIEW_KEY, JSON.stringify(s)); } catch (e) {} }

async function getIndex() {
  if (!INDEX) INDEX = await (await fetch("data/index.json")).json();
  return INDEX;
}
async function getTrace(id) {
  if (!cache[id]) cache[id] = await (await fetch(`data/traces/${encodeURIComponent(id)}.json`)).json();
  return cache[id];
}
function math(el) {
  if (window.renderMathInElement) {
    renderMathInElement(el, {delimiters: [
      {left: "$$", right: "$$", display: true}, {left: "\\[", right: "\\]", display: true},
      {left: "\\(", right: "\\)", display: false}, {left: "$", right: "$", display: false}], throwOnError: false});
  }
}
// 每段属于哪个节点（按标注）
function paraMap(ann, n) {
  const out = Array(n).fill(null);
  if (!ann || !ann.nodes) return out;
  for (const nd of ann.nodes) for (let p = nd.p_start; p <= nd.p_end && p < n; p++)
    out[p] = {...nd, first: p === nd.p_start};
  return out;
}
function fmtPct(x) { return x == null ? "—" : (100 * x).toFixed(0) + "%"; }

// ---------------- 列表 ----------------
async function viewList() {
  const idx = await getIndex();
  const app = $("#app");
  const annNames = idx.annotators;
  app.innerHTML = `
    <h1>轨迹列表</h1>
    <p class="muted small">${esc(idx.description)}（${idx.items.length} 条）</p>
    <div class="filters">
      <label>难度 <select id="f-tier"><option value="">全部</option><option>easy</option><option>medium</option><option>hard</option><option>zero</option></select></label>
      <label>对错 <select id="f-cor"><option value="">全部</option><option value="1">正确</option><option value="0">错误</option></select></label>
      <label>长度 <select id="f-len"><option value="">全部</option><option>short</option><option>mid</option><option>long</option></select></label>
      <label>集合 <select id="f-set"><option value="">全部</option><option value="api">有 API 参照</option><option value="human">人工核对</option></select></label>
      <label>按 <select id="f-ann">${annNames.map(a => `<option>${esc(a)}</option>`).join("")}</select> 的放弃占比排序</label>
    </div>
    <div class="tablewrap"><table><thead><tr><th>轨迹</th><th>难度</th><th>对错</th><th>token</th><th>段数</th><th>放弃占比</th><th>标注</th></tr></thead><tbody id="rows"></tbody></table></div>`;
  const draw = () => {
    const t = $("#f-tier").value, c = $("#f-cor").value, l = $("#f-len").value, s = $("#f-set").value, a = $("#f-ann").value;
    const rows = idx.items.filter(r => (!t || r.tier === t) && (!c || String(+r.is_correct) === c) && (!l || r.len_bin === l)
      && (!s || (s === "api" ? r.in_api : r.in_human)))
      .sort((x, y) => (y.fsf_tok?.[a] ?? -1) - (x.fsf_tok?.[a] ?? -1));
    $("#rows").innerHTML = rows.map(r => `<tr>
      <td><a href="#/t/${encodeURIComponent(r.traj_id)}">${esc(r.traj_id)}</a></td>
      <td>${esc(r.tier)}</td><td>${r.is_correct ? '<span class="chip ok">对</span>' : '<span class="chip bad">错</span>'}</td>
      <td>${r.n_tokens.toLocaleString()}</td><td>${r.n_paras}</td><td>${fmtPct(r.fsf_tok?.[a])}</td>
      <td>${Object.keys(r.fsf_tok || {}).map(k => `<span class="chip">${esc(k)}</span>`).join("")}</td></tr>`).join("");
  };
  app.querySelectorAll("select").forEach(e => e.onchange = draw);
  draw();
}

// ---------------- 单条轨迹（浏览 / 核对） ----------------
async function viewTrace(id, review) {
  const tr = await getTrace(id);
  const names = Object.keys(tr.annotations);
  let cur = review ? REVIEW_BASE : (names.includes(REVIEW_BASE) ? REVIEW_BASE : names[0]);
  const st = store();
  const n = tr.paragraphs.length;
  const base = paraMap(tr.annotations[REVIEW_BASE], n).map(x => x ? x.path === "A" : false);
  if (review && !st.items[id]) { st.items[id] = {abandoned: base.slice(), note: "", done: false}; save(st); }
  const app = $("#app");
  app.innerHTML = `
    <p class="small"><a href="${review ? "#/review" : "#/"}">← 返回</a></p>
    <h1>${esc(tr.traj_id)} ${review ? '<span class="chip warn">核对模式</span>' : ""}</h1>
    <div class="meta">
      <span class="chip">${esc(tr.tier)}</span>
      <span class="chip ${tr.is_correct ? "ok" : "bad"}">${tr.is_correct ? "答对" : "答错"}</span>
      <span class="chip">${tr.n_tokens.toLocaleString()} token</span><span class="chip">${n} 段</span>
      ${tr.meta_leak?.length ? `<span class="chip warn">泄露：${esc(tr.meta_leak.join(", "))}</span>` : ""}
    </div>
    <div class="card"><b>题目</b><div class="text">${esc(tr.problem)}</div>
      <p class="small muted">标准答案：<span>${esc(tr.gold)}</span>　教师答案：<span>${esc(tr.pred ?? "（无）")}</span></p></div>
    ${review ? `<div class="card small"><b>怎么核对：</b>只看一件事——每段是不是<b>被放弃的尝试</b>
      （一段推进后被放弃、或结论没被最终答案用到；确认性验证、复述、计划都算主路径）。默认值是 27B 的标注，
      不同意就改。改过的段落会有虚线框。全部看完点“标记为已完成”。</div>` : ""}
    <div class="toolbar">
      ${review ? "" : names.map(a => `<button data-a="${esc(a)}" class="${a === cur ? "on" : ""}">${esc(a)}</button>`).join("")}
      <span class="legend"><span><i class="sw" style="background:var(--main-bar)"></i>主路径</span><span><i class="sw" style="background:var(--aband-bar)"></i>被放弃</span></span>
      ${review ? `<button id="done" class="btn primary">标记为已完成</button>` : ""}
    </div>
    <div id="paras"></div>
    <h2>正式回答</h2><div class="card answer" id="answer">${esc(tr.answer_text)}</div>
    ${review ? `<h2>备注</h2><textarea id="note" rows="3" style="width:100%">${esc(st.items[id].note)}</textarea>` : ""}
    <h2>方法摘要</h2><div class="card small">${names.map(a => `<div><b>${esc(a)}</b>：${esc(tr.annotations[a].method || "—")}</div>`).join("")}</div>`;
  const draw = () => {
    const pm = paraMap(tr.annotations[cur], n);
    const s = store().items[id];
    $("#paras").innerHTML = tr.paragraphs.map((p, i) => {
      const nd = pm[i];
      const ab = review ? s.abandoned[i] : nd && nd.path === "A";
      const cls = review ? (ab ? "A" : "M") : (nd ? nd.path : "");
      const tags = nd && nd.first ? `<div class="tags"><span class="chip">n${nd.node_id}</span><span class="chip">${esc(LABELS[nd.label] || nd.label)}</span>
        <span class="chip">b=${nd.branch}</span>${nd.flags ? `<span class="chip warn">${esc(nd.flags)}</span>` : ""}</div>` : "";
      const rv = review ? `<div class="review"><label><input type="checkbox" data-i="${i}" ${ab ? "checked" : ""}> 被放弃</label>
        <span class="muted">27B：${base[i] ? "被放弃" : "主路径"}</span></div>` : "";
      return `<div class="para ${cls} ${nd && nd.first ? "nodestart" : ""} ${review && ab !== base[i] ? "changed" : ""}">
        <div class="pid">p${i}</div><div>${tags}<div class="text">${esc(p)}</div>${rv}</div></div>`;
    }).join("");
    math($("#paras"));
    if (review) $("#paras").querySelectorAll("input[type=checkbox]").forEach(cb => cb.onchange = () => {
      const s2 = store(); s2.items[id].abandoned[+cb.dataset.i] = cb.checked; save(s2); draw();
    });
  };
  app.querySelectorAll(".toolbar button[data-a]").forEach(b => b.onclick = () => {
    cur = b.dataset.a; app.querySelectorAll(".toolbar button[data-a]").forEach(x => x.classList.toggle("on", x === b)); draw();
  });
  if (review) {
    $("#note").oninput = e => { const s2 = store(); s2.items[id].note = e.target.value; save(s2); };
    $("#done").onclick = () => { const s2 = store(); s2.items[id].done = true; save(s2); location.hash = "#/review"; };
  }
  draw(); math($("#answer")); math(app.querySelector(".card"));
}

// ---------------- 核对列表 + 导出 ----------------
async function viewReview() {
  const idx = await getIndex();
  const items = idx.items.filter(r => r.in_human);
  const st = store();
  const nDone = items.filter(r => st.items[r.traj_id]?.done).length;
  $("#app").innerHTML = `
    <h1>人工核对（${items.length} 条）</h1>
    <p class="muted small">进度只存在这个浏览器里。全部完成后点“导出”，把下载的 JSON 文件交给 Agent。</p>
    <div class="progress"><div style="width:${100 * nDone / Math.max(items.length, 1)}%"></div></div>
    <p>已完成 ${nDone} / ${items.length}　<button class="btn primary" id="export">导出核对结果</button>
       <button class="btn" id="reset">清空本地进度</button></p>
    <div class="tablewrap"><table><thead><tr><th>轨迹</th><th>难度</th><th>对错</th><th>段数</th><th>状态</th></tr></thead><tbody>
    ${items.map(r => { const s = st.items[r.traj_id]; return `<tr><td><a href="#/review/${encodeURIComponent(r.traj_id)}">${esc(r.traj_id)}</a></td>
      <td>${esc(r.tier)}</td><td>${r.is_correct ? "对" : "错"}</td><td>${r.n_paras}</td>
      <td>${s?.done ? '<span class="chip ok">已完成</span>' : s ? '<span class="chip warn">进行中</span>' : '<span class="chip">未开始</span>'}</td></tr>`; }).join("")}
    </tbody></table></div>`;
  $("#export").onclick = () => {
    const out = {schema: "human_review_v1", base_annotation: REVIEW_BASE, exported_at: new Date().toISOString(), items: store().items};
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], {type: "application/json"}));
    a.download = `human_review_${new Date().toISOString().slice(0, 10)}.json`; a.click();
  };
  $("#reset").onclick = () => { if (confirm("清空本浏览器里的全部核对进度？")) { save({items: {}}); viewReview(); } };
}

async function viewAbout() {
  const idx = await getIndex();
  $("#app").innerHTML = `<h1>说明</h1><div class="card">${idx.about_html || ""}</div>`;
}

async function route() {
  const h = location.hash.replace(/^#/, "") || "/";
  try {
    if (h.startsWith("/t/")) await viewTrace(decodeURIComponent(h.slice(3)), false);
    else if (h.startsWith("/review/")) await viewTrace(decodeURIComponent(h.slice(8)), true);
    else if (h === "/review") await viewReview();
    else if (h === "/about") await viewAbout();
    else await viewList();
  } catch (e) { $("#app").innerHTML = `<p class="muted">加载失败：${esc(e.message)}</p>`; }
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);
window.addEventListener("DOMContentLoaded", route);
