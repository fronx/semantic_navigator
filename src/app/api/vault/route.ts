import { NextRequest, NextResponse } from "next/server";
import { browseVault, estimateImportCost } from "@/lib/vault";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const path = searchParams.get("path") || "";
  const vaultPath = process.env.VAULT_PATH;

  if (!vaultPath) {
    return NextResponse.json(
      { error: "VAULT_PATH not configured" },
      { status: 500 }
    );
  }

  const entries = await browseVault(vaultPath, path);
  return NextResponse.json({ entries, currentPath: path });
}

export async function POST(request: NextRequest) {
  const { paths } = await request.json();
  const vaultPath = process.env.VAULT_PATH;

  if (!vaultPath) {
    return NextResponse.json(
      { error: "VAULT_PATH not configured" },
      { status: 500 }
    );
  }

  const estimate = await estimateImportCost(vaultPath, paths);
  return NextResponse.json(estimate);
}
