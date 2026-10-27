import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, utimesSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
const frontend = realpathSync(fileURLToPath(new URL("../frontend", import.meta.url)));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, PWD: options.cwd || root },
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

// Launch Services supplies the icon used by Finder and Stage Manager. Refresh
// this bundle's registration instead of clearing the user's system icon cache.
function refreshMacBundle() {
  if (process.platform !== "darwin") return;
  const config = JSON.parse(readFileSync(new URL("../wails.json", import.meta.url), "utf8"));
  const outputFlag = process.argv.indexOf("-o", 3);
  const name = outputFlag >= 0 ? process.argv[outputFlag + 1] : config.outputfilename || config.name;
  const bundle = new URL(`../build/bin/${encodeURIComponent(name)}.app`, import.meta.url);
  if (!existsSync(new URL("Contents/Resources/iconfile.icns", `${bundle.href}/`))) return;
  const now = new Date();
  utimesSync(bundle, now, now);
  const result = spawnSync(
    "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
    ["-f", realpathSync(fileURLToPath(bundle))],
    { cwd: root, encoding: "utf8" },
  );
  if (result.error || result.status !== 0) {
    console.warn("Could not refresh the macOS application icon:", result.error?.message || result.stderr?.trim());
  }
}

// Development and release builds share the bundle identifier and icon. Register
// the existing bundle before dev starts, and the freshly packaged release after
// a build. Canonical PWD also keeps Wails from reusing a renamed project's alias.
if (process.argv[2] === "dev") refreshMacBundle();

// Wails 2.12's binding analyser uses the Go 1.26 export format. Keep desktop
// builds reproducible even when a newer Go is installed on the developer's Mac.
run(process.platform === "win32" ? "wails.exe" : "wails", process.argv.slice(2), {
  env: { ...process.env, PWD: root, GOTOOLCHAIN: process.env.GOTOOLCHAIN || "go1.26.1" },
});

if (process.argv[2] === "build") refreshMacBundle();
