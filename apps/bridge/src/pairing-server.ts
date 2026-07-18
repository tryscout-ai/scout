import cors from "cors";
import express from "express";
import { saveConfig, BridgeConfig } from "./config.js";
import os from "os";
import path from "path";

export async function waitForPairing(): Promise<BridgeConfig> {
  const app = express();
  app.use(
  cors({
    origin: true,
  })
);

  app.use(express.json());

  return new Promise((resolve) => {
    app.post("/pair", (req, res) => {
      console.log("PAIR REQUEST RECEIVED");
      console.log("PAIR BODY:", req.body);
      const agentsDir =
  req.body.agentsDir && req.body.agentsDir.startsWith("~/")
    ? path.join(os.homedir(), req.body.agentsDir.slice(2))
    : req.body.agentsDir || path.join(os.homedir(), ".scout", "agents");

const config: BridgeConfig = {
  serverUrl: req.body.serverUrl,
  apiKey: req.body.apiKey,
  agentsDir,
};
      saveConfig(config);

      console.log("Bridge paired successfully.");

      res.json({
        success: true,
      });

      server.close();
      resolve(config);
    });

    const server = app.listen(42137, () => {
        console.log("Pairing server listening on http://localhost:42137");
    });

    app.get("/status", (_, res) => {
  res.json({
    running: true,
    paired: true,
    version: "0.2.8",
  });
});
  });
}
