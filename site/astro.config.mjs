import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  output: "static",
  // canonical 域名 = dsh-plugin-directory.online（用户指定主域名；pages.dev 子域应 301 到本域名）
  site: "https://dsh-plugin-directory.online",
  vite: { plugins: [tailwindcss()] },
});
