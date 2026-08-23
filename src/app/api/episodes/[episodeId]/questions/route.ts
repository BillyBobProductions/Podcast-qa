import { NextResponse } from "next/server";

import { getTranscript } from "@/lib/episode-store";
import { answerFromTranscript } from "@/lib/openai";
import {
  DEFERRED_ANSWER,
  retrieveRelevantSegments,
} from "@/lib/retrieval";

type RouteContext = {
  params: Promise<{ episodeId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { episodeId } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    question?: unknown;
    playbackSeconds?: unknown;
  } | null;

  if (
    !body ||
    typeof body.question !== "string" ||
    !body.question.trim() ||
    body.question.length > 800 ||
    (body.playbackSeconds !== undefined &&
      (typeof body.playbackSeconds !== "number" ||
        !Number.isFinite(body.playbackSeconds) ||
        body.playbackSeconds < 0))
  ) {
    return NextResponse.json({ error: "Invalid question request." }, { status: 400 });
  }

  const transcript = await getTranscript(episodeId);

  if (!transcript || transcript.status !== "ready") {
    return NextResponse.json(
      { error: "The transcript is not ready yet." },
      { status: 409 },
    );
  }

  const relevantSegments = retrieveRelevantSegments(transcript.segments, body.question);
  const contextText = relevantSegments.map((segment) => segment.text).join("\n");
  const estimatedTokens = Math.ceil((contextText.length + body.question.length) / 3.5);

  console.info("[questions] Retrieved relevant context", {
    episodeId,
    transcriptSegmentCount: transcript.segments.length,
    selectedSegmentCount: relevantSegments.length,
    estimatedInputTokens: estimatedTokens,
    selectedRange:
      relevantSegments.length > 0
        ? {
            startSeconds: Math.floor(relevantSegments[0].startSeconds),
            endSeconds: Math.floor(relevantSegments.at(-1)?.endSeconds ?? 0),
          }
        : null,
  });

  if (relevantSegments.length === 0) {
    return NextResponse.json({ answer: DEFERRED_ANSWER, deferred: true });
  }

  try {
    const answer = await answerFromTranscript(
      body.question,
      contextText,
    );

    return NextResponse.json({
      answer,
      deferred: answer === DEFERRED_ANSWER,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to answer the question.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}