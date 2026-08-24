import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpsRequest } from "node:https";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import ffmpegStaticPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

import { getEpisode, saveTranscript } from "@/lib/episode-store";
import type { TranscriptSegment } from "@/lib/podcast";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const CHUNK_DURATION_SECONDS = 20 * 60;
const CHUNK_BITRATE = "64k";
const TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";
const execFileAsync = promisify(execFile);
const FFMPEG_PATH = process.env.FFMPEG_PATH || ffmpegStaticPath || "ffmpeg";
const FFPROBE_PATH = process.env.FFPROBE_PATH || ffprobeStatic.path || "ffprobe";

type TranscriptionResponse = {
  segments?: Array<{ start?: unknown; end?: unknown; text?: unknown }>;
};

type OpenAiResponse = {
  status: number;
  statusText: string;
  body: string;
};

export async function transcribeEpisode(episodeId: string): Promise<void> {
  const episode = await getEpisode(episodeId);

  if (!episode) {
    throw new Error("The selected episode is no longer available. Reload the feed.");
  }

  console.info("[transcription] Starting", {
    episodeId,
    audioHost: new URL(episode.audioUrl).host,
  });

  const audioResponse = await downloadAudio(episode.audioUrl, episodeId);

  if (!audioResponse.ok || !audioResponse.body) {
    throw new Error("The episode audio could not be downloaded.");
  }

  const audioBytes = new Uint8Array(await audioResponse.arrayBuffer());

  console.info("[transcription] Audio downloaded", {
    episodeId,
    bytes: audioBytes.byteLength,
    contentType: audioResponse.headers.get("content-type"),
  });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured on the server.");
  }

  const mediaType =
    audioResponse.headers.get("content-type")?.split(";", 1)[0] || "audio/mpeg";
  const chunks = await prepareAudioChunks(audioBytes, mediaType, episodeId);
  const segments = await transcribeChunks(chunks, apiKey, episodeId);

  if (segments.length === 0) {
    throw new Error("The transcription did not contain timestamped speech.");
  }

  console.info("[transcription] Completed", { episodeId, segmentCount: segments.length });
  await saveTranscript({ episodeId, segments, status: "ready", error: null });
}

type AudioChunk = {
  bytes: Uint8Array;
  mediaType: string;
  offsetSeconds: number;
};

async function prepareAudioChunks(
  audioBytes: Uint8Array,
  mediaType: string,
  episodeId: string,
): Promise<AudioChunk[]> {
  if (audioBytes.byteLength <= MAX_AUDIO_BYTES) {
    return [{ bytes: audioBytes, mediaType, offsetSeconds: 0 }];
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "podcast-qa-"));
  const inputPath = join(temporaryDirectory, "episode-input");
  const chunkPattern = join(temporaryDirectory, "chunk-%03d.mp3");

  try {
    await writeFile(inputPath, audioBytes);
    console.info("[transcription] Splitting oversized episode", {
      episodeId,
      bytes: audioBytes.byteLength,
      chunkDurationSeconds: CHUNK_DURATION_SECONDS,
      bitrate: CHUNK_BITRATE,
    });
    await execFileAsync(FFMPEG_PATH, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-vn",
      "-ac",
      "1",
      "-b:a",
      CHUNK_BITRATE,
      "-f",
      "segment",
      "-segment_time",
      String(CHUNK_DURATION_SECONDS),
      "-reset_timestamps",
      "1",
      chunkPattern,
    ]).catch((error) => {
      throw isMissingFile(error) ? ffmpegNotFoundError(FFMPEG_PATH) : error;
    });

    const chunks: AudioChunk[] = [];
    let offsetSeconds = 0;

    for (let index = 0; ; index += 1) {
      const path = join(temporaryDirectory, `chunk-${String(index).padStart(3, "0")}.mp3`);
      try {
        const bytes = new Uint8Array(await readFile(path));
        if (bytes.byteLength > MAX_AUDIO_BYTES) {
          throw new Error("A generated audio chunk exceeded the transcription limit.");
        }

        chunks.push({ bytes, mediaType: "audio/mpeg", offsetSeconds });
        offsetSeconds += await durationSeconds(path);
      } catch (error) {
        if (isMissingFile(error)) {
          break;
        }
        throw error;
      }
    }

    if (chunks.length === 0) {
      throw new Error("FFmpeg could not create transcription chunks for this episode.");
    }

    return chunks;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function transcribeChunks(
  chunks: AudioChunk[],
  apiKey: string,
  episodeId: string,
): Promise<TranscriptSegment[]> {
  const segments: TranscriptSegment[] = [];

  for (const [index, chunk] of chunks.entries()) {
    console.info("[transcription] Sending chunk to OpenAI", {
      episodeId,
      chunk: index + 1,
      chunkCount: chunks.length,
      bytes: chunk.bytes.byteLength,
    });
    const response = await requestTranscription(chunk, apiKey, episodeId);
    const payload = JSON.parse(response.body) as TranscriptionResponse;
    const chunkSegments = normalizeSegments(payload.segments).map((segment) => ({
      ...segment,
      id: `${index}-${segment.id}`,
      startSeconds: segment.startSeconds + chunk.offsetSeconds,
      endSeconds: segment.endSeconds + chunk.offsetSeconds,
    }));
    segments.push(...chunkSegments);
  }

  return segments;
}

async function requestTranscription(
  chunk: AudioChunk,
  apiKey: string,
  episodeId: string,
): Promise<OpenAiResponse> {
  let response: OpenAiResponse;

  try {
    response = await postTranscription(chunk.bytes, chunk.mediaType, apiKey);
  } catch (error) {
    console.error("[transcription] OpenAI request could not connect", {
      episodeId,
      error: errorSummary(error),
    });
    throw new Error("The server could not connect to OpenAI. Check the development server log.", {
      cause: error,
    });
  }

  if (response.status < 200 || response.status >= 300) {
    console.error("[transcription] OpenAI rejected the request", {
      episodeId,
      status: response.status,
      statusText: response.statusText,
      error: openAiErrorSummary(response.body),
    });
    throw new Error(
      `OpenAI transcription failed with status ${response.status}. Check the development server log.`,
    );
  }

  return response;
}

function postTranscription(
  audioBytes: Uint8Array,
  mediaType: string,
  apiKey: string,
): Promise<OpenAiResponse> {
  const boundary = `podcast-qa-${crypto.randomUUID()}`;
  const beforeFile = Buffer.from(
    `${[
      `--${boundary}`,
      'Content-Disposition: form-data; name="model"',
      "",
      "whisper-1",
      `--${boundary}`,
      'Content-Disposition: form-data; name="response_format"',
      "",
      "verbose_json",
      `--${boundary}`,
      'Content-Disposition: form-data; name="timestamp_granularities[]"',
      "",
      "segment",
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="episode.mp3"',
      `Content-Type: ${mediaType}`,
      "",
    ].join("\r\n")}\r\n`,
  );
  const afterFile = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([beforeFile, Buffer.from(audioBytes), afterFile]);

  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      TRANSCRIPTIONS_URL,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.byteLength,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            statusText: response.statusMessage ?? "",
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
        response.on("error", reject);
      },
    );

    request.on("error", reject);
    request.end(body);
  });
}

async function downloadAudio(audioUrl: string, episodeId: string): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      console.info("[transcription] Downloading audio", {
        episodeId,
        attempt: attempt + 1,
      });
      const response = await fetch(audioUrl, {
        headers: { "User-Agent": "podcast-qa/0.1" },
        cache: "no-store",
      });
      console.info("[transcription] Audio host responded", {
        episodeId,
        attempt: attempt + 1,
        status: response.status,
        finalHost: new URL(response.url).host,
      });
      return response;
    } catch (error) {
      lastError = error;
      console.warn("[transcription] Audio download attempt failed", {
        episodeId,
        attempt: attempt + 1,
        error: errorSummary(error),
      });
    }
  }

  throw new Error(
    "The episode audio host could not be reached. Please try this episode again.",
    { cause: lastError },
  );
}

async function durationSeconds(path: string): Promise<number> {
  const { stdout } = await execFileAsync(FFPROBE_PATH, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    path,
  ]).catch((error) => {
    throw isMissingFile(error) ? ffmpegNotFoundError(FFPROBE_PATH) : error;
  });
  const duration = Number.parseFloat(stdout.trim());

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("FFprobe could not determine a generated audio chunk duration.");
  }

  return duration;
}

function ffmpegNotFoundError(binaryPath: string): Error {
  return new Error(
    `Could not find "${binaryPath}" on this machine. Install FFmpeg and make sure it is on PATH (restart the dev server after installing), or set FFMPEG_PATH/FFPROBE_PATH in your .env to the full executable paths.`,
  );
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function errorSummary(error: unknown): Record<string, string | undefined> {
  if (!(error instanceof Error)) {
    return { message: String(error) };
  }

  const cause = error.cause instanceof Error ? error.cause : undefined;
  return {
    name: error.name,
    message: error.message,
    causeName: cause?.name,
    causeMessage: cause?.message,
  };
}

function openAiErrorSummary(body: string): Record<string, string | undefined> {
  try {
    const payload = JSON.parse(body) as {
      error?: { type?: unknown; code?: unknown };
    };

    return {
      type: typeof payload.error?.type === "string" ? payload.error.type : undefined,
      code: typeof payload.error?.code === "string" ? payload.error.code : undefined,
    };
  } catch {
    return { type: "unparseable_error_response" };
  }
}

function normalizeSegments(value: TranscriptionResponse["segments"]): TranscriptSegment[] {
  return (value ?? [])
    .map((segment, index) => ({
      id: String(index),
      startSeconds: typeof segment.start === "number" ? segment.start : -1,
      endSeconds: typeof segment.end === "number" ? segment.end : -1,
      text: typeof segment.text === "string" ? segment.text.trim() : "",
    }))
    .filter(
      (segment) =>
        segment.startSeconds >= 0 &&
        segment.endSeconds >= segment.startSeconds &&
        segment.text.length > 0,
    );
}