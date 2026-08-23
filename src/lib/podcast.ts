export type Episode = {
  id: string;
  title: string;
  description: string;
  publishedAt: string | null;
  audioUrl: string;
  imageUrl: string | null;
  durationSeconds: number | null;
};

export type TranscriptSegment = {
  id: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
};

export type Transcript = {
  episodeId: string;
  segments: TranscriptSegment[];
  status: "pending" | "processing" | "ready" | "failed";
  error: string | null;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export type QuestionResult = {
  answer: string;
  deferred: boolean;
};

export type PodcastSearchResult = {
  id: string;
  title: string;
  author: string;
  description: string;
  artworkUrl: string | null;
  feedUrl: string | null;
  genres: string[];
};