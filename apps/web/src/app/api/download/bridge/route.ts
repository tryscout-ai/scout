import { NextResponse } from "next/server";

export async function GET() {
  const download = process.platform === "win32"
    ? "http://localhost:3000/downloads/ScoutBridgeSetup.exe"
    : process.platform === "darwin"
      ? "http://localhost:3000/downloads/ScoutBridge.dmg"
      : "http://localhost:3000/downloads/ScoutBridge.AppImage";

  return NextResponse.redirect(download);
}
