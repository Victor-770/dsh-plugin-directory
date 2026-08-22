// 洁净室夹具：伪造一小套 topic:dsh-plugin 仓库（覆盖各分类规则），供 fetch-shim 应答搜索 API、
// raw README 与 IndexNow 端点。pushed_at 用固定字符串，方便与"上次数据"构造出
// 未变化（README 缓存命中）/已变化（重抓）/全新（重抓）三种仓库。

// pushed_at 用固定字符串（非 now 派生）：播种进程与被测子进程各自加载本模块，
// 若用当前时间推导，两次加载跨秒边界就会让"未变化"仓库误判为已变化。
function repo(owner, name, { stars = 10, description = "", topics = [], readme = `# ${name}\nA dsh plugin.\n`, pushedAt = "2026-08-20T12:00:00Z" }) {
  return {
    full_name: `${owner}/${name}`,
    html_url: `https://github.com/${owner}/${name}`,
    description,
    stargazers_count: stars,
    language: "TypeScript",
    pushed_at: pushedAt,
    topics,
    _readme: readme,
  };
}

// 7 个仓库：repo[0..2] 播种为"未变化"（seedPrev 用相同 pushed_at），repo[3..5] 播种为
// "已变化"（seedPrev 给更早的 pushed_at），repo[6] 不播种（净新增）。
export const REPOS = [
  repo("a", "unchanged-cli", { topics: ["cli"], description: "terminal tool" }),
  repo("b", "unchanged-skin", { topics: ["skin"], description: "皮肤 skin" }),
  repo("c", "unchanged-agent", { topics: ["agent"], description: "assistant" }),
  repo("d", "changed-search", { topics: ["search"], description: "search engine", stars: 50 }),
  repo("e", "changed-tui", { topics: ["tui"], description: "终端 tui", stars: 40 }),
  repo("f", "changed-vision", { topics: ["vision"], description: "ocr 识别", stars: 30 }),
  repo("g", "brand-new-media", { topics: ["bilibili"], description: "哔哩哔哩下载", stars: 20 }),
];

// 上次同步的记录形态（sync.mjs 的 record schema）：3 个未变化 + 3 个 pushed_at 更旧。
export function seedPrevRecords() {
  const rec = (r, { stale = false } = {}) => ({
    full_name: r.full_name,
    html_url: r.html_url,
    description: r.description,
    stars: r.stargazers_count,
    language: r.language,
    pushed_at: stale ? "2026-07-25T00:00:00Z" : r.pushed_at,
    topics: r.topics,
    categories: ["工具/开发"],
    tags: [],
    readme_text: stale ? "# old readme" : r._readme,
  });
  return [
    ...REPOS.slice(0, 3).map((r) => rec(r)),
    ...REPOS.slice(3, 6).map((r) => rec(r, { stale: true })),
  ];
}
