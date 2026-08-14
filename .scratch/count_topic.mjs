// 统计 topic:dsh-plugin 的组成：总 / 非fork / 非archived / 二者皆非
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const H = { "User-Agent": "dsh-dir", Accept: "application/vnd.github+json" };
async function count(q) {
  for (let i = 0; i < 5; i++) {
    const res = await fetch("https://api.github.com/search/repositories?q=" + encodeURIComponent(q) + "&per_page=1", { headers: H });
    if (res.status === 403) {
      const reset = Number(res.headers.get("x-ratelimit-reset") || 0) * 1000;
      await sleep((reset > Date.now() ? reset - Date.now() : 60000) + 2000);
      continue;
    }
    if (!res.ok) throw new Error(q + " -> " + res.status);
    const d = await res.json();
    return d.total_count;
  }
}
const qs = [
  "topic:dsh-plugin",
  "topic:dsh-plugin fork:false",
  "topic:dsh-plugin archived:false",
  "topic:dsh-plugin fork:false archived:false",
  "topic:dsh-plugin fork:true",
  "topic:dsh-plugin archived:true",
];
for (const q of qs) {
  console.log(q.padEnd(42), "->", await count(q));
  await sleep(7000);
}