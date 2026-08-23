import { NextResponse } from "next/server";

import { listRecentEpisodes } from "@/lib/episode-store";

const DEFAULT_LIMIT = 12;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const rawLimit = url.searchParams.get("limit");
    const parsedLimit = rawLimit ? Number.parseInt(rawLimit, 10) : DEFAULT_LIMIT;

    if (rawLimit && (!Number.isFinite(parsedLimit) || parsedLimit <= 0)) {
      return NextResponse.json({ error: "The limit query must be a positive integer." }, { status: 400 });
    }

    const episodes = await listRecentEpisodes(parsedLimit || DEFAULT_LIMIT);
    return NextResponse.json({ episodes });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load episode history.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
