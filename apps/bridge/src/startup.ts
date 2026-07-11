import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function registerStartup() {
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