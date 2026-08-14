// 浏览端应用（Ticket 04 基线）：拉 browse.json，客户端分类/标签过滤 + 排序 + 中英切换 + 移动端抽屉。
// Ticket 05 将搜索框升级为 Worker 全文搜索（本文件保持接口兼容）。
import { CATEGORY_SLUGS } from "../lib/category-meta.js";
export function BrowseApp({ STR, CATEGORY_ORDER }) {
  const state = { lang: "zh", q: "", cat: "", tags: new Set(), sort: "stars", all: [], filtered: [] };
  const $ = (id) => document.getElementById(id);
  const els = { grid: $("card-grid"), count: $("result-count"), empty: $("empty-state"), input: $("search-input"), sort: $("sort-select"), lang: $("lang-toggle"), clear: $("clear-filters"), cloud: $("tag-cloud") };

  const langFromUrl = new URLSearchParams(location.search).get("lang");
  if (langFromUrl && STR[langFromUrl]) state.lang = langFromUrl;
  const qFromUrl = new URLSearchParams(location.search).get("q");
  if (qFromUrl) { state.q = qFromUrl; }

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function renderCard(p) {
    const s = STR[state.lang];
    // SEO: 卡片指向站内插件详情页（详情页再提供 GitHub 外链），形成站内链接结构
    const pageUrl = `/plugin/${esc(p.full_name)}/`;
    return `<a href="${pageUrl}" class="plugin-card block rounded-xl border border-line bg-surface p-4 transition hover:border-accent/60 hover:bg-surface2">
      <div class="flex items-start justify-between gap-2">
        <span class="font-mono text-[13px] font-medium break-all">${esc(p.full_name)}</span>
        <span class="shrink-0 text-xs text-muted">★ ${Number(p.stars || 0).toLocaleString()}</span>
      </div>
      <p class="line-clamp-2 mt-2 min-h-[2.5rem] text-sm text-muted">${esc(p.description) || "—"}</p>
      <div class="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
        ${p.language ? `<span class="flex items-center gap-1 rounded-full bg-surface2 px-2 py-0.5"><span class="inline-block h-1.5 w-1.5 rounded-full bg-accent"></span>${esc(p.language)}</span>` : ""}
        ${(p.categories || []).slice(0, 2).map((c) => CATEGORY_SLUGS[c]
                  ? `<a href="${state.lang === "en" ? "/en" : ""}/category/${CATEGORY_SLUGS[c]}/" class="rounded-full bg-accent/10 px-2 py-0.5 text-accent hover:bg-accent/20">${esc(s.languages[c] || c)}</a>`
                  : `<span class="rounded-full bg-accent/10 px-2 py-0.5 text-accent">${esc(s.languages[c] || c)}</span>`).join("")}
      </div>
    </a>`;
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
    els.grid.innerHTML = list.map(renderCard).join("");
    // 计数
    const counts = {};
    for (const p of state.all) for (const c of p.categories || []) counts[c] = (counts[c] || 0) + 1;
    document.querySelectorAll(".cat-count").forEach((el) => {
      const cat = el.closest(".category-item").dataset.cat;
      el.textContent = cat ? (counts[cat] || 0) : state.all.length;
    });
    // 标签云
    const tagCounts = {};
    for (const p of state.all) for (const t of p.tags || []) tagCounts[t] = (tagCounts[t] || 0) + 1;
    const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 20);
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
  async function runSearch() {
    const q = state.q.trim();
    if (!q) { apply(); return; }
    const params = new URLSearchParams({ q, sort: state.sort, limit: "100" });
    if (state.cat) params.set("cat", state.cat);
    if (state.tags.size) params.set("tag", [...state.tags].join(","));
    try {
      const res = await fetch("/api/search?" + params);
      if (!res.ok) throw new Error("search api " + res.status);
      const data = await res.json();
      els.count.textContent = data.total;
      els.empty.classList.toggle("hidden", data.total > 0);
      els.grid.innerHTML = (data.results || []).map(renderCard).join("");
    } catch (e) {
      // Worker 未部署（本地开发）：降级为本地 name/description 过滤
      apply();
    }
  }
  els.sort.addEventListener("change", (e) => { state.sort = e.target.value; apply(); });
  els.lang.addEventListener("click", () => {
    // 语言切换 = 站点内跳转（/ <-> /en/），保留当前搜索词
    const q = new URLSearchParams(location.search).get("q");
    const target = state.lang === "en" ? "/" : "/en/";
    location.href = q ? target + "?q=" + encodeURIComponent(q) : target;
  });
  els.clear.addEventListener("click", () => { state.q = ""; state.cat = ""; state.tags.clear(); els.input.value = ""; apply(); });
  document.addEventListener("click", (e) => {
    const catBtn = e.target.closest(".category-item");
    if (catBtn) { state.cat = catBtn.dataset.cat; document.querySelectorAll(".category-item").forEach((b) => b.classList.toggle("bg-surface2", b === catBtn)); apply(); return; }
    const chip = e.target.closest(".tag-chip");
    if (chip) { const t = chip.dataset.tag; state.tags.has(t) ? state.tags.delete(t) : state.tags.add(t); apply(); }
  });
  $("theme-toggle").addEventListener("click", () => {
    const dark = document.documentElement.classList.toggle("dark");
    document.documentElement.classList.toggle("light", !dark);
    try { localStorage.setItem("dsh-theme", dark ? "dark" : "light"); } catch (e) {}
  });

  fetch("/data/browse.json").then((r) => r.json()).then((data) => {
    state.all = data.plugins || [];
    renderStrings();
    if (state.q) { els.input.value = state.q; runSearch(); } else { apply(); }
  }).catch(() => { els.grid.innerHTML = "<p class='text-sm text-muted'>browse.json not found — run npm run sync first.</p>"; });
}