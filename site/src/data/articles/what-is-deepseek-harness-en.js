export const articleEn = {
  slug: "what-is-deepseek-harness",
  lang: "en",
  title: "What Is DeepSeek Harness? The \"Everything Is a Plugin\" Coding Agent, Explained",
  pageTitle: "What Is DeepSeek Harness (dsh)? Everything-Is-a-Plugin Explained",
  pageDescription: "Discover DeepSeek Harness (dsh), DeepSeek's open-source agent harness where everything is a plugin. Learn how it works, explore the ecosystem, and try it in one command.",
  publishedAt: "2026-08-22",
  updatedAt: "2026-08-22",
  author: "DSH Plugin Directory editorial team",
  category: "Explainer",
  tags: ["DeepSeek Harness", "dsh", "Agent Harness", "Cordis", "Claude Code"],
  readingTime: "6 min read",
  snippet: "What is DeepSeek Harness? DeepSeek Harness (CLI dsh) is DeepSeek's open-source agent harness, released in August 2026 as a v0.1 developer preview under the MIT license. It wraps everything around a language model (tools, sessions, sandboxes, approval policies, and the agent loop) so a model can act instead of just answer. Its core idea: everything is a plugin (DeepSeek, 2026).",
  faq: [
    {
      q: "Is DeepSeek Harness free and open source?",
      a: "Yes. DeepSeek Harness is released under the MIT license, and it hit an open-source v0.1 developer preview in August 2026."
    },
    {
      q: "What is the Cordis plugin kernel?",
      a: "Cordis is the plugin kernel DeepSeek Harness runs on. It handles plugin mounting, unmounting, and dependencies, and lets every capability (models, tools, skills, sessions, sandboxes, storage, loops, scheduling, UI) live as a plugin."
    },
    {
      q: "Can I use other models like Claude or GPT with DeepSeek Harness?",
      a: "Yes. Model support is a plugin, and DeepSeek Harness supports multi-model routing with hot-swappable model providers, so it is not locked to one model family."
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
    <h2 id="introduction">Introduction</h2>
    <p>A language model on its own is a fast talker. It can read code, explain a repository, and suggest a fix, but it cannot safely open your project, run a test, remember yesterday's decision, or keep working until the job is done. The software that supplies all of that (tooling, sessions, sandboxes, permission policies, and the loop that drives the model) is called an <strong>agent harness</strong>. What is DeepSeek Harness? It is DeepSeek's open-source implementation of exactly that harness, shipped under the name <code>dsh</code>.</p>
    <p>The official tagline is four words: everything is a plugin. The slogan is accurate, but the practical part is the ecosystem. People install plugins to change how the agent looks, what tools it can call, and how it works with your files. This article covers what <code>dsh</code> is, why its plugin model matters, what you can install, and whether it is the right tool for you. You will also see how to run it in one command and what it lets you build (deepseekharness.io, 2026).</p>

    <h2 id="what-is-an-agent-harness">What Is an Agent Harness? Model + Harness = Agent</h2>
    <p>The fastest way to place DeepSeek Harness in the AI stack is a two-part equation: <strong>Model + Harness = Agent</strong> (deepseekharness.io, 2026). A model reasons; an agent acts. The harness is the difference between the two.</p>
    <p>The model handles reading code, planning a change, and writing a diff. On its own it is text in, text out. It cannot touch your files, run your tests, or hold a long-running plan. The harness is everything around that model, and DeepSeek Harness contributes five concrete layers that turn raw model output into working software:</p>
    <ul>
      <li><strong>Tools</strong> are the actions the model can take, such as reading or editing files and running commands.</li>
      <li><strong>Sessions</strong> carry persistent context, so the agent remembers a task across turns instead of starting cold.</li>
      <li><strong>Sandboxes</strong> keep command execution contained so it does not touch your whole machine.</li>
      <li><strong>Approval policies</strong> are the gates that decide when the model acts on its own and when it has to ask you.</li>
      <li><strong>The agent loop</strong> is the driver that keeps the model working until the task is finished.</li>
    </ul>
    <p>Put those on top of a model and you get an agent that can read and edit workspace files, run commands, delegate work, and maintain a plan. The same model produces a better agent when the harness is better, which is why DeepSeek shipped the harness as its own product instead of folding it into the model. It is also why the ecosystem around it matters so much (DeepSeek, 2026).</p>

    <h2 id="why-everything-is-a-plugin">Why "Everything Is a Plugin"? The Cordis Architecture</h2>
    <p>Most agent frameworks are built like a car with a fixed engine and a few bolt-on accessories. A privileged core does the important work, and extensions snap onto it through narrowly defined hooks. DeepSeek Harness turns that around. There is no privileged core to patch. Every capability is a plugin, and the plugins are the whole machine (GitHub, 2026).</p>
    <p>The mechanism is <strong>Cordis</strong>, the plugin kernel DeepSeek Harness runs on. Its design is described in the paper <em>A Programming Paradigm for Spatiotemporal Composability</em>. The Cordis kernel manages plugin mounting, unmounting, and dependencies, the plumbing that lets plugins register, start, stop, and talk to one another through services and events (DeepSeek, 2026).</p>
    <p>The list of what counts as a plugin is long. Plugins provide models, tools, skills, sessions, sandboxes, storage, loops, scheduling, and even the user interface (DeepSeek, 2026). Nothing sits outside the plugin system as a core feature. To change how the UI looks, how the agent routes to a model, or how it schedules long-running work, you reach for a plugin rather than a config flag buried in the source.</p>
    <p>This design adds a second useful property: <strong>every run is traceable</strong> (DeepSeek, 2026). Because each capability is a discrete, mounted plugin, you can inspect what was loaded, when it ran, and how the pieces composed to produce a result. That is more transparent than a monolith with hidden internal wiring. It is also why the documentation describes the architecture as a set of subsystems (plugins, the event system, the session system, model routing) rather than a black box (DeepSeek Docs, 2026).</p>

    <h2 id="plugin-ecosystem">The DeepSeek Harness Plugin Ecosystem: A Real Tour</h2>
    <p>That is the theory. Here is the part most explainers skip: the plugins themselves. Because everything is a plugin, the ecosystem naturally falls into categories, and those categories are what make <code>dsh</code> discoverable and useful. The tour below reflects how the ecosystem actually shapes up today (DSH Plugin Directory, 2026).</p>
    <p>For the interface, skins and UI plugins change how the agent looks and behaves. Two real examples are <a href="/en/plugin/ruvnet/voyager/">dsh-web-ui</a> and <a href="/en/plugin/omdsh-dev/DSH-better-sidebar/">dsh-deep-whale</a>, both of which restyle the default web interface. Terminal-first users get a separate set. <a href="/en/plugin/nexu-io/open-design/">open-design</a> and <a href="/en/plugin/esengine/DeepSeek-Reasonix/">DeepSeek-Reasonix</a> are popular terminal-side additions, and under tools and dev, <a href="/en/plugin/anywhere-labs/deepseek-harness-desktop/">deepseek-harness-desktop</a> puts <code>dsh</code> in a local desktop app.</p>
    <p>For retrieval and memory, search plugins give the agent better recall over your own project or the web. <a href="/en/plugin/liustack/modsearch/">modsearch</a> and <a href="/en/plugin/csyangwen/dsh-memory-evolve/">dsh-memory-evolve</a> are two examples. The largest and fastest-moving group is agents: sub-agent orchestration, skill packs, and multi-agent collaboration. Names like <a href="/en/plugin/ruvnet/ruflo/">ruflo</a>, <a href="/en/plugin/volcengine/OpenViking/">OpenViking</a>, and <a href="/en/plugin/titanwings/colleague-skill/">colleague-skill</a> show the range, from swarm-style coordination to personalised skill companions.</p>
    <p>Media and content plugins handle asset and content generation. <a href="/en/plugin/Molunerfinn/PicGo/">PicGo</a> handles image uploading, <a href="/en/plugin/liustack/modlens/">modlens</a> adds visual model capabilities, and <a href="/en/plugin/Alisa0808/vox-director/">vox-director</a> covers voice and media. Then there are the lighter touches. <a href="/en/plugin/Nagi-ovo/dsh-ads/">dsh-ads</a>, <a href="/en/plugin/Ayase34/gal-view/">gal-view</a>, and <a href="/en/plugin/yyh-001/dsh-meme/">dsh-meme</a> add personality and side experiments (DSH Plugin Directory, 2026).</p>
    <p>This is the payoff of the plugin architecture. Because each capability is a plugin, the directory is not a flat list. It is a category-shaped landscape you can browse by intent. If you want a nicer interface, a sharper terminal, a smarter memory layer, or a multi-agent setup, there is a category for it, with a curated set of plugins to start from.</p>

    <h2 id="how-to-try">How to Try DeepSeek Harness</h2>
    <p>Getting a running instance takes one command, with no build step and no source checkout, if you already have Node.js installed:</p>
    <pre><code>npx @deepseek-ai/dsh web</code></pre>
    <p>That starts the Web UI at <code>http://127.0.0.1:3080</code> by default and opens it in your browser for a local launch. Over SSH the host URL is printed instead, because the SSH client or editor owns the local forwarded address. Pass <code>--no-open</code> to run the server without opening a browser (GitHub, 2026).</p>
    <p>To run from source, clone the repository, install, build, and launch the built artifacts:</p>
    <pre><code>git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web</code></pre>
    <p>Expect it to change. DeepSeek Harness is a developer preview and is iterating rapidly, with compatibility-breaking changes expected (GitHub, 2026). The plugin API you build against or install today may shift tomorrow. That speed is a feature for an ecosystem, but it also means treating any plugin you rely on as a moving target.</p>

    <h2 id="is-it-right-for-you">Is DeepSeek Harness Right for You?</h2>
    <p>It helps to say what DeepSeek Harness is not, because three confusions come up often. It is not a new foundation model, not a model-training framework, and not a turnkey replacement for a mature product (dev.to, 2026).</p>
    <p>The people it fits are the ones who want control and composability. If you want to swap models, wire in your own tools, keep everything local and self-hosted, and understand exactly how each capability behaves, the plugin-first design is the point. Plugin builders and tinkerers are the natural early adopters, because the harness is built for extension. Every capability you want to tweak or replace is a plugin you can write or install (dev.to, 2026).</p>
    <p>If you need a stable, mature, zero-maintenance tool with a frozen API and official support, the developer-preview status is a real cost. Expect unfinished edges and breaking changes. That is a stage-of-life signal rather than a flaw in the ecosystem: it is early, powerful, and changing fast. The everything-is-a-plugin tradeoff cuts both ways, maximum flexibility on one side and a moving target on the other (GitHub, 2026).</p>

    <h2 id="comparison">DeepSeek Harness vs Claude Code vs Codex: Where It Fits</h2>
    <p>A question newcomers often ask is how this compares to Claude Code or Codex. The short answer is a difference in kind, not just in features. DeepSeek Harness is a plugin-first harness and framework, the substrate you compose an agent from. Claude Code and Codex are mature turnkey CLIs you run and use. <code>dsh</code> gives you more of a construction kit; the others give you a finished tool (DeepSeek Docs, 2026).</p>
    <div class="table-container my-6 overflow-x-auto">
      <table class="w-full text-left border-collapse">
        <caption class="text-xs text-muted mb-2 text-left">A quick comparison of the three coding agents across the attributes that matter most.</caption>
        <thead>
          <tr class="border-b border-line bg-surface2">
            <th scope="col" class="p-3 font-semibold text-ink">Attribute</th>
            <th scope="col" class="p-3 font-semibold text-accent">DeepSeek Harness (dsh)</th>
            <th scope="col" class="p-3 font-semibold text-ink">Claude Code</th>
            <th scope="col" class="p-3 font-semibold text-ink">Codex / Commercial CLI</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line text-sm">
          <tr>
            <th scope="row" class="p-3 font-medium text-ink bg-surface/50">Core positioning</th>
            <td class="p-3">Plugin-first agent harness / framework</td>
            <td class="p-3">Turnkey end-to-end coding assistant</td>
            <td class="p-3">Commercial code generation and completion tool</td>
          </tr>
          <tr>
            <th scope="row" class="p-3 font-medium text-ink bg-surface/50">Architecture philosophy</th>
            <td class="p-3">Everything is a plugin (Cordis kernel)</td>
            <td class="p-3">Highly integrated, works out of the box</td>
            <td class="p-3">Proprietary core with limited extension points</td>
          </tr>
          <tr>
            <th scope="row" class="p-3 font-medium text-ink bg-surface/50">Model support</th>
            <td class="p-3">Multi-model routing, hot-swappable</td>
            <td class="p-3">Bound to the Claude model family</td>
            <td class="p-3">Bound to specific proprietary models</td>
          </tr>
          <tr>
            <th scope="row" class="p-3 font-medium text-ink bg-surface/50">Best for</th>
            <td class="p-3">Developers, plugin builders, self-hosted customization</td>
            <td class="p-3">Engineers who want an out-of-the-box workflow</td>
            <td class="p-3">Enterprise and standard development workflows</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p>That is not a judgment of better or worse. It is a different use case. If your goal is to extend, self-host, and understand the machinery, <code>dsh</code> is built for that. If your goal is to install a polished product and go, the comparison favours the turnkey options.</p>

    <h2 id="conclusion">Conclusion: It Is the Harness, Not the Model</h2>
    <p>So what is DeepSeek Harness? It is the harness, not the model. A model alone answers; the harness turns that into an agent that can read your files, run commands, and keep a plan. By shipping all of that harness as plugins, DeepSeek made the software both transparent and easy to compose (deepseekharness.io, 2026).</p>
    <p>The takeaway is that the ecosystem is real and category-shaped. Whether you want to restyle the interface, sharpen the terminal, add memory and search, or stand up a multi-agent workflow, there is a plugin category for it and a directory to browse. Start with one command, <code>npx @deepseek-ai/dsh web</code>, then see what the plugin ecosystem can do on top of it (The Register, 2026).</p>
  `
};
