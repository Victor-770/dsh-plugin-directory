// 生成多尺寸 favicon.ico（16/32/48/64）+ apple-touch-icon.png（180）
// 用法：node scripts/gen-favicons.mjs （在 site/ 目录下运行）
// 说明：Google 搜索结果只可靠收录 ICO/PNG 栅格图标（48x48 以上）；
//       仅提供 SVG favicon 时 Google 会一直显示默认地球占位图。
import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(join(root, "public/favicon.svg"));

// 1) apple-touch-icon.png 180x180（Apple/Safari）
await sharp(svg, { density: 600 })
  .resize(180, 180)
  .png()
  .toFile(join(root, "public/apple-touch-icon.png"));
console.log("public/apple-touch-icon.png (180x180)");

// 2) ICO：手动包装多张 PNG（16/32/48/64），Vista+ 均支持 PNG-in-ICO
const sizes = [16, 32, 48, 64];
const pngs = [];
for (const s of sizes) {
  const buf = await sharp(svg, { density: 300 })
    .resize(s, s)
    .png()
    .toBuffer();
  pngs.push({ size: s, buf });
  console.log(`  render ${s}x${s} png ${buf.length}B`);
}

// ICONDIR (6) + ICONDIRENTRY * n (16 each) + PNG data
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(pngs.length, 4);
const entries = [];
let offset = 6 + 16 * pngs.length;
for (const { size, buf } of pngs) {
  const e = Buffer.alloc(16);
  e.writeUInt8(size >= 256 ? 0 : size, 0); // width
  e.writeUInt8(size >= 256 ? 0 : size, 1); // height
  e.writeUInt8(0, 2); // palette
  e.writeUInt8(0, 3); // reserved
  e.writeUInt16LE(1, 4); // planes
  e.writeUInt16LE(32, 6); // bpp
  e.writeUInt32LE(buf.length, 8); // bytes in resource
  e.writeUInt32LE(offset, 12); // image offset
  entries.push(e);
  offset += buf.length;
}
writeFileSync(
  join(root, "public/favicon.ico"),
  Buffer.concat([header, ...entries, ...pngs.map((p) => p.buf)])
);
console.log(`public/favicon.ico (${sizes.join("/")})`);
