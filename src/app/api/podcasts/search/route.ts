import { NextResponse } from "next/server";

import { searchPodcasts } from "@/lib/podcast-search";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const term = url.searchParams.get("q") ?? "";
  const country = url.searchParams.get("country") ?? "US";

  try {
    const podcasts = await searchPodcasts(term, country);
    return NextResponse.json({ podcasts });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to search podcasts.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}