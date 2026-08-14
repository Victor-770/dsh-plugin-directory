// 分类体系（v1）：八分类关键词规则 + top-20 高 star 手动兜底。错误分类 v1 不修（spec 记档）。
export const CATEGORIES = ["皮肤/UI", "终端/TUI", "工具/开发", "搜索", "Agent/智能体", "内容/媒体", "娱乐/广告", "其他"];

// 三级信号源加权：topics/描述/仓库名 = 作者策展（高精度，权重 3/3/2）；README 头部只认独特词（平台名/格式词，权重 1）。
// 分配：取总分最高分类；同分按优先级；全 0 -> 工具/开发（兜底桶）。
const KEYWORD_RULES = [
  { cat: "搜索", topics: ["search", "search-engine", "search-tool"], desc: ["搜索", "检索", "搜索引擎", "search tool", "search engine", "reverse image", "反向图片"], readme: ["搜索引擎", "reverse image search", "反向图片搜索"] },
  { cat: "娱乐/广告", topics: ["ads", "ad", "game", "entertainment", "meme"], desc: ["广告", "游戏", "娱乐", "笑话", "meme"], readme: [] },
  { cat: "终端/TUI", topics: ["tui", "terminal", "cli", "console"], desc: ["tui", "terminal", "终端", "cli", "命令行", "控制台", "全屏"], readme: ["tui"] },
  { cat: "皮肤/UI", topics: ["skin", "theme", "wallpaper", "web-ui", "sidebar", "ui"], desc: ["皮肤", "skin", "主题", "theme", "壁纸", "wallpaper", "侧边栏", "sidebar", "皮肤系列", "皮肤包", "web ui", "皮肤中心"], readme: ["皮肤系列", "皮肤包", "skin pack"] },
  { cat: "内容/媒体", topics: ["bilibili", "video", "image", "ocr", "vision", "media", "music", "subtitle", "news", "rss", "podcast", "screenshot", "xiaohongshu", "douyin", "weibo"], desc: ["bilibili", "哔哩", "视频", "图片", "ocr", "识别", "字幕", "音乐", "小红书", "抖音", "微博", "新闻", "rss", "博客", "播客", "截图", "视觉"], readme: ["bilibili", "哔哩", "小红书", "抖音", "微博", "字幕", "播客"] },
  { cat: "Agent/智能体", topics: ["agent", "assistant", "copilot", "autonomous", "ai-agent", "ai-assistant"], desc: ["智能体", "agent", "assistant", "助手", "copilot", "自主", "autonomous", "数字生命", "智能伙伴"], readme: ["智能体", "数字生命"] },
];

const PRIORITY = ["搜索", "娱乐/广告", "终端/TUI", "皮肤/UI", "内容/媒体", "Agent/智能体", "工具/开发"];

// 手动兜底：生态头部仓库（grilling 期观察到的真实仓库）。可扩展。
export const MANUAL = {
  "deepseek-ai/deepseek-harness": ["工具/开发"],
  "whiteguo233/OpenBiliClaw": ["Agent/智能体"],
  "zhu1090093659/dsh-web-ui": ["皮肤/UI"],
  "AdamPlatin123/awesome-dsh-plugins": ["工具/开发"],
  "pulseaiclub/phi": ["工具/开发"],
  "Anionex/dsh-vision-toolkit": ["内容/媒体"],
  "taxueseek/argo": ["搜索"],
  "huiliyi37/dsh-tianshu-tui": ["终端/TUI"],
  "btspoony/mstar-harness": ["Agent/智能体"],
  "omdsh-dev/DSH-better-sidebar": ["皮肤/UI"],
  "Nagi-ovo/dsh-ads": ["娱乐/广告"],
  "ccch1mneyyy/dsh-cc-tui": ["终端/TUI"],
  "Small-tailqwq/dsh-deep-whale": ["皮肤/UI"],
  "omdsh-dev/dsh-open-in-vscode": ["工具/开发"],
  "hust-open-atom-club/oh-dsh-desktop": ["工具/开发"],
};

/** 自动归类：按特异性优先级取第一个命中分类（≥1 关键词）；全部未命中 -> 工具/开发（兜底桶）。 */
export function categorize({ full_name, description, topics, readme_text }) {
  if (MANUAL[full_name]) {
    const tags = deriveTags({ topics, description, readme_text });
    return { categories: MANUAL[full_name], tags };
  }
  const nameS = (full_name || "").toLowerCase();
  const descS = (description || "").toLowerCase();
  const topicS = (topics || []).join(" ").toLowerCase();
  const readmeS = (readme_text || "").slice(0, 1500).toLowerCase();
  const scored = new Map();
  for (const { cat, topics: tks, desc: dks, readme: rks } of KEYWORD_RULES) {
    let score = 0;
    for (const k of tks) if (topicS.includes(k)) score += 3;
    for (const k of dks) if (descS.includes(k) || nameS.includes(k)) score += 3;
    for (const k of rks) if (readmeS.includes(k)) score += 1;
    if (score > 0) scored.set(cat, score);
  }
  let best = null, bestScore = 0;
  for (const cat of PRIORITY) {
    const s = scored.get(cat) || 0;
    if (s > bestScore) { bestScore = s; best = cat; }
  }
  const categories = [best || "工具/开发"];
  return { categories, tags: deriveTags({ topics, description, readme_text }) };
}

function deriveTags({ topics, description, readme_text }) {
  const set = new Set();
  for (const t of topics || []) set.add(String(t).toLowerCase());
  const hay = [description || "", (readme_text || "").slice(0, 800)].join(" ").toLowerCase();
  for (const k of ["ocr", "bilibili", "tui", "skin", "terminal", "web ui", "sidebar", "agent", "search", "vision", "vscode", "sidebar"]) {
    if (hay.includes(k)) set.add(k);
  }
  return [...set].slice(0, 8);
}