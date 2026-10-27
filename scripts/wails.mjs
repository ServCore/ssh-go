import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, utimesSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const frontend = fileURLToPath(new URL("../frontend", import.meta.url));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    ...options,
  });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Go embeds frontend/dist during binding generation, which precedes Wails'
// frontend build. Bootstrap real assets for a fresh checkout without keeping
// compiled files or placeholder HTML in the source repository.
if (!existsSync(new URL("../frontend/dist/index.html", import.meta.url))) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const options = { cwd: frontend, shell: process.platform === "win32" };
  if (!existsSync(new URL("../frontend/node_modules/vue/package.json", import.meta.url))) {
    run(npm, ["ci"], options);
  }
  run(npm, ["run", "build"], options);
}

// Wails 2.12's binding analyser uses the Go 1.26 export format. Keep desktop
// builds reproducible even when a newer Go is installed on the developer's Mac.
run(process.platform === "win32" ? "wails.exe" : "wails", process.argv.slice(2), {
  env: { ...process.env, GOTOOLCHAIN: process.env.GOTOOLCHAIN || "go1.26.1" },
});

// Replacing files inside an existing .app does not update its directory time.
// Refresh the bundle after packaging so Finder/Dock can invalidate old icons.
if (process.platform === "darwin" && process.argv[2] === "build") {
  const config = JSON.parse(readFileSync(new URL("../wails.json", import.meta.url), "utf8"));
  const outputFlag = process.argv.indexOf("-o", 3);
  const name = outputFlag >= 0 ? process.argv[outputFlag + 1] : config.outputfilename || config.name;
  const bundle = new URL(`../build/bin/${encodeURIComponent(name)}.app`, import.meta.url);
  if (existsSync(bundle)) {
    const now = new Date();
    utimesSync(bundle, now, now);
  }
}
