// 测试 fixture：合成中英混杂插件数据（来自 spec 的测试决策）。
export const FIXTURE_RECORDS = [
  {
    full_name: "skin-maker/skin-maker", description: "Terminal skin for DSH", stars: 500,
    language: "TypeScript", pushed_at: "2026-08-01T00:00:00Z", topics: ["skin", "terminal"],
    categories: ["皮肤/UI"], tags: ["skin", "terminal"],
    readme_text: "A beautiful skin pack. Install it as a theme.",
  },
  {
    full_name: "zh-team/zh-searcher", description: "中文搜索工具", stars: 120,
    language: "Python", pushed_at: "2026-07-20T00:00:00Z", topics: ["search"],
    categories: ["搜索"], tags: ["search"],
    readme_text: "一个支持中文全文搜索的插件。搜索非常快。",
  },
  {
    full_name: "vision-lab/vision-ocr", description: "图片识别 OCR 插件", stars: 300,
    language: "TypeScript", pushed_at: "2026-08-05T00:00:00Z", topics: ["ocr", "vision"],
    categories: ["内容/媒体"], tags: ["ocr", "vision"],
    readme_text: "OCR powered image recognition for screenshots. 识别截图中的文字。",
  },
  {
    full_name: "ui-studio/dsh-web-ui", description: "Plugin and skin collection for Web UI", stars: 800,
    language: "TypeScript", pushed_at: "2026-08-10T00:00:00Z", topics: ["web-ui", "skin"],
    categories: ["皮肤/UI"], tags: ["web-ui", "skin"],
    readme_text: "Task board, git graph, right-side panel, pet, live token stats.",
  },
  {
    full_name: "media/bilibili-dl", description: "B站视频下载工具", stars: 60,
    language: "Python", pushed_at: "2026-06-01T00:00:00Z", topics: ["bilibili"],
    categories: ["内容/媒体"], tags: ["bilibili"],
    readme_text: "download bilibili videos in high quality.",
  },
  {
    full_name: "misc/random-tool", description: "misc helper", stars: 5,
    language: "Go", pushed_at: "2025-01-01T00:00:00Z", topics: [],
    categories: ["其他"], tags: [],
    readme_text: "nothing relevant here.",
  },
  {
    full_name: "readme-only/readme-only", description: "misc helper", stars: 10,
    language: "Rust", pushed_at: "2025-12-01T00:00:00Z", topics: [],
    categories: ["其他"], tags: [],
    readme_text: "this plugin is about skin care for your desktop.",
  },
];