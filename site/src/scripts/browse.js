// 浏览端应用：拉 browse.json，客户端分类/标签过滤 + 排序 + 中英切换 + 移动端抽屉。
// 初始语言由页面传入（zh 页传 zh、en 页传 en）——不再硬编码默认值，/en/ 页面在数据
// 加载完成后保持英文（含 html lang）。?lang= 深链语义保留。
import { CATEGORY_SLUGS } from "../lib/category-meta.js";
export function BrowseApp({ STR, CATEGORY_ORDER, lang = "zh" }) {
  const state = { lang, q: "", cat: "", tags: new Set(), sort: "stars", all: [], filtered: [] };
  const $ = (id) => document.getElementById(id);
  const els = { grid: $("card-grid"), count: $("result-count"), empty: $("empty-state"), input: $("search-input"), sort: $("sort-select"), lang: $("lang-toggle"), clear: $("clear-filters"), cloud: $("tag-cloud"), filterToggle: $("filter-toggle"), filterPanel: $("filter-panel") };

  const langFromUrl = new URLSearchParams(location.search).get("lang");
  if (langFromUrl && STR[langFromUrl]) state.lang = langFromUrl;
  const qFromUrl = new URLSearchParams(location.search).get("q");
  if (qFromUrl) { state.q = qFromUrl; }

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function renderCard(p) {
    const s = STR[state.lang];
    // SEO: 卡片指向站内插件详情页（详情页再提供 GitHub 外链），形成站内链接结构
    const pageUrl = `/plugin/${esc(p.full_name)}/`;
    return `<div class="plugin-card relative block rounded-xl border border-line bg-surface p-4 transition hover:border-accent/60 hover:bg-surface2">
      <a href="${pageUrl}" class="absolute inset-0" aria-label="${esc(p.full_name)}" tabindex="-1" aria-hidden="true"></a>
      <div class="flex items-start justify-between gap-2">
        <a href="${pageUrl}" class="font-mono text-[13px] font-medium break-all relative z-10 rounded-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">${esc(p.full_name)}</a>
        <span class="shrink-0 text-xs text-muted">★ ${Number(p.stars || 0).toLocaleString()}</span>
      </div>
      <p class="line-clamp-2 mt-2 min-h-[2.5rem] text-sm text-muted">${esc(p.description) || "—"}</p>
      <div class="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
        ${p.language ? `<span class="flex items-center gap-1 rounded-full bg-surface2 px-2 py-0.5"><span class="inline-block h-1.5 w-1.5 rounded-full bg-accent"></span>${esc(p.language)}</span>` : ""}
        ${(p.categories || []).slice(0, 2).map((c) => CATEGORY_SLUGS[c]
                  ? `<a href="${state.lang === "en" ? "/en" : ""}/category/${CATEGORY_SLUGS[c]}/" class="relative z-10 rounded-full bg-accent/10 px-2 py-0.5 text-accent hover:bg-accent/20">${esc(s.languages[c] || c)}</a>`
                  : `<span class="rounded-full bg-accent/10 px-2 py-0.5 text-accent">${esc(s.languages[c] || c)}</span>`).join("")}
      </div>
    </div>`;
  }

  // 计数不变量：分类/标签计数只依赖加载一次的 state.all，数据到达后算一次；
  // 旧实现在每次 apply()（每次输入/筛选）重算，纯浪费。
  function computeCounts() {
    const counts = {};
    const tagCounts = {};
    for (const p of state.all) {
      for (const c of p.categories || []) counts[c] = (counts[c] || 0) + 1;
      for (const t of p.tags || []) tagCounts[t] = (tagCounts[t] || 0) + 1;
    }
    state.catCounts = counts;
    state.tagCounts = tagCounts;
  }

  // 渐进渲染：无筛选浏览全量可达 1 万+ 卡片，一次性 innerHTML 会创建数万 DOM 节点卡死主线程。
  // 首屏渲染前 ~100 张，滚动接近底部经 IntersectionObserver 增量追加；计数显示的是结果总数。
  const RENDER_PAGE = 100;
  const renderState = { list: [], rendered: 0, observer: null, sentinel: null };
  function ensureSentinel() {
    if (renderState.sentinel) return renderState.sentinel;
    const el = document.createElement("div");
    el.id = "render-sentinel";
    el.className = "h-px w-full";
    els.grid.after(el);
    renderState.sentinel = el;
    renderState.observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) renderMore();
    }, { rootMargin: "600px" });
    renderState.observer.observe(el);
    return el;
  }
  function renderMore() {
    const chunk = renderState.list.slice(renderState.rendered, renderState.rendered + RENDER_PAGE);
    if (!chunk.length) return;
    els.grid.insertAdjacentHTML("beforeend", chunk.map(renderCard).join(""));
    renderState.rendered += chunk.length;
    // 渲染完毕撤掉哨兵（滚动监听不再必要）
    if (renderState.rendered >= renderState.list.length && renderState.observer) {
      renderState.observer.disconnect();
      renderState.sentinel?.remove();
      renderState.sentinel = null;
    }
  }
  function setList(list) {
    renderState.list = list;
    renderState.rendered = 0;
    els.grid.innerHTML = "";
    renderMore();
    if (list.length > renderState.rendered) ensureSentinel();
  }

  function apply() {
    const s = STR[state.lang];
    const q = state.q.trim().toLowerCase();
    let list = state.all;
    if (state.cat) list = list.filter((p) => (p.categories || []).includes(state.cat));
    if (state.tags.size) list = list.filter((p) => (p.tags || []).some((t) => state.tags.has(t)));
    if (q) list = list.filter((p) => (p.full_name + " " + (p.description || "")).toLowerCase().includes(q));
    if (state.sort === "stars") list = [...list].sort((a, b) => b.stars - a.stars);
    state.filtered = list;
    els.count.textContent = list.length;
    els.empty.classList.toggle("hidden", list.length > 0);
    els.grid.setAttribute("aria-busy", "false");
    setList(list);
    // 计数（不变量：只读预计算结果）
    const counts = state.catCounts || {};
    document.querySelectorAll(".cat-count").forEach((el) => {
      const cat = el.closest(".category-item").dataset.cat;
      el.textContent = cat ? (counts[cat] || 0) : state.all.length;
    });
    // 标签云（不变量：排序也只依赖预计算计数）
    const topTags = Object.entries(state.tagCounts || {}).sort((a, b) => b[1] - a[1]).slice(0, 20);
    els.cloud.innerHTML = topTags.map(([t, n]) => `<button class="tag-chip rounded-full border border-line px-2 py-0.5 text-[11px] ${state.tags.has(t) ? "border-accent text-accent" : "text-muted hover:border-accent/60"}" data-tag="${esc(t)}">${esc(t)} · ${n}</button>`).join("");
  }

  function renderStrings() {
    const s = STR[state.lang];
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.dataset.i18n;
      if (s[key] !== undefined) el.textContent = s[key];
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.dataset.i18nPlaceholder;
      if (s[key] !== undefined) el.placeholder = s[key];
    });
    document.querySelectorAll(".category-label").forEach((el) => {
      el.textContent = s.languages[el.dataset.catKey] || el.dataset.catKey;
    });
    document.documentElement.lang = state.lang;
  }

  // Ticket 05：搜索走 /api/search（生产经 Pages Function 代理到 Worker），失败/未部署时降级本地过滤。
  let debounceTimer = null;
  els.input.addEventListener("input", (e) => {
    state.q = e.target.value;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runSearch(), 300);
  });
  // 移动端筛选抽屉
  if (els.filterToggle && els.filterPanel) {
    els.filterToggle.addEventListener("click", () => {
      const open = els.filterPanel.classList.toggle("open");
      els.filterToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }
  // 搜索请求竞态防护：连续快速输入时，慢返回的旧响应不得覆盖新结果（请求序号比较）
  let searchSeq = 0;
  async function runSearch() {
    const seq = ++searchSeq;
    const q = state.q.trim();
    if (!q) { apply(); return; }
    setBusy(true);
    const params = new URLSearchParams({ q, sort: state.sort, limit: "100" });
    if (state.cat) params.set("cat", state.cat);
    if (state.tags.size) params.set("tag", [...state.tags].join(","));
    try {
      const res = await fetch("/api/search?" + params);
      if (!res.ok) throw new Error("search api " + res.status);
      const data = await res.json();
      if (seq !== searchSeq) return; // 旧响应迟到：丢弃
      els.count.textContent = data.total;
      els.empty.classList.toggle("hidden", data.total > 0);
      els.grid.setAttribute("aria-busy", "false");
      setList(data.results || []); // API limit=100，天然一页，无需哨兵
    } catch (e) {
      if (seq !== searchSeq) return;
      // Worker 未部署（本地开发）：降级为本地 name/description 过滤
      apply();
    } finally {
      els.grid.setAttribute("aria-busy", "false");
    }
  }
  // 搜索请求进行中：标记 aria-busy（CSS 降载反馈），结果更新前不清空旧卡片
  function setBusy(on) { if (els.grid) els.grid.setAttribute("aria-busy", on ? "true" : "false"); }
  // 移动端抽屉：筛选后收起
  function closeFilterPanel() { if (els.filterPanel && window.innerWidth < 768) { els.filterPanel.classList.remove("open"); if (els.filterToggle) els.filterToggle.setAttribute("aria-expanded", "false"); } }
  els.sort.addEventListener("change", (e) => { state.sort = e.target.value; apply(); });
  els.lang.addEventListener("click", () => {
    // 语言切换 = 对方语言的同等页面（首页 <-> 首页），保留当前搜索词
    const q = new URLSearchParams(location.search).get("q");
    const target = state.lang === "en"
      ? (location.pathname.replace(/^\/en\/?/, "/") || "/")
      : (location.pathname === "/" ? "/en/" : "/en" + location.pathname);
    location.href = q ? target + (target.includes("?") ? "&" : "?") + "q=" + encodeURIComponent(q) : target;
  });
  els.clear.addEventListener("click", () => { state.q = ""; state.cat = ""; state.tags.clear(); els.input.value = ""; els.input.focus(); apply(); });
  document.addEventListener("click", (e) => {
    const catBtn = e.target.closest(".category-item");
    if (catBtn) { state.cat = catBtn.dataset.cat; document.querySelectorAll(".category-item").forEach((b) => b.classList.toggle("bg-surface2", b === catBtn)); apply(); return; }
    const chip = e.target.closest(".tag-chip");
    if (chip) { const t = chip.dataset.tag; state.tags.has(t) ? state.tags.delete(t) : state.tags.add(t); apply(); closeFilterPanel(); }
  });
  // 分类/标签交互后收起移动端抽屉（在 apply 之后关闭，避免点击目标被折叠隐藏）
  document.addEventListener("click", (e) => {
    if (e.target.closest(".category-item")) closeFilterPanel();
  });
  $("theme-toggle").addEventListener("click", () => {
    const dark = document.documentElement.classList.toggle("dark");
    document.documentElement.classList.toggle("light", !dark);
    try { localStorage.setItem("dsh-theme", dark ? "dark" : "light"); } catch (e) {}
  });

  // 浏览数据用精简版 browse-lite.json（卡片渲染字段；描述已截断，无 html_url/pushed_at/topics）
  fetch("/data/browse-lite.json").then((r) => r.json()).then((data) => {
    state.all = data.plugins || [];
    computeCounts(); // 数据到达后算一次的不变量，apply 只读
    renderStrings();
    if (state.q) { els.input.value = state.q; runSearch(); } else { apply(); }
  }).catch(() => {
    // 数据加载失败（如 robots 屏蔽、本地未 sync）：保留 SSR 预渲染的卡片，不清空网格。
    renderStrings();
    els.grid.setAttribute("aria-busy", "false");
  });
}