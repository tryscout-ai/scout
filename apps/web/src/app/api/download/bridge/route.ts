import { NextRequest, NextResponse } from "next/server";

function detectPlatform(request: NextRequest) {
  const explicitPlatform = request.nextUrl.searchParams
    .get("platform")
    ?.toLowerCase();

  if (explicitPlatform === "mac" || explicitPlatform === "darwin") {
    return "darwin";
  }

  if (explicitPlatform === "windows" || explicitPlatform === "win32") {
    return "win32";
  }

  if (explicitPlatform === "linux") {
    return "linux";
  }

  const userAgent = request.headers.get("user-agent")?.toLowerCase() ?? "";

  if (userAgent.includes("mac os x") || userAgent.includes("macintosh")) {
    return "darwin";
  }

  if (userAgent.includes("windows")) {
    return "win32";
  }

  return "linux";
}

export async function GET(request: NextRequest) {
  const platform = detectPlatform(request);
  const downloadPath =
    platform === "win32"
      ? "/downloads/ScoutBridgeSetup.exe"
      : platform === "darwin"
        ? "/downloads/ScoutBridge.dmg"
        : "/downloads/ScoutBridge.AppImage";

  return NextResponse.redirect(new URL(downloadPath, request.url));
}
