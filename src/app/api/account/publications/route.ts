import { NextResponse } from "next/server";
import { userOr401 } from "@/lib/api";
import { listStudioPublications } from "@/server/studio/publication";

export async function GET() {
  const auth = await userOr401();
  if ("response" in auth) return auth.response;
  return NextResponse.json({
    publications: await listStudioPublications(auth.userId),
  });
}
