import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const mark = await readFile(new URL("../frontend/src/assets/brand/app-mark.svg", import.meta.url), "utf8");
// Browser favicon fills its tiny canvas; desktop artwork keeps native icon margins.
const favicon = mark.replace('viewBox="0 0 1024 1024"', 'viewBox="96 96 832 832"');
await writeFile(new URL("../frontend/public/favicon.svg", import.meta.url), favicon);
const browser = await chromium.launch(process.env.SSH_TOOLS_CHROMIUM ? { executablePath: process.env.SSH_TOOLS_CHROMIUM } : {});
try {
  for (const [size, source, destination] of [
    [1024, mark, "../build/appicon.png"],
    [32, favicon, "../frontend/public/favicon.png"],
    [256, mark, "../docs/images/app-logo.png"],
  ]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.goto(`data:image/svg+xml,${encodeURIComponent(source)}`);
    await page.screenshot({ path: fileURLToPath(new URL(destination, import.meta.url)), omitBackground: true });
    await page.close();
  }
} finally {
  await browser.close();
}
console.log("Generated desktop, browser and documentation icons from app-mark.svg.");
