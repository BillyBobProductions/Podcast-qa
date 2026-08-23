import type { PodcastSearchResult } from "@/lib/podcast";

const ITUNES_SEARCH_URL = "https://itunes.apple.com/search";
const MAX_RESULTS = 50;

type ItunesResult = {
  collectionId?: unknown;
  collectionName?: unknown;
  artistName?: unknown;
  artworkUrl600?: unknown;
  artworkUrl100?: unknown;
  feedUrl?: unknown;
  primaryGenreName?: unknown;
  genres?: unknown;
};

export async function searchPodcasts(
  term: string,
  country: string,
): Promise<PodcastSearchResult[]> {
  const query = term.trim();
  const storefront = country.trim().toUpperCase();

  if (query.length < 2 || query.length > 120) {
    throw new Error("Enter between 2 and 120 characters to search podcasts.");
  }

  if (!/^[A-Z]{2}$/.test(storefront)) {
    throw new Error("Select a valid two-letter podcast catalog region.");
  }

  const url = new URL(ITUNES_SEARCH_URL);
  url.searchParams.set("term", query);
  url.searchParams.set("media", "podcast");
  url.searchParams.set("limit", String(MAX_RESULTS));
  url.searchParams.set("country", storefront);

  const response = await fetch(url, {
    headers: { "User-Agent": "podcast-qa/0.1" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Podcast search is temporarily unavailable.");
  }

  const payload = (await response.json()) as { results?: unknown };
  const results = Array.isArray(payload.results) ? payload.results : [];

  return results
    .map(toPodcastSearchResult)
    .filter((result): result is PodcastSearchResult => result !== null);
}

function toPodcastSearchResult(value: unknown): PodcastSearchResult | null {
  if (!isRecord(value)) {
    return null;
  }

  const result = value as ItunesResult;
  const id = identifierValue(result.collectionId);
  const title = stringValue(result.collectionName);

  if (!id || !title) {
    return null;
  }

  const genres = Array.isArray(result.genres)
    ? result.genres.filter((genre): genre is string => typeof genre === "string")
    : [];
  const primaryGenre = stringValue(result.primaryGenreName);

  return {
    id,
    title,
    author: stringValue(result.artistName) || "Unknown creator",
    description: primaryGenre ? `${primaryGenre} podcast` : "Podcast",
    artworkUrl: stringValue(result.artworkUrl600) || stringValue(result.artworkUrl100) || null,
    feedUrl: stringValue(result.feedUrl) || null,
    genres,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function identifierValue(value: unknown): string {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return String(value);
  }

  return stringValue(value);
}