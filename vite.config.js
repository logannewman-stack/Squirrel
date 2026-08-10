import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  plugins: [react()],
  // The version, baked in at build time. Settings shows it, and the reason is
  // support rather than vanity: "which version are you on" is the first
  // question of every bug report, and an app that cannot answer it turns a
  // one-line reply into a conversation.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { host: true },
});
