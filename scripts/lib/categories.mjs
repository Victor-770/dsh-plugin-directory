// 分类体系（v1）：八分类关键词规则 + top-20 高 star 手动兜底。错误分类 v1 不修（spec 记档）。
export const CATEGORIES = ["皮肤/UI", "终端/TUI", "工具/开发", "搜索", "Agent/智能体", "内容/媒体", "娱乐/广告", "其他"];

const KEYWORD_RULES = [
  { cat: "皮肤/UI", keywords: ["skin", "theme", "web ui", "wallpaper", "sidebar", "皮肤", "主题", "界面", "宠物", "pet", "avatar", "icon", "图标", "皮肤中心", "皮肤包"] },
  { cat: "终端/TUI", keywords: ["tui", "terminal", "终端", "console", "cli", "命令行", "控制台"] },
  { cat: "搜索", keywords: ["search", "搜索", "检索", "查找"] },
  { cat: "Agent/智能体", keywords: ["agent", "智能体", "assistant", "助手", "copilot", "harness"] },
  { cat: "内容/媒体", keywords: ["bilibili", "哔哩", "video", "视频", "image", "图片", "ocr", "识别", "subtitle", "字幕", "media", "音乐", "music", "小红书", "xiaohongshu", "douyin", "抖音", "weibo", "微博", "reddit", "youtube", "知乎", "screenshot", "截图"] },
  { cat: "娱乐/广告", keywords: ["ads", "ad ", "广告", "game", "游戏", "entertainment"] },
  { cat: "工具/开发", keywords: ["tool", "工具", "dev", "开发", "vscode", "editor", "编辑器", "workflow", "工作流", "git", "debug", "调试", "test", "测试", "plugin", "插件", "web ui"] },
];

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

/** 自动归类：对 name+描述+topics+README 头部统计关键词命中，取命中最多分类；零命中 -> 其他。 */
export function categorize({ full_name, description, topics, readme_text }) {
  if (MANUAL[full_name]) {
    const tags = deriveTags({ topics, description, readme_text });
    return { categories: MANUAL[full_name], tags };
  }
  const hay = [full_name, description || "", (topics || []).join(" "), (readme_text || "").slice(0, 1500)]
    .join(" ").toLowerCase();
  let best = null, bestScore = 0;
  for (const { cat, keywords } of KEYWORD_RULES) {
    let score = 0;
    for (const k of keywords) if (hay.includes(k)) score++;
    if (score > bestScore) { bestScore = score; best = cat; }
  }
  const categories = best ? [best] : ["其他"];
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
