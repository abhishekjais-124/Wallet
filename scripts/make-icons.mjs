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

// iOS and Android maskable icons get their corners cut by the system: those are drawn full-bleed (square tile), and
// the maskable one keeps the art inside the 80% safe zone
const square = svg.replace(/rx="112"/g, 'rx="0"');
const maskable = square.replace('<g id="art">', '<g id="art" transform="translate(256 256) scale(0.8) translate(-256 -256)">');

function render(name, size, source = svg) {
  const html = `<!doctype html><html><body style="margin:0;background:transparent;width:${size}px;height:${size}px">${source.replace(/width="512" height="512"/, `width="${size}" height="${size}"`)}</body></html>`;
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
render("icon-512-maskable.png", 512, maskable);
render("apple-touch-icon.png", 180, square);
fs.rmSync(tmp, { recursive: true, force: true });
