export const articleZh = {
  slug: "what-is-deepseek-harness",
  lang: "zh",
  title: "什么是 DeepSeek Harness？“一切皆插件”的开源 Coding Agent 深度解析",
  pageTitle: "什么是 DeepSeek Harness (dsh)？一切皆插件架构深度解析",
  pageDescription: "全面解析 DeepSeek Harness（dsh）开源 Agent 运行底座。了解 Cordis 插件架构、生态分类、快速安装上手命令，以及与 Claude Code/Codex 的核心对比。",
  publishedAt: "2026-08-22",
  updatedAt: "2026-08-22",
  author: "DSH 插件目录编辑部",
  category: "概念科普",
  tags: ["DeepSeek Harness", "dsh", "Agent 底座", "Cordis", "Claude Code"],
  readingTime: "6 分钟阅读",
  snippet: "什么是 DeepSeek Harness？DeepSeek Harness（命令行简称 dsh）是 DeepSeek 于 2026 年 8 月以 MIT 协议开源的 Agent 运行底座（v0.1 开发者预览版）。它为大语言模型包裹了工具、会话、沙箱、权限审批以及 Agent 驱动循环，让模型从“只能回答”进化为“具备行动能力”。其核心理念即为：一切皆插件（Everything is a plugin）。",
  faq: [
    {
      q: "DeepSeek Harness 是免费开源的吗？",
      a: "是的。DeepSeek Harness 采用宽松的 MIT 开源协议，于 2026 年 8 月推出了 v0.1 开发者预览版。"
    },
    {
      q: "什么是 Cordis 插件内核？",
      a: "Cordis 是 DeepSeek Harness 运行的核心插件内核。它负责插件的挂载、卸载与依赖管理，使得模型、工具、技能、会话、沙箱、存储、循环、调度乃至 UI 界面全部以插件形式存在。"
    },
    {
      q: "我可以在 DeepSeek Harness 中使用 Claude 或 GPT 等其他模型吗？",
      a: "可以。模型支持本身就是一个插件，DSH 支持多模型路由与热插拔模型提供商，不绑定单一模型家族。"
    }
  ],
  relatedPluginSlugs: [
    "ruvnet/voyager",
    "omdsh-dev/DSH-better-sidebar",
    "nexu-io/open-design",
    "esengine/DeepSeek-Reasonix",
    "anywhere-labs/deepseek-harness-desktop",
    "liustack/modsearch",
    "csyangwen/dsh-memory-evolve",
    "ruvnet/ruflo",
    "volcengine/OpenViking",
    "titanwings/colleague-skill",
    "Molunerfinn/PicGo",
    "liustack/modlens",
    "Alisa0808/vox-director"
  ],
  sources: [
    {
      publisher: "DeepSeek",
      title: "DeepSeek Harness developer preview: Everything is a plugin",
      url: "https://deepseek.com/harness/en/"
    },
    {
      publisher: "deepseekharness.io",
      title: "What Is DeepSeek Harness? DeepSeek's Open-Source Agent Harness Explained",
      url: "https://deepseekharness.io/what-is-deepseek-harness"
    },
    {
      publisher: "GitHub",
      title: "deepseek-ai/deepseek-harness: DeepSeek Harness: Everything is a Plugin",
      url: "https://github.com/deepseek-ai/deepseek-harness"
    },
    {
      publisher: "DeepSeek Docs",
      title: "What Is DSH",
      url: "https://deepseekdocs.com/en/docs/learn/intro/what-is-dsh"
    },
    {
      publisher: "dev.to",
      title: "DeepSeek Harness Explained: What It Is, When to Use It, and When Not To",
      url: "https://dev.to/aditi_gupta_8d81622a592aa/deepseek-harness-explained-what-it-is-when-to-use-it-and-when-not-to-3la3"
    },
    {
      publisher: "The Register",
      title: "DeepSeek's innovative harness treats everything as a plug-in",
      url: "https://www.theregister.com/ai-and-ml/2026/08/14/deepseeks-innovative-harness-treats-everything-as-a-plug-in/5288095"
    },
    {
      publisher: "DSH Plugin Directory",
      title: "category and index pages (curated plugin examples)",
      url: "https://dsh-plugin-directory.online/"
    }
  ],
  contentHtml: `
    <h2 id="introduction">引言：从单一模型到行动 Agent</h2>
    <p>单独的大语言模型就像一个口才极佳的演说家。它能阅读代码、解释架构、给出修复建议，但它无法安全地打开你的工程项目、运行测试用例、记住昨天的设计决策，或者持续自动执行直到任务完成。为模型提供所有这些外围支撑系统（工具、会话上下文、执行沙箱、权限审批策略以及驱动模型的循环机制）的软件框架，就叫做 <strong>Agent Harness（智能体运行底座）</strong>。那么什么是 DeepSeek Harness？它正是 DeepSeek 官方开源的 Agent 底座实现，命令行简称 <code>dsh</code>。</p>
    <p>官方的核心口号只有一句话：<strong>一切皆插件（Everything is a plugin）</strong>。口号很简练，但真正的威力在于其生态。开发者通过安装插件，可以彻底重塑 Agent 的外观界面、可调用的底层工具链以及与工程文件的交互方式。本文将系统解析 <code>dsh</code> 是什么、为什么插件化架构至关重要、生态中有哪些代表性插件、如何用一行命令快速启动，以及它是否适合你的技术工作流。</p>

    <h2 id="what-is-an-agent-harness">什么是 Agent 底座？模型 + Harness = Agent</h2>
    <p>理解 DeepSeek Harness 在现代 AI 技术栈中位置的最快方式是一个两项等式：<strong>Model（模型）+ Harness（底座）= Agent（智能体）</strong>。模型负责推理思考；底座负责赋予行动力。Harness 就是连接二者的核心桥梁。</p>
    <p>模型只处理阅读代码、制定计划、生成 Diff 补丁；本质上它是“文字进、文字出”的纯文本处理器，无法直接修改本地文件系统、运行测试套件或维持跨周期的多步骤计划。DeepSeek Harness 提供了五大具象层，将模型的原始推理转化为可运行的工程软件：</p>
    <ul>
      <li><strong>Tools（工具层）</strong>：赋予模型调用的具体动作，如文件读写、语法解析、Shell 命令执行等。</li>
      <li><strong>Sessions（会话层）</strong>：维护跨回合的持久上下文与记忆，使 Agent 无需每次冷启动。</li>
      <li><strong>Sandboxes（沙箱层）</strong>：隔离并限制命令执行环境，防止未经授权的操作影响宿主系统。</li>
      <li><strong>Approval Policies（审批策略）</strong>：安全门禁机制，界定模型何时可自主行动、何时必须向人类开发者确认授权。</li>
      <li><strong>Agent Loop（智能体循环）</strong>：状态驱动机，持续驱动模型感知环境、调用工具、评估反馈，直至任务完成。</li>
    </ul>
    <p>将这五层系统与基础模型结合，就构成了一个能真正读写工作区、执行自动化命令、派发子任务并持续推进计划的 Coding Agent。同样的底层模型，在更优秀的 Harness 驱动下会表现出成倍的工程效率。</p>

    <h2 id="why-everything-is-a-plugin">为什么“一切皆插件”？Cordis 内核架构</h2>
    <p>传统的 Agent 框架大多类似“底盘固定、加装少量外挂”的传统汽车：一个特权核心（Privileged Core）处理所有关键逻辑，第三方扩展只能通过少数受限的 Hook 接口接入。DeepSeek Harness 彻底颠覆了这种单体思路——<strong>系统不存在特权核心，每一项能力都是插件，所有插件共同组成了完整的机器</strong>。</p>
    <p>这套机制依托于 <strong>Cordis</strong> 插件内核（源自学术论文 <em>《A Programming Paradigm for Spatiotemporal Composability》</em>）。Cordis 负责插件的动态挂载、卸载与依赖解析，提供服务注册（Services）与事件驱动（Events）总线，使各个插件能够松耦合、模块化地协同工作。</p>
    <p>在 DSH 中，插件的覆盖范围极其宽广：模型路由、工具集成、Agent 技能、会话管理、执行沙箱、数据存储、驱动循环、任务调度，甚至整个 Web/TUI 用户界面，<strong>全都是可插拔的插件</strong>。如果想改造交互界面、更换多模型路由策略或自定义任务调度机制，只需引入对应插件，而无需侵入修改底座源码。</p>
    <p>这种设计带来了另一个巨大优势：<strong>全链路可追溯性（Every run is traceable）</strong>。由于每个功能点都是离散挂载的插件实体，开发者可以清晰监控各插件的加载时机、执行时序与组合结果，彻底告别单体黑盒系统的调试困境。</p>

    <h2 id="plugin-ecosystem">DeepSeek Harness 插件生态现状巡礼</h2>
    <p>因为“一切皆插件”，DSH 生态自然演进出了清晰的分类格局，使得查找与安装插件变得高度结构化：</p>
    <p>在<strong>界面与 UI</strong> 领域，<a href="/plugin/ruvnet/voyager/">dsh-web-ui</a> 和 <a href="/plugin/omdsh-dev/DSH-better-sidebar/">dsh-deep-whale</a> 提供了更现代的 Web 仪表盘重塑；终端极客可以使用 <a href="/plugin/nexu-io/open-design/">open-design</a> 与 <a href="/plugin/esengine/DeepSeek-Reasonix/">DeepSeek-Reasonix</a> 强化命令行体验；桌面端则有 <a href="/plugin/anywhere-labs/deepseek-harness-desktop/">deepseek-harness-desktop</a> 本地应用。</p>
    <p>在<strong>检索与增强记忆</strong> 领域，<a href="/plugin/liustack/modsearch/">modsearch</a> 和 <a href="/plugin/csyangwen/dsh-memory-evolve/">dsh-memory-evolve</a> 为 Agent 赋予了针对代码库及全网的深度语义检索与演进记忆能力。最活跃的 <strong>Agent 协同</strong> 领域则涌现了 <a href="/plugin/ruvnet/ruflo/">ruflo</a>、<a href="/plugin/volcengine/OpenViking/">OpenViking</a> 以及 <a href="/plugin/titanwings/colleague-skill/">colleague-skill</a>，支持从群体 Swarm 编排到个性化技能伙伴的全面扩展。</p>
    <p>在<strong>多媒体与内容生成</strong> 领域，<a href="/plugin/Molunerfinn/PicGo/">PicGo</a> 负责资产上传，<a href="/plugin/liustack/modlens/">modlens</a> 提供视觉模型分析，<a href="/plugin/Alisa0808/vox-director/">vox-director</a> 则支持语音交互。此外，<a href="/plugin/Nagi-ovo/dsh-ads/">dsh-ads</a>、<a href="/plugin/Ayase34/gal-view/">gal-view</a> 与 <a href="/plugin/yyh-001/dsh-meme/">dsh-meme</a> 等插件更为工具注入了趣味性。</p>

    <h2 id="how-to-try">如何快速体验 DeepSeek Harness</h2>
    <p>只要你的环境中安装了 Node.js，无需繁琐编译，仅需一行命令即可启动 Web 实例：</p>
    <pre><code>npx @deepseek-ai/dsh web</code></pre>
    <p>该命令默认在本地 <code>http://127.0.0.1:3080</code> 启动 Web UI 并自动在浏览器中打开。在远程 SSH 会话中，可通过添加 <code>--no-open</code> 参数仅启动服务而不弹出浏览器。</p>
    <p>若希望从源码构建并二次开发，可通过以下步骤运行：</p>
    <pre><code>git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web</code></pre>
    <p><strong>注意</strong>：DeepSeek Harness 目前处于高速迭代的 Developer Preview 阶段，插件 API 与核心契约可能会发生向前不兼容的调整。这种快速演进体现了开源生态的活力，但也意味着重度依赖时需保持对接口变动的关注。</p>

    <h2 id="is-it-right-for-you">DeepSeek Harness 适合你吗？</h2>
    <p>首先需要明确它<strong>不是</strong>什么：它不是一个新的基座大模型，不是模型训练微调框架，也不是一个封闭开箱即用的黑盒商业应用。</p>
    <p>它最适合<strong>追求高度控制力与可组合性的开发者与团队</strong>。如果你希望自由路由切换底层模型、深度定制私有工具链、全本地化自托管部署，并透彻掌控每个功能模块的执行细节，DSH 的插件化设计就是为你量身打造的施工底座。</p>
    <p>反之，如果你需要一个接口完全冻结、零维护成本、提供商业 SLA 支持的成品工具，那么现阶段处于开发者预览版的 DSH 可能需要一定的探索与适配成本。</p>

    <h2 id="comparison">横向对比：DeepSeek Harness vs Claude Code vs Codex</h2>
    <p>很多开发者会询问 DSH 与 Claude Code 或 Codex 的区别。简而言之，这是<strong>架构底座与成品应用之间的本质差异</strong>。DeepSeek Harness 是一个插件优先的 Agent 框架底座（类似于一套自由组装的高性能积木），而 Claude Code / Codex 则是高度集成、即开即用的闭箱 CLI 工具：</p>
    <div class="table-container my-6 overflow-x-auto">
      <table class="w-full text-left border-collapse">
        <caption class="text-xs text-muted mb-2 text-left">核心维度对比：三款 Coding Agent / 工具特性一览</caption>
        <thead>
          <tr class="border-b border-line bg-surface2">
            <th scope="col" class="p-3 font-semibold text-ink">特性维度</th>
            <th scope="col" class="p-3 font-semibold text-accent">DeepSeek Harness (dsh)</th>
            <th scope="col" class="p-3 font-semibold text-ink">Claude Code</th>
            <th scope="col" class="p-3 font-semibold text-ink">Codex / 商业 CLI</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line text-sm">
          <tr>
            <th scope="row" class="p-3 font-medium text-ink bg-surface/50">核心定位</th>
            <td class="p-3">插件化 Agent 运行底座 / 开发框架</td>
            <td class="p-3">开箱即用端到端编码助手</td>
            <td class="p-3">商业化代码生成与补全辅助工具</td>
          </tr>
          <tr>
            <th scope="row" class="p-3 font-medium text-ink bg-surface/50">架构哲学</th>
            <td class="p-3">Everything is a plugin（Cordis 内核）</td>
            <td class="p-3">高度集成、开箱即用闭箱设计</td>
            <td class="p-3">专有核心与特定受限扩展点</td>
          </tr>
          <tr>
            <th scope="row" class="p-3 font-medium text-ink bg-surface/50">模型支持</th>
            <td class="p-3">多模型路由、热插拔 Provider</td>
            <td class="p-3">深度绑定 Claude 系列模型</td>
            <td class="p-3">绑定特定专有商业模型</td>
          </tr>
          <tr>
            <th scope="row" class="p-3 font-medium text-ink bg-surface/50">适用场景</th>
            <td class="p-3">极客、插件开发者、私有化深度定制</td>
            <td class="p-3">追求极简开箱即用体验的工程师</td>
            <td class="p-3">企业标准化日常开发工作流</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p>这不是优劣之分，而是工程场景的分流。如果你追求极致的可扩展性、自托管与深度定制，DSH 是最佳基石；如果你只想立即获得成熟稳定的编码辅助，成品工具会更加省心。</p>

    <h2 id="conclusion">结语：决定 Agent 上限的是 Harness，而不仅是模型</h2>
    <p>模型本身只负责输出文本；正是 Harness 将其转化为了能够读写代码库、执行测试与持续推动复杂任务的生产力智能体。通过将 Harness 全部以插件形式解耦，DeepSeek 为整个开源社区提供了一个高度透明、自由演进的实验场。</p>
    <p>现在，只需一行 <code>npx @deepseek-ai/dsh web</code>，即可开启你的插件化 Agent 之旅，欢迎探索 DSH 插件目录寻找更多前沿扩展！</p>
  `
};
