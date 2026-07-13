import { createServer, IncomingMessage, Server, ServerResponse } from "http";
import { BridgeConfig, saveConfig } from "./config.js";
import os from "os";
import path from "path";

const PAIRING_PORT = 42137;
const BRIDGE_VERSION = "0.2.8";

interface PairingServerOptions {
  isPaired: () => boolean;
  onPair: (config: BridgeConfig) => void | Promise<void>;
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>
) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Content-Type": "application/json",
  });
  res.end(JSON.stringify(body));
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (err) {
        reject(err);
      }
    });

    req.on("error", reject);
  });
}

export function startPairingServer({
  isPaired,
  onPair,
}: PairingServerOptions): Promise<Server> {
  const server = createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      sendJson(res, 204, {});
      return;
    }

    if (req.method === "GET" && req.url === "/status") {
      sendJson(res, 200, {
        running: true,
        paired: isPaired(),
        version: BRIDGE_VERSION,
      });
      return;
    }

    if (req.method === "POST" && req.url === "/pair") {
      let body: Record<string, unknown>;

      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, { error: "Invalid JSON body" });
        return;
      }

      const { serverUrl, apiKey } = body;

      if (typeof serverUrl !== "string" || !serverUrl.trim()) {
        sendJson(res, 400, { error: "serverUrl is required" });
        return;
      }

      if (typeof apiKey !== "string" || !apiKey.trim()) {
        sendJson(res, 400, { error: "apiKey is required" });
        return;
      }

      const requestedAgentsDir = body.agentsDir;
      const agentsDir =
        typeof requestedAgentsDir === "string" &&
        requestedAgentsDir.startsWith("~/")
          ? path.join(os.homedir(), requestedAgentsDir.slice(2))
          : typeof requestedAgentsDir === "string" && requestedAgentsDir
            ? requestedAgentsDir
            : path.join(os.homedir(), ".scout", "agents");

      const config: BridgeConfig = {
        serverUrl: serverUrl.replace(/\/+$/, ""),
        apiKey,
        agentsDir,
      };

      try {
        saveConfig(config);
        await onPair(config);
        console.log("Bridge paired successfully.");
        sendJson(res, 200, { success: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Pairing failed";
        console.error(`Pairing failed: ${message}`);
        sendJson(res, 500, { error: message });
      }
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  });

  return new Promise((resolve, reject) => {
    server.listen(PAIRING_PORT, "127.0.0.1", () => {
      console.log(`Pairing server listening on http://localhost:${PAIRING_PORT}`);
      resolve(server);
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        console.log(
          `Pairing server already running on http://localhost:${PAIRING_PORT}`
        );
      }

      reject(err);
    });
  });
}
