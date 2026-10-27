import type { RemoteSystem } from "./types";
import ubuntu from "../assets/systems/ubuntu.svg?raw";
import debian from "../assets/systems/debian.svg?raw";
import rocky from "../assets/systems/rockylinux.svg?raw";
import alpine from "../assets/systems/alpinelinux.svg?raw";
import centos from "../assets/systems/centos.svg?raw";
import fedora from "../assets/systems/fedora.svg?raw";
import redhat from "../assets/systems/redhat.svg?raw";
import arch from "../assets/systems/archlinux.svg?raw";
import suse from "../assets/systems/opensuse.svg?raw";
import linux from "../assets/systems/linux.svg?raw";
import freebsd from "../assets/systems/freebsd.svg?raw";
import apple from "../assets/systems/apple.svg?raw";
import windows from "../assets/systems/windows11.svg?raw";

const identities = {
  ubuntu: { icon: ubuntu, color: "#e95420" },
  debian: { icon: debian, color: "#d0004b" },
  rocky: { icon: rocky, color: "#009e73" },
  alpine: { icon: alpine, color: "#0d597f" },
  centos: { icon: centos, color: "#efa918" },
  fedora: { icon: fedora, color: "#315b9c" },
  redhat: { icon: redhat, color: "#df1425" },
  arch: { icon: arch, color: "#1793d1" },
  suse: { icon: suse, color: "#59a52c" },
  linux: { icon: linux, color: "#d39816" },
  freebsd: { icon: freebsd, color: "#c42127" },
  macos: { icon: apple, color: "#66718b" },
  windows: { icon: windows, color: "#087cda" },
  server: { icon: null, color: null },
} as const;
type SystemKind = keyof typeof identities;
function kind(value: string): SystemKind | undefined {
  if (/ubuntu/.test(value)) return "ubuntu";
  if (/debian/.test(value)) return "debian";
  if (/rocky/.test(value)) return "rocky";
  if (/alpine/.test(value)) return "alpine";
  if (/centos/.test(value)) return "centos";
  if (/fedora/.test(value)) return "fedora";
  if (/red.?hat|^rhel$/.test(value)) return "redhat";
  if (/arch/.test(value)) return "arch";
  if (/suse|^sles$/.test(value)) return "suse";
  if (/freebsd/.test(value)) return "freebsd";
  if (/macos|mac os|darwin|os x/.test(value)) return "macos";
  if (/windows|mingw/.test(value)) return "windows";
  if (/linux|alinux|alios|ctyunos|anolis|euler|kylin|uos|tencentos|^amzn$|^ol$/.test(value)) return "linux";
}
export function hostSystemIdentity(system?: RemoteSystem | null) {
  // The detected ID is authoritative. Names are a fallback for older cached data.
  const selected = kind(system?.id?.toLowerCase() || "")
    || kind(system?.name?.toLowerCase() || "") || "server";
  const label = system ? [system.name || system.id, system.version].filter(Boolean).join(" ") : "尚未识别操作系统";
  const identity = identities[selected];
  return { ...identity, icon: identity.icon?.replace('role="img"', 'aria-hidden="true"') ?? null, kind: selected, label };
}
