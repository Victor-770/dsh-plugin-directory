// 构建期生成每个插件的 OG 图片（1200x630 PNG，纯 Node 实现，无外部依赖）。
// 用法：node scripts/og-images.mjs （在 site/ 下运行；输出到 public/og/plugin/{owner}/{repo}/index.png）
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { FONT5X7 } from "./font5x7.js";

// ---------- PNG 编码 ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(w, h, rgba) {
  const src = Buffer.isBuffer(rgba) ? rgba : Buffer.from(rgba);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    src.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// ---------- 渲染 ----------
const W = 1200, H = 630;
const BG = [11, 14, 20], PANEL = [18, 22, 34], ACCENT = [79, 140, 255], INK = [230, 233, 240], MUTED = [139, 147, 167];

function drawRect(px, x, y, w, h, rgb) {
  for (let yy = y; yy < y + h && yy < H; yy++) {
    if (yy < 0) continue;
    for (let xx = x; xx < x + w && xx < W; xx++) {
      if (xx < 0) continue;
      const i = (yy * W + xx) * 4;
      px[i] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2]; px[i + 3] = 255;
    }
  }
}
function textWidth(text, scale) { return text.length * 6 * scale; }
function drawText(px, x, y, text, scale, rgb) {
  let cx = x;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    const glyph = FONT5X7[code] || FONT5X7[63];
    for (let col = 0; col < 5; col++) {
      const b = glyph[col];
      for (let row = 0; row < 7; row++) {
        if (b & (1 << row)) drawRect(px, cx + col * scale, y + row * scale, scale, scale, rgb);
      }
    }
    cx += 6 * scale;
  }
  return cx;
}

// ---------- 单图 ----------
function render(name, metaLine) {
  const px = new Uint8Array(W * H * 4);
  // 背景
  for (let i = 0; i < px.length; i += 4) { px[i] = BG[0]; px[i + 1] = BG[1]; px[i + 2] = BG[2]; px[i + 3] = 255; }
  // 顶部强调条 + 面板
  drawRect(px, 0, 0, W, 8, ACCENT);
  drawRect(px, 60, 90, 1080, 450, PANEL);
  drawRect(px, 60, 90, 1080, 8, ACCENT);
  // 标题（自动缩放，超宽换行）
  const maxW = 980;
  let scale = Math.min(10, Math.floor(maxW / (name.length * 6)));
  let lines = [name];
  if (scale < 4) {
    scale = 4;
    // 在 / - _ 空格处折行
    const parts = name.split("/");
    const a = parts.slice(0, parts.length - 1).join("/");
    const b = parts[parts.length - 1];
    lines = (a && b) ? [a + "/", b] : [name.slice(0, Math.ceil(name.length / 2)), name.slice(Math.ceil(name.length / 2))];
    while (lines.some((l) => textWidth(l, scale) > maxW) && lines.length < 3) {
      const longest = lines.reduce((m, l) => l.length > m.length ? l : m, "");
      const i = lines.indexOf(longest);
      lines.splice(i, 1, longest.slice(0, Math.ceil(longest.length / 2)), longest.slice(Math.ceil(longest.length / 2)));
    }
  }
  let ty = 190;
  for (const l of lines) { drawText(px, 100, ty, l, scale, INK); ty += 8 * scale + 20; }
  // 元信息行
  drawText(px, 100, Math.max(ty + 20, 330), metaLine, 3, MUTED);
  // 底部
  drawText(px, 100, 470, "DSH PLUGIN DIRECTORY", 3, ACCENT);
  drawText(px, 100, 500, "dsh-plugin-directory.online", 2, MUTED);
  return encodePNG(W, H, px);
}

// ---------- 主流程 ----------
const browsePath = path.join(process.cwd(), "public", "data", "browse.json");
const raw = JSON.parse(readFileSync(browsePath, "utf8"));
const plugins = raw.plugins || [];
const EN_LABELS = { "皮肤/UI": "Skins / UI", "终端/TUI": "Terminal / TUI", "工具/开发": "Tools / Dev", "搜索": "Search", "Agent/智能体": "Agents", "内容/媒体": "Media / Content", "娱乐/广告": "Fun / Ads", "其他": "Other" };
const outRoot = path.join(process.cwd(), "public", "og", "plugin");
let count = 0, t0 = Date.now();
for (const p of plugins) {
  if (typeof p.full_name !== "string" || !p.full_name.includes("/") || p.full_name.includes("..")) continue;
  const [owner, repo] = p.full_name.split("/");
  const cat = (p.categories || [])[0];
  const meta = [Number(p.stars || 0).toLocaleString("en-US") + " stars", p.language || "unknown", EN_LABELS[cat] || cat || ""].filter(Boolean).join("  |  ");
  const dir = path.join(outRoot, owner, repo);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "index.png"), render(p.full_name, meta));
  count++;
}
console.log("og images generated:", count, "in", ((Date.now() - t0) / 1000).toFixed(1) + "s");