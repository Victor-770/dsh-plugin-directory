import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  output: "static",
  site: "https://dsh-plugin-directory.pages.dev",
  vite: { plugins: [tailwindcss()] },
});
