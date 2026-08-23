import { NextResponse } from "next/server";

import { loadFeed } from "@/lib/feeds";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { feedUrl?: unknown } | null;

  if (!body || typeof body.feedUrl !== "string" || !body.feedUrl.trim()) {
    return NextResponse.json({ error: "A podcast RSS feed URL is required." }, { status: 400 });
  }

  try {
    const normalizedFeedUrl = body.feedUrl.trim();
    const episodes = await loadFeed(normalizedFeedUrl);
    return NextResponse.json({ episodes });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load this feed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}