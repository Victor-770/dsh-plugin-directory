import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import { SITE_ORIGIN } from "../shared/site-origin.js"; // 主域名单一来源（Astro.site → 各页 canonical/sitemap）

export default defineConfig({
  output: "static",
  // canonical 域名（用户指定主域名；pages.dev 子域经 functions/_middleware.js 301 到本域名）
  site: SITE_ORIGIN,
  vite: { plugins: [tailwindcss()] },
});
