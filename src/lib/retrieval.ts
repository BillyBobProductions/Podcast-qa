import type { TranscriptSegment } from "@/lib/podcast";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "what",
  "when",
  "where",
  "who",
  "why",
  "with",
  "you",
]);

export const DEFERRED_ANSWER =
  "I could not find enough detail in the transcript to answer that confidently.";

export function heardSegments(
  segments: TranscriptSegment[],
  playbackSeconds: number,
): TranscriptSegment[] {
  return segments.filter((segment) => segment.endSeconds <= playbackSeconds);
}

export function retrieveRelevantSegments(
  segments: TranscriptSegment[],
  question: string,
  limit = 6,
): TranscriptSegment[] {
  if (isSummaryQuestion(question)) {
    return segments.slice(-limit);
  }

  const effectiveLimit = isExplanatoryQuestion(question) ? Math.max(limit, 15) : limit;
  const queryTerms = terms(question);

  if (queryTerms.length === 0) {
    return representativeSegments(segments, effectiveLimit);
  }

  const matches = segments
    .map((segment) => ({ segment, score: score(segment.text, queryTerms) }))
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, effectiveLimit)
    .map((result) => result.segment);

  return matches.length > 0
    ? expandWithContext(segments, matches, 1, effectiveLimit * 2)
    : representativeSegments(segments, effectiveLimit);
}

function isSummaryQuestion(question: string): boolean {
  return /\b(summarize|summary|recap|overview|what (have|did) (you|we) learn)\b/i.test(
    question,
  );
}

function isExplanatoryQuestion(question: string): boolean {
  return /\b(explain|what is|what are|tell me about|describe)\b/i.test(question);
}

function representativeSegments(
  segments: TranscriptSegment[],
  limit: number,
): TranscriptSegment[] {
  if (segments.length <= limit) {
    return segments;
  }

  const firstCount = Math.ceil(limit / 2);
  const lastCount = limit - firstCount;
  return [...segments.slice(0, firstCount), ...segments.slice(-lastCount)];
}

function expandWithContext(
  allSegments: TranscriptSegment[],
  matches: TranscriptSegment[],
  radius: number,
  maxSegments: number,
): TranscriptSegment[] {
  const matchingIds = new Set(matches.map((segment) => segment.id));
  const selectedIndexes = new Set<number>();

  allSegments.forEach((segment, index) => {
    if (!matchingIds.has(segment.id)) {
      return;
    }

    for (
      let contextIndex = Math.max(0, index - radius);
      contextIndex <= Math.min(allSegments.length - 1, index + radius);
      contextIndex += 1
    ) {
      selectedIndexes.add(contextIndex);
    }
  });

  return [...selectedIndexes]
    .sort((left, right) => left - right)
    .slice(0, maxSegments)
    .map((index) => allSegments[index]);
}

function terms(value: string): string[] {
  const normalized = value.replace(/\bIIT\b/gi, "Integrated Information Theory");

  return [...new Set(normalized.toLowerCase().match(/[a-z0-9]+/g) ?? [])].filter(
    (term) => !STOP_WORDS.has(term),
  );
}

function score(text: string, queryTerms: string[]): number {
  const segmentTerms = new Set(terms(text));
  return queryTerms.reduce(
    (total, term) => total + Number(segmentTerms.has(term)),
    0,
  );
}