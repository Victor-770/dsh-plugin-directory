// 中英别名表（v1 硬编码，约 60 条，双向）。查询时双向展开后再匹配。
// Object.create(null)：避免 "constructor" 等键撞原型链。
export const ALIASES = Object.assign(Object.create(null), {
  // 皮肤/UI
  "皮肤": "skin", "skin": "皮肤", "主题": "theme", "theme": "主题",
  "界面": "ui", "ui": "界面", "侧边栏": "sidebar", "sidebar": "侧边栏",
  "壁纸": "wallpaper", "wallpaper": "壁纸", "宠物": "pet", "pet": "宠物",
  "图标": "icon", "icon": "图标", "头像": "avatar", "avatar": "头像",
  // 终端
  "终端": "terminal", "terminal": "终端", "tui": "终端", "console": "终端",
  "命令行": "cli", "cli": "命令行",
  // 搜索
  "搜索": "search", "search": "搜索", "检索": "search", "查找": "search",
  // 插件/生态
  "插件": "plugin", "plugin": "插件", "皮肤中心": ["skin", "center"], "skin center": ["皮肤", "中心"],
  // 媒体/内容
  "视频": "video", "video": "视频", "图片": "image", "image": "图片",
  "截图": "screenshot", "screenshot": "截图", "字幕": "subtitle", "subtitle": "字幕",
  "音乐": "music", "music": "音乐", "新闻": "news", "news": "新闻",
  "b站": "bilibili", "bilibili": "哔哩", "哔哩": "bilibili",
  "小红书": "xiaohongshu", "xiaohongshu": "小红书", "抖音": "douyin", "douyin": "抖音",
  "微博": "weibo", "weibo": "微博",
  // 视觉/识别
  "视觉": "vision", "vision": "视觉", "识别": "ocr", "ocr": "识别",
  "图片识别": ["ocr", "识别"], "图像": "image",
  // 功能
  "下载": "download", "download": "下载", "翻译": "translate", "translate": "翻译",
  "代码": "code", "code": "代码", "聊天": "chat", "chat": "聊天",
  "模型": "model", "model": "模型", "浏览器": "browser", "browser": "浏览器",
  "工作流": "workflow", "workflow": "工作流", "工具": "tool", "tool": "工具",
  "面板": "panel", "panel": "面板", "调试": "debug", "debug": "调试",
  "测试": "test", "监控": "monitor", "monitor": "监控", "统计": "stats", "stats": "统计",
  "图表": "chart", "chart": "图表", "导出": "export", "export": "导出",
  "导入": "import", "import": "导入", "备份": "backup", "backup": "备份",
  "同步": "sync", "sync": "同步", "快捷键": "shortcut", "shortcut": "快捷键",
  "通知": "notify", "notify": "通知", "提醒": "remind", "音频": "audio", "audio": "音频",
  "语言": "language", "language": "语言", "中文": "chinese", "chinese": "中文",
  "英文": "english", "english": "英文", "文档": "docs", "docs": "文档",
  "游戏": "game", "game": "游戏", "广告": "ads", "ads": "广告",
  "微信": "wechat", "wechat": "微信", "状态": "status", "status": "状态",
  "时钟": "clock", "clock": "时钟", "动画": "animation", "animation": "动画",
  // 常用查询扩充（r4）
  "文件": "file", "file": "文件", "接口": "api", "api": "接口",
  "市场": "market", "market": "市场", "插件市场": ["plugin", "market"], "plugin market": ["插件", "市场"],
  "仓库": "repo", "repo": "仓库", "设置": "settings", "settings": "设置",
  "配置": "config", "config": "配置", "侧栏": "sidebar", "生成": "generate", "generate": "生成",
  "写作": "writing", "writing": "写作", "摘要": "summary", "summary": "摘要", "总结": "summary",
  "检查": "check", "check": "检查", "审查": "review", "review": "审查",
  "分析": "analysis", "analysis": "分析", "数据": "data", "data": "数据",
  "爬虫": "crawler", "crawler": "爬虫", "抓取": "scrape", "scrape": "抓取",
  "订阅": "subscribe", "subscribe": "订阅", "播客": "podcast", "podcast": "播客",
  "聊天机器人": "chatbot", "chatbot": "聊天", "文件管理": ["file", "manager"], "管理": "manager",
});