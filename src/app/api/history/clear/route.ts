import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export async function POST() {
  try {
    await prisma.$transaction([
      prisma.transcriptSegment.deleteMany(),
      prisma.transcript.deleteMany(),
      prisma.episode.deleteMany(),
      prisma.podcast.deleteMany(),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to clear history.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
