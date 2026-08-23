import { XMLParser } from "fast-xml-parser";

import type { Episode } from "@/lib/podcast";

const MAX_EPISODES = 30;

type RssItem = {
  title?: unknown;
  description?: unknown;
  pubDate?: unknown;
  guid?: unknown;
  enclosure?: { "@_url"?: unknown; "@_type"?: unknown } | Array<{ "@_url"?: unknown; "@_type"?: unknown }>;
  "itunes:image"?: { "@_href"?: unknown };
  "itunes:duration"?: unknown;
};

export async function loadFeed(feedUrl: string): Promise<Episode[]> {
  assertRemoteHttpUrl(feedUrl);

  const response = await fetch(feedUrl, {
    headers: { "User-Agent": "podcast-qa/0.1" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("The podcast feed could not be downloaded.");
  }

  const feedXml = await response.text();
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const parsed = parser.parse(feedXml) as { rss?: { channel?: { item?: RssItem | RssItem[] } } };
  const items = arrayify(parsed.rss?.channel?.item);

  const episodes = uniqueEpisodes(
    items
      .map(toEpisode)
      .filter((episode): episode is Episode => episode !== null),
  ).slice(0, MAX_EPISODES);

  if (episodes.length === 0) {
    throw new Error("This feed does not contain any playable podcast episodes.");
  }

  return episodes;
}

function uniqueEpisodes(episodes: Episode[]): Episode[] {
  const seenIds = new Set<string>();

  return episodes.filter((episode) => {
    if (seenIds.has(episode.id)) {
      return false;
    }

    seenIds.add(episode.id);
    return true;
  });
}

function toEpisode(item: RssItem): Episode | null {
  const enclosure = arrayify(item.enclosure).find(
    (candidate) => typeof candidate?.["@_url"] === "string",
  );
  const audioUrl = stringValue(enclosure?.["@_url"]);

  if (!audioUrl || !isHttpUrl(audioUrl)) {
    return null;
  }

  const title = stringValue(item.title) || "Untitled episode";
  const description = stripHtml(stringValue(item.description));
  const publishedAt = stringValue(item.pubDate);
  const sourceId = stringValue(item.guid) || audioUrl;

  return {
    id: Buffer.from(sourceId).toString("base64url"),
    title,
    description,
    publishedAt: publishedAt && !Number.isNaN(Date.parse(publishedAt)) ? publishedAt : null,
    audioUrl,
    imageUrl: stringValue(item["itunes:image"]?.["@_href"]) || null,
    durationSeconds: parseDuration(item["itunes:duration"]),
  };
}

function arrayify<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function parseDuration(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const parts = value.trim().split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  return parts.length === 1 ? parts[0] : null;
}

function assertRemoteHttpUrl(value: string): void {
  if (!isHttpUrl(value)) {
    throw new Error("Enter a valid http or https podcast feed URL.");
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}