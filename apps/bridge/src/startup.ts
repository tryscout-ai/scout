import { exec } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { promisify } from "util";

const execAsync = promisify(exec);
const LABEL = "ai.scout.bridge";

function escapePlist(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function registerMacStartup() {
  const node = process.execPath;
  const script = process.argv[1];
  const isPackagedApp = script.includes(".app/Contents/Resources/");

  if (!isPackagedApp) {
    return;
  }

  const launchAgentsDir = join(homedir(), "Library", "LaunchAgents");
  const logDir = join(homedir(), "Library", "Logs", "Scout Bridge");
  const plistPath = join(launchAgentsDir, `${LABEL}.plist`);

  mkdirSync(launchAgentsDir, { recursive: true });
  mkdirSync(logDir, { recursive: true });

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
"http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapePlist(node)}</string>
    <string>${escapePlist(script)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapePlist(dirname(script))}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapePlist(join(logDir, "bridge.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${escapePlist(join(logDir, "bridge-error.log"))}</string>
</dict>
</plist>
`;

  writeFileSync(plistPath, plist);

  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid === null) {
    return;
  }

  await execAsync(`launchctl bootout gui/${uid} "${plistPath}"`).catch(() => {});
  await execAsync(`launchctl bootstrap gui/${uid} "${plistPath}"`).catch((err) => {
    console.error(`Unable to register Scout Bridge LaunchAgent: ${err}`);
  });

  console.log(`Registered Scout Bridge LaunchAgent at ${plistPath}`);
}

export async function registerStartup() {
  if (process.platform === "darwin") {
    await registerMacStartup();
    return;
  }

  if (process.platform !== "win32") {
    return;
  }

  const node = process.execPath;
  const script = process.argv[1];

  const command =
    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"` +
    ` /v ScoutBridge /t REG_SZ` +
    ` /d "\\"${node}\\" \\"${script}\\""` +
    ` /f`;

  console.log("process.execPath =", process.execPath);
  console.log("process.argv[1]  =", process.argv[1]);
  console.log("REG COMMAND =", command);

  await execAsync(command);

  console.log("Registered Scout Bridge to start with Windows.");
}
