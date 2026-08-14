// 分类落地页元数据：slug 映射 + 每分类介绍文案（避免分类页 thin content）。
// 与 STR.languages 的分类键一一对应；slug 中英共用。
export const CATEGORY_SLUGS = {
  "皮肤/UI": "skins-ui",
  "终端/TUI": "terminal-tui",
  "工具/开发": "tools-dev",
  "搜索": "search",
  "Agent/智能体": "agents",
  "内容/媒体": "media-content",
  "娱乐/广告": "fun-ads",
  "其他": "other",
};

export const CATEGORY_DESC = {
  zh: {
    "skins-ui": "为 DeepSeek Harness 换肤美化的插件：主题、皮肤、配色与 UI 定制，让界面更符合你的审美。",
    "terminal-tui": "终端与 TUI 插件：命令行增强、终端工具与字符界面应用，适合喜欢键盘操作的用户。",
    "tools-dev": "开发工具插件：脚本、脚手架、代码分析、调试辅助与自动化流水线，提升日常开发效率。",
    "search": "搜索类插件：Web 搜索、全文检索与信息获取，帮你更快找到答案。",
    "agents": "Agent 与智能体插件：子代理编排、技能包与多智能体协作，扩展 DSH 的自动化能力。",
    "media-content": "内容与媒体插件：图片、视频、音频处理与内容生成，覆盖常见创作场景。",
    "fun-ads": "娱乐与广告插件：趣味功能、游戏与广告过滤，为日常使用加点乐子。",
    "other": "未归入上述分类的 DeepSeek Harness 插件。",
  },
  en: {
    "skins-ui": "Themes, skins, color schemes and UI customization for DeepSeek Harness — make the interface your own.",
    "terminal-tui": "Terminal and TUI plugins: CLI enhancers, terminal utilities and text-interface apps for keyboard-first users.",
    "tools-dev": "Developer tooling plugins: scripts, scaffolds, code analysis, debugging aids and automation pipelines.",
    "search": "Search plugins: web search, full-text retrieval and information fetching to find answers faster.",
    "agents": "Agent plugins: sub-agent orchestration, skill packs and multi-agent collaboration on top of DSH.",
    "media-content": "Media and content plugins: image, video, audio processing and content generation for common creation workflows.",
    "fun-ads": "Fun and ads plugins: toys, games and ad-blocking extras to lighten up everyday use.",
    "other": "DeepSeek Harness plugins that do not fit the categories above.",
  },
};

// 由分类键取 slug（用于卡片 chip 链接）
export function slugFor(catKey) {
  return CATEGORY_SLUGS[catKey] || null;
}
