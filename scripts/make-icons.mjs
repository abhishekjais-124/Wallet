// Renders web/public/icons/icon.svg into the PNG sizes the manifest needs with headless Chrome.
// Run: node scripts/make-icons.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = path.resolve(import.meta.dirname, "..", "web", "public", "icons");
const chrome = process.env.CHROME_BIN
  ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome");
const svg = fs.readFileSync(path.join(dir, "icon.svg"), "utf8");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wallet-icons-"));

function render(name, size, padding = 0) {
  const inner = size - 2 * padding;
  const html = `<!doctype html><html><body style="margin:0;background:${padding ? "#111318" : "transparent"};width:${size}px;height:${size}px;display:grid;place-items:center">${svg.replace(/width="512" height="512"/, `width="${inner}" height="${inner}"`)}</body></html>`;
  const file = path.join(tmp, `${name}.html`);
  fs.writeFileSync(file, html);
  const out = path.join(dir, name);
  execFileSync(chrome, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--default-background-color=00000000",
    `--window-size=${size},${size}`, `--screenshot=${out}`, `file://${file}`,
  ], { stdio: "ignore" });
  console.log("wrote", out);
}

render("icon-192.png", 192);
render("icon-512.png", 512);
render("icon-512-maskable.png", 512, 64);
fs.rmSync(tmp, { recursive: true, force: true });
