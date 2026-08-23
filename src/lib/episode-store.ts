import type { Episode, Transcript } from "@/lib/podcast";
import { prisma } from "@/lib/prisma";

export type StoredEpisodeHistory = Episode & {
  transcriptStatus: Transcript["status"] | "missing";
  feedUrl: string | null;
  podcastTitle: string | null;
  lastLoadedAt: string;
};

export async function saveEpisodes(items: Episode[], feedUrl?: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    let podcastId: string | null = null;

    if (feedUrl) {
      const podcast = await tx.podcast.upsert({
        where: { feedUrl },
        update: {},
        create: { feedUrl },
      });
      podcastId = podcast.id;
    }

    for (const episode of items) {
      await tx.episode.upsert({
        where: { id: episode.id },
        update: {
          title: episode.title,
          description: episode.description,
          publishedAt: parsePublishedAt(episode.publishedAt),
          audioUrl: episode.audioUrl,
          imageUrl: episode.imageUrl,
          durationSeconds: episode.durationSeconds,
          podcastId,
        },
        create: {
          id: episode.id,
          title: episode.title,
          description: episode.description,
          publishedAt: parsePublishedAt(episode.publishedAt),
          audioUrl: episode.audioUrl,
          imageUrl: episode.imageUrl,
          durationSeconds: episode.durationSeconds,
          podcastId,
        },
      });
    }
  });
}

export async function getEpisode(episodeId: string): Promise<Episode | null> {
  const episode = await prisma.episode.findUnique({ where: { id: episodeId } });

  if (!episode) {
    return null;
  }

  return {
    id: episode.id,
    title: episode.title,
    description: episode.description,
    publishedAt: episode.publishedAt?.toISOString() ?? null,
    audioUrl: episode.audioUrl,
    imageUrl: episode.imageUrl,
    durationSeconds: episode.durationSeconds,
  };
}

export async function saveTranscript(transcript: Transcript): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.episode.upsert({
      where: { id: transcript.episodeId },
      update: {},
      create: {
        id: transcript.episodeId,
        title: "Unknown episode",
        description: "",
        audioUrl: "",
      },
    });

    const saved = await tx.transcript.upsert({
      where: { episodeId: transcript.episodeId },
      update: {
        status: transcript.status,
        error: transcript.error,
      },
      create: {
        episodeId: transcript.episodeId,
        status: transcript.status,
        error: transcript.error,
      },
    });

    await tx.transcriptSegment.deleteMany({
      where: { transcriptId: saved.id },
    });

    if (transcript.segments.length === 0) {
      return;
    }

    await tx.transcriptSegment.createMany({
      data: transcript.segments.map((segment, index) => ({
        transcriptId: saved.id,
        sortOrder: index,
        startSeconds: segment.startSeconds,
        endSeconds: segment.endSeconds,
        text: segment.text,
      })),
    });
  });
}

export async function getTranscript(episodeId: string): Promise<Transcript | null> {
  const transcript = await prisma.transcript.findUnique({
    where: { episodeId },
    include: {
      segments: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  if (!transcript) {
    return null;
  }

  return {
    episodeId,
    status: transcript.status as Transcript["status"],
    error: transcript.error,
    segments: transcript.segments.map((segment) => ({
      id: segment.id,
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds,
      text: segment.text,
    })),
  };
}

export async function listRecentEpisodes(limit = 12): Promise<StoredEpisodeHistory[]> {
  const take = Number.isFinite(limit) ? Math.max(1, Math.min(Math.floor(limit), 50)) : 12;
  const episodes = await prisma.episode.findMany({
    orderBy: { updatedAt: "desc" },
    take,
    include: {
      podcast: true,
      transcript: {
        select: { status: true },
      },
    },
  });

  return episodes.map((episode) => ({
    id: episode.id,
    title: episode.title,
    description: episode.description,
    publishedAt: episode.publishedAt?.toISOString() ?? null,
    audioUrl: episode.audioUrl,
    imageUrl: episode.imageUrl,
    durationSeconds: episode.durationSeconds,
    transcriptStatus: (episode.transcript?.status as Transcript["status"] | undefined) ?? "missing",
    feedUrl: episode.podcast?.feedUrl ?? null,
    podcastTitle: episode.podcast?.title ?? null,
    lastLoadedAt: episode.updatedAt.toISOString(),
  }));
}

function parsePublishedAt(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}