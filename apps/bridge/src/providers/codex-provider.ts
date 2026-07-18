import {
    LLMProvider,
    LLMRequest,
    LLMResponse,
} from "./llm-provider.js";

import { SupabaseClient } from "@supabase/supabase-js";

import { spawn, spawnSync } from "child_process";
import { delimiter, join } from "path";

export class CodexProvider implements LLMProvider {

    constructor(
        private readonly supabase: SupabaseClient,
        private readonly supabaseUrl: string,
        private readonly supabaseKey: string,
        private readonly authToken: string,
    ) {}

    private resolveExecutable(name: string) {
    if (process.platform === "win32") {
        return {
            command: `${name}.cmd`,
            argsPrefix: [],
        };
    }

    return {
        command: name,
        argsPrefix: [],
    };
}

    async generate(
    request: LLMRequest
): Promise<LLMResponse> {

    console.log("ENTERED CodexProvider.generate");

    const prompt = `${request.systemPrompt}

## Codex bridge response mode

For this one-shot Codex runner, do not send the chat reply with \`scout message send\`.
Return the exact message that should appear in chat as your final answer.

${request.userPrompt}`;

    const runnerEnv = {
        ...process.env,
        FORCE_COLOR: "0",
        NO_COLOR: "1",
        SCOUT_AGENT_ID: request.agentId,
        SCOUT_SUPABASE_URL: this.supabaseUrl,
        SCOUT_SUPABASE_KEY: this.supabaseKey,
        SCOUT_AUTH_TOKEN: this.authToken,
        PATH: [
            join(request.workingDirectory, ".scout"),
            process.env.PATH ?? "",
        ].join(delimiter),
    };

    this.ensureCodexLoggedIn(runnerEnv);

    const { command, argsPrefix } =
        this.resolveExecutable(
            process.env.SCOUT_CODEX_COMMAND || "codex"
        );

    this.assertCodexAvailable(
        command,
        argsPrefix,
        runnerEnv
    );

    const args = [
    "exec",
    "--skip-git-repo-check",
    "--json",
    "--color",
    "never",
    "--dangerously-bypass-approvals-and-sandbox",
    "-C",
    request.workingDirectory,
];

const isWindows = process.platform === "win32";

const turnProc = isWindows
    ? spawn(
          "cmd.exe",
          [
              "/d",
              "/s",
              "/c",
              command,
              ...argsPrefix,
              ...args,
          ],
          {
              cwd: request.workingDirectory,
              env: runnerEnv,
              stdio: ["pipe", "pipe", "pipe"],
              windowsHide: true,
          }
      )
    : spawn(
          command,
          [...argsPrefix, ...args],
          {
              cwd: request.workingDirectory,
              env: runnerEnv,
              stdio: ["pipe", "pipe", "pipe"],
          }
      );
      turnProc.stdin?.end(prompt);

      return await new Promise<LLMResponse>((resolve, reject) => {

    let stdout = "";
    let stderr = "";

    turnProc.stdout?.on("data", chunk => {
        stdout += chunk.toString();
    });

    turnProc.stderr?.on("data", chunk => {
        stderr += chunk.toString();
    });

    turnProc.on("error", reject);

    turnProc.on("close", code => {

        if (code !== 0) {

            reject(
                new Error(
                    stderr || `Codex exited with ${code}`
                )
            );

            return;
        }

        resolve({
            content: stdout,
        });

    });

});

}

      private ensureCodexLoggedIn(env: NodeJS.ProcessEnv) {
  const status = spawnSync("cmd.exe", [
    "/d",
    "/s",
    "/c",
    "codex",
    "login",
    "status",
  ], {
    env,
    encoding: "utf8",
    windowsHide: true,
  });

  if (status.status === 0) {
    return;
  }

  console.log("Codex not logged in. Launching login...");

  const login = spawnSync("cmd.exe", [
    "/d",
    "/s",
    "/c",
    "codex",
    "login",
  ], {
    env,
    stdio: "inherit",
    windowsHide: false,
  });

  if (login.status !== 0) {
    throw new Error("Codex login failed.");
  }
}

private assertCodexAvailable(
  command: string,
  argsPrefix: string[],
  env: NodeJS.ProcessEnv
) {
  console.log("\n========== CODEX CHECK ==========");
  console.log("Platform :", process.platform);
  console.log("Node     :", process.version);
  console.log("Command  :", command);
  console.log("Args     :", argsPrefix);
  console.log("PATH     :", env.PATH);
  console.log("=================================\n");

  const result =
  process.platform === "win32"
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", command, "--version"], {
        encoding: "utf8",
        env,
        windowsHide: true,
      })
    : spawnSync(command, [...argsPrefix, "--version"], {
        encoding: "utf8",
        env,
      });

  console.log("\n========== RESULT ==========");
  console.log("status :", result.status);
  console.log("signal :", result.signal);
  console.log("stdout :", result.stdout);
  console.log("stderr :", result.stderr);
  console.log("error  :", result.error);
  console.log("============================\n");

  if (result.status === 0) {
    return;
  }

  const detail =
    result.error?.stack ||
    result.error?.message ||
    result.stderr?.trim() ||
    result.stdout?.trim() ||
    "unknown error";

  throw new Error(`Codex CLI is unavailable.\n${detail}`);
}

}