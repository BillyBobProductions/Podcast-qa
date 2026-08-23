import { NextResponse } from "next/server";

import type { Episode } from "@/lib/podcast";
import { getEpisode, getTranscript, saveEpisodes, saveTranscript } from "@/lib/episode-store";
import { transcribeEpisode } from "@/lib/transcription";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ episodeId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { episodeId } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    episode?: unknown;
  } | null;

  const existingTranscript = await getTranscript(episodeId);

  if (existingTranscript?.status === "ready") {
    return NextResponse.json({ status: "ready" });
  }

  const existingEpisode = await getEpisode(episodeId);

  if (!existingEpisode && body?.episode) {
    const episode = body.episode as Episode;
    if (
      typeof episode === "object" &&
      episode !== null &&
      "id" in episode &&
      episode.id === episodeId &&
      "title" in episode &&
      "audioUrl" in episode
    ) {
      await saveEpisodes([episode]);
    }
  }

  await saveTranscript({
    episodeId,
    segments: [],
    status: "processing",
    error: null,
  });

  try {
    await transcribeEpisode(episodeId);
    return NextResponse.json({ status: "ready" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to transcribe episode.";
    await saveTranscript({ episodeId, segments: [], status: "failed", error: message });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}