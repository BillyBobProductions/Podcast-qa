"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

import type { ChatMessage, Episode, PodcastSearchResult } from "@/lib/podcast";

type TranscriptStatus = "idle" | "loading" | "processing" | "ready" | "error";
type EpisodeHistoryItem = Episode & {
  transcriptStatus: "pending" | "processing" | "ready" | "failed" | "missing";
  feedUrl: string | null;
  podcastTitle: string | null;
  lastLoadedAt: string;
};

const PODCAST_REGIONS = [
  { code: "US", label: "United States" },
  { code: "CA", label: "Canada" },
  { code: "GB", label: "United Kingdom" },
  { code: "AU", label: "Australia" },
  { code: "DE", label: "Germany" },
  { code: "FR", label: "France" },
  { code: "IN", label: "India" },
  { code: "JP", label: "Japan" },
];

const PLAYBACK_STORAGE_KEY = "podcast-qa-playback-seconds";

async function parseJsonResponse<T>(response: Response): Promise<T | null> {
  const bodyText = await response.text();

  if (!bodyText) {
    return null;
  }

  try {
    return JSON.parse(bodyText) as T;
  } catch {
    throw new Error(
      `Server returned an unexpected response (${response.status} ${response.statusText}).`,
    );
  }
}

export default function Home() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const answerAudioRef = useRef<HTMLAudioElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingCleanupRef = useRef<(() => void) | null>(null);
  const shouldResumePodcastRef = useRef(false);
  const [feedUrl, setFeedUrl] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchCountry, setSearchCountry] = useState("US");
  const [podcasts, setPodcasts] = useState<PodcastSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [historyEpisodes, setHistoryEpisodes] = useState<EpisodeHistoryItem[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [hasLoadedHistory, setHasLoadedHistory] = useState(false);
  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null);
  const [playbackSeconds, setPlaybackSeconds] = useState(0);
  const [transcriptStatus, setTranscriptStatus] = useState<TranscriptStatus>("idle");
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [notice, setNotice] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribingVoice, setIsTranscribingVoice] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [continuousListening, setContinuousListening] = useState(false);
  const [resumePlaybackSeconds, setResumePlaybackSeconds] = useState<number | null>(null);
  const [playbackCheckpoints, setPlaybackCheckpoints] = useState<Record<string, number>>({});
  const [isChatOpen, setIsChatOpen] = useState(false);
  const playerBarRef = useRef<HTMLDivElement>(null);
  const [playerBarHeight, setPlayerBarHeight] = useState(0);
  const [isPlayerDocked, setIsPlayerDocked] = useState(false);
  const [playerPosition, setPlayerPosition] = useState({ x: 24, y: 24 });
  const playerDragOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const hasPositionedPlayerRef = useRef(false);

  useEffect(() => {
    const playerBar = playerBarRef.current;
    if (!playerBar) {
      setPlayerBarHeight(0);
      return;
    }

    const observer = new ResizeObserver((entries) => {
      setPlayerBarHeight(entries[0]?.contentRect.height ?? 0);
    });
    observer.observe(playerBar);

    return () => observer.disconnect();
  }, [selectedEpisode, isPlayerDocked]);

  useEffect(() => {
    if (!selectedEpisode || isPlayerDocked || hasPositionedPlayerRef.current) {
      return;
    }

    const bar = playerBarRef.current;
    if (!bar) {
      return;
    }

    hasPositionedPlayerRef.current = true;
    setPlayerPosition({
      x: Math.max(0, window.innerWidth - bar.offsetWidth - 24),
      y: Math.max(0, window.innerHeight - bar.offsetHeight - 24),
    });
  }, [selectedEpisode, isPlayerDocked]);

  function undockPlayer() {
    const bar = playerBarRef.current;
    const width = bar?.offsetWidth ?? 360;
    const height = bar?.offsetHeight ?? 140;
    setPlayerPosition({
      x: Math.max(0, window.innerWidth - width - 24),
      y: Math.max(0, window.innerHeight - height - 24),
    });
    setIsPlayerDocked(false);
  }

  function handlePlayerDragPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const bar = playerBarRef.current;
    if (!bar) {
      return;
    }

    const rect = bar.getBoundingClientRect();
    playerDragOffsetRef.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePlayerDragPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const offset = playerDragOffsetRef.current;
    const bar = playerBarRef.current;
    if (!offset || !bar) {
      return;
    }

    const maxX = Math.max(0, window.innerWidth - bar.offsetWidth);
    const maxY = Math.max(0, window.innerHeight - bar.offsetHeight);
    setPlayerPosition({
      x: Math.min(Math.max(0, event.clientX - offset.x), maxX),
      y: Math.min(Math.max(0, event.clientY - offset.y), maxY),
    });
  }

  function handlePlayerDragPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    playerDragOffsetRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  useEffect(() => {
    if (!("mediaSession" in navigator)) {
      return;
    }

    if (!selectedEpisode) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
      navigator.mediaSession.setActionHandler("seekbackward", null);
      navigator.mediaSession.setActionHandler("seekforward", null);
      return;
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title: selectedEpisode.title,
      artist: "In the Moment",
      artwork: selectedEpisode.imageUrl
        ? [{ src: selectedEpisode.imageUrl, sizes: "512x512", type: "image/jpeg" }]
        : [],
    });

    navigator.mediaSession.setActionHandler("play", () => {
      void audioRef.current?.play();
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      audioRef.current?.pause();
    });
    navigator.mediaSession.setActionHandler("seekbackward", () => {
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = Math.max(0, audio.currentTime - 15);
      }
    });
    navigator.mediaSession.setActionHandler("seekforward", () => {
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + 15);
      }
    });
  }, [selectedEpisode]);

  function pausePodcastForVoiceTurn() {
    const podcastAudio = audioRef.current;
    if (!podcastAudio) {
      shouldResumePodcastRef.current = false;
      return;
    }

    shouldResumePodcastRef.current = !podcastAudio.paused;
    if (shouldResumePodcastRef.current) {
      podcastAudio.pause();
    }
  }

  async function resumePodcastAfterVoiceTurn() {
    if (!shouldResumePodcastRef.current) {
      return;
    }

    shouldResumePodcastRef.current = false;
    try {
      await audioRef.current?.play();
    } catch {
      // Ignore autoplay rejections; user can resume playback manually.
    }
  }

  async function fetchEpisodeHistory() {
    setHasLoadedHistory(true);
    setIsHistoryLoading(true);
    setPlaybackCheckpoints(loadPlaybackCheckpoints());

    try {
      const response = await fetch("/api/history/episodes?limit=10", {
        cache: "no-store",
      });
      const payload = await parseJsonResponse<{
        episodes?: EpisodeHistoryItem[];
        error?: string;
      }>(response);

      if (!response.ok || !payload?.episodes) {
        setHistoryEpisodes([]);
        if (payload?.error) {
          setNotice(payload.error);
        }
        return;
      }

      setHistoryEpisodes(payload.episodes);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to load history.");
      setHistoryEpisodes([]);
    } finally {
      setIsHistoryLoading(false);
    }
  }

  async function clearHistory() {
    if (!confirm("Delete all saved episodes and transcripts from history?")) {
      return;
    }

    setIsHistoryLoading(true);

    try {
      const response = await fetch("/api/history/clear", {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Unable to clear history.");
      }

      setHistoryEpisodes([]);
      setNotice("History cleared successfully.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to clear history.");
    } finally {
      setIsHistoryLoading(false);
    }
  }

  async function startRecording() {
    if (isRecording || isAsking || isTranscribingVoice) {
      return;
    }

    if (transcriptStatus !== "ready") {
      setNotice("Transcript must be ready before starting voice mode.");
      return;
    }

    pausePodcastForVoiceTurn();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      const silenceThreshold = 0.02;
      const silenceWindowMs = 1400;
      const maxRecordingMs = 15000;
      let lastSpeechAt = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      recorder.onstop = async () => {
        recordingCleanupRef.current?.();
        recordingCleanupRef.current = null;
        stream.getTracks().forEach((track) => track.stop());
        setIsRecording(false);
        const audioBlob = new Blob(chunks, { type: "audio/webm" });

        if (audioBlob.size < 1024) {
          setNotice("I did not catch that. Try speaking a bit louder.");
          if (continuousListening) {
            window.setTimeout(() => {
              void startRecording();
            }, 500);
          }
          return;
        }

        await transcribeVoiceQuestion(audioBlob);
      };

      const monitorId = window.setInterval(() => {
        analyser.getByteTimeDomainData(samples);
        let sumSquares = 0;

        for (const value of samples) {
          const normalized = (value - 128) / 128;
          sumSquares += normalized * normalized;
        }

        const rms = Math.sqrt(sumSquares / samples.length);
        const now = Date.now();

        if (rms >= silenceThreshold) {
          lastSpeechAt = now;
          return;
        }

        if (
          now - lastSpeechAt >= silenceWindowMs &&
          recorder.state === "recording"
        ) {
          recorder.stop();
        }
      }, 150);

      const maxTimerId = window.setTimeout(() => {
        if (recorder.state === "recording") {
          recorder.stop();
        }
      }, maxRecordingMs);

      recordingCleanupRef.current = () => {
        window.clearInterval(monitorId);
        window.clearTimeout(maxTimerId);
        void audioContext.close();
      };

      mediaRecorderRef.current = recorder;
      recorder.start(250);
      setIsRecording(true);
      setNotice("");
    } catch {
      shouldResumePodcastRef.current = false;
      setNotice("Microphone access denied or unavailable.");
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
    }
  }

  async function transcribeVoiceQuestion(audioBlob: Blob) {
    setIsTranscribingVoice(true);

    try {
      const formData = new FormData();
      formData.append("audio", audioBlob);

      const response = await fetch("/api/voice/transcribe", {
        method: "POST",
        body: formData,
      });

      const payload = await parseJsonResponse<{ text?: string; error?: string }>(
        response,
      );

      if (!response.ok || !payload?.text) {
        throw new Error(payload?.error ?? "Unable to transcribe voice.");
      }

      const question = payload.text.trim();
      if (!question) {
        throw new Error("No speech detected in audio.");
      }

      setMessage(question);
      await submitQuestion(question);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Voice transcription failed.");
    } finally {
      setIsTranscribingVoice(false);
    }
  }

  async function speakAnswer(text: string) {
    if (!voiceEnabled || !text.trim()) {
      return;
    }

    try {
      const response = await fetch("/api/voice/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        throw new Error("Voice synthesis failed.");
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);

      if (answerAudioRef.current) {
        const audio = answerAudioRef.current;
        audio.src = audioUrl;
        await audio.play();
        await new Promise<void>((resolve) => {
          const onEnd = () => {
            audio.removeEventListener("ended", onEnd);
            resolve();
          };
          audio.addEventListener("ended", onEnd);
        });
      }

      URL.revokeObjectURL(audioUrl);
    } catch (error) {
      console.warn("Voice playback failed:", error);
    }
  }

  async function loadFeedFromUrl(url: string) {
    setNotice("");
    setTranscriptStatus("loading");

    try {
      const response = await fetch("/api/feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedUrl: url }),
      });
      const payload = await parseJsonResponse<{
        episodes?: Episode[];
        error?: string;
      }>(response);

      if (!response.ok || !payload?.episodes) {
        throw new Error(payload?.error ?? "Unable to load that podcast feed.");
      }

      setEpisodes(payload.episodes);
      setSelectedEpisode(null);
      setMessages([]);
      setTranscriptStatus("idle");
      void fetchEpisodeHistory();
    } catch (error) {
      setTranscriptStatus("error");
      setNotice(error instanceof Error ? error.message : "Unable to load the feed.");
    }
  }

  async function loadFeed(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadFeedFromUrl(feedUrl);
  }

  async function searchPodcastCatalog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchTerm.trim();

    if (query.length < 2) {
      setNotice("Enter at least two characters to search podcasts.");
      return;
    }

    setNotice("");
    setIsSearching(true);

    try {
      const response = await fetch(
        `/api/podcasts/search?q=${encodeURIComponent(query)}&country=${searchCountry}`,
      );
      const payload = await parseJsonResponse<{
        podcasts?: PodcastSearchResult[];
        error?: string;
      }>(response);

      if (!response.ok || !payload?.podcasts) {
        throw new Error(payload?.error ?? "Unable to search podcasts.");
      }

      setPodcasts(payload.podcasts);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to search podcasts.");
    } finally {
      setIsSearching(false);
    }
  }

  function loadPodcastFeed(podcast: PodcastSearchResult) {
    if (!podcast.feedUrl) {
      return;
    }

    setFeedUrl(podcast.feedUrl);
    setPodcasts([]);
    void loadFeedFromUrl(podcast.feedUrl);
  }

  async function selectEpisode(episode: Episode) {
    const savedPlaybackSeconds = getSavedPlaybackSeconds(episode.id);
    setSelectedEpisode(episode);
    setPlaybackSeconds(savedPlaybackSeconds ?? 0);
    setResumePlaybackSeconds(savedPlaybackSeconds);
    setMessages([]);
    setNotice("");
    setTranscriptStatus("processing");

    try {
      const response = await fetch(`/api/episodes/${episode.id}/transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episode }),
      });
      const payload = await parseJsonResponse<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to prepare this episode.");
      }

      setTranscriptStatus("ready");
    } catch (error) {
      setTranscriptStatus("error");
      setNotice(
        error instanceof Error ? error.message : "Unable to prepare the episode.",
      );
    }
  }

  async function submitQuestion(question: string) {
    if (!selectedEpisode || transcriptStatus !== "ready") {
      setNotice("Choose an episode with a ready transcript before asking questions.");
      return;
    }

    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) {
      return;
    }

    setMessage("");
    setIsAsking(true);
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", text: trimmedQuestion },
    ]);

    try {
      const response = await fetch(
        `/api/episodes/${selectedEpisode.id}/questions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: trimmedQuestion, playbackSeconds }),
        },
      );
      const payload = await parseJsonResponse<{ answer?: string; error?: string }>(
        response,
      );

      if (!response.ok || !payload?.answer) {
        throw new Error(payload?.error ?? "Unable to answer that question.");
      }

      const answer = payload.answer;
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", text: answer },
      ]);
      await speakAnswer(answer);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to answer question.");
    } finally {
      setIsAsking(false);

      if (continuousListening && transcriptStatus === "ready") {
        window.setTimeout(() => {
          void startRecording();
        }, 400);
      } else {
        await resumePodcastAfterVoiceTurn();
      }
    }
  }

  async function askQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await submitQuestion(message);
  }

  function updatePlaybackPosition(episodeId: string, seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0) {
      return;
    }

    try {
      const stored = window.localStorage.getItem(PLAYBACK_STORAGE_KEY);
      const positions = stored ? (JSON.parse(stored) as Record<string, number>) : {};
      positions[episodeId] = Math.floor(seconds);
      window.localStorage.setItem(PLAYBACK_STORAGE_KEY, JSON.stringify(positions));
      setPlaybackCheckpoints(positions);
    } catch {
      // Ignore local storage failures and continue playback without persistence.
    }
  }

  function getSavedPlaybackSeconds(episodeId: string): number | null {
    const checkpoint = playbackCheckpoints[episodeId];
    if (Number.isFinite(checkpoint) && checkpoint >= 0) {
      return checkpoint;
    }

    try {
      const stored = window.localStorage.getItem(PLAYBACK_STORAGE_KEY);
      if (!stored) {
        return null;
      }

      const positions = JSON.parse(stored) as Record<string, number>;
      const value = positions[episodeId];
      return Number.isFinite(value) && value >= 0 ? value : null;
    } catch {
      return null;
    }
  }

  function loadPlaybackCheckpoints(): Record<string, number> {
    try {
      const stored = window.localStorage.getItem(PLAYBACK_STORAGE_KEY);
      if (!stored) {
        return {};
      }

      const parsed = JSON.parse(stored) as Record<string, unknown>;
      const checkpoints: Record<string, number> = {};

      for (const [episodeId, value] of Object.entries(parsed)) {
        if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
          checkpoints[episodeId] = Math.floor(value);
        }
      }

      return checkpoints;
    } catch {
      return {};
    }
  }

  function formatSeconds(totalSeconds: number): string {
    const wholeSeconds = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(wholeSeconds / 3600);
    const minutes = Math.floor((wholeSeconds % 3600) / 60);
    const seconds = wholeSeconds % 60;

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }

    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  const transcriptLabel =
    transcriptStatus === "processing"
      ? "Preparing timestamped transcript..."
      : transcriptStatus === "ready"
        ? "Transcript ready - ask about any part of the episode"
        : transcriptStatus === "error"
          ? "Transcript setup failed - see the message above"
        : "Transcript unavailable";

  return (
    <main className="min-h-screen bg-[#f4f1e8] text-[#17211d]">
      <div
        className="mx-auto max-w-7xl px-5 py-8 md:px-10 lg:py-12"
        style={{
          paddingBottom: selectedEpisode && isPlayerDocked ? playerBarHeight + 24 : undefined,
        }}
      >
        <section className="flex min-w-0 flex-col">
          <header className="mb-12 border-b border-[#17211d]/15 pb-7">
            <p className="font-mono text-xs font-semibold tracking-[0.18em] text-[#b8452f] uppercase">
              Listen, then ask
            </p>
            <h1 className="mt-3 max-w-3xl font-serif text-5xl leading-[0.98] md:text-7xl">
              In the moment, not after it.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-[#516159]">
              Load a podcast episode, play at your pace, and ask about any part
              once the transcript is ready.
            </p>
          </header>

          <form className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]" onSubmit={searchPodcastCatalog}>
            <label className="sr-only" htmlFor="podcast-search">
              Search podcasts
            </label>
            <input
              id="podcast-search"
              className="min-w-0 flex-1 border border-[#17211d]/25 bg-[#fffdf8] px-4 py-3 text-sm outline-none placeholder:text-[#516159] focus:border-[#b8452f]"
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search podcasts by show, creator, or topic"
            />
            <label className="sr-only" htmlFor="podcast-country">
              Podcast catalog region
            </label>
            <select
              id="podcast-country"
              className="border border-[#17211d]/25 bg-[#fffdf8] px-3 py-3 text-sm outline-none focus:border-[#b8452f]"
              value={searchCountry}
              onChange={(event) => setSearchCountry(event.target.value)}
            >
              {PODCAST_REGIONS.map((region) => (
                <option key={region.code} value={region.code}>
                  {region.label}
                </option>
              ))}
            </select>
            <button
              className="bg-[#b8452f] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#17211d] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isSearching}
              type="submit"
            >
              {isSearching ? "Searching..." : "Search"}
            </button>
          </form>

          {podcasts.length > 0 ? (
            <div className="mb-6 border-y border-[#17211d]/15">
              <p className="py-3 font-mono text-xs tracking-[0.15em] text-[#516159] uppercase">
                Podcast results
              </p>
              <ul>
                {podcasts.map((podcast) => (
                  <li
                    key={podcast.id}
                    className="flex items-center justify-between gap-4 border-t border-[#17211d]/15 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-serif text-xl leading-tight">
                        {podcast.title}
                      </p>
                      <p className="mt-1 truncate text-sm text-[#516159]">
                        {podcast.author}
                        {podcast.genres[0] ? ` · ${podcast.genres[0]}` : ""}
                      </p>
                    </div>
                    <button
                      className="shrink-0 border border-[#17211d]/25 px-3 py-2 text-xs font-semibold uppercase transition-colors hover:border-[#b8452f] hover:text-[#b8452f] disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={!podcast.feedUrl || transcriptStatus === "loading"}
                      onClick={() => loadPodcastFeed(podcast)}
                      type="button"
                    >
                      {podcast.feedUrl ? "Load feed" : "No feed"}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <form className="mb-8 flex gap-2" onSubmit={loadFeed}>
            <label className="sr-only" htmlFor="feed-url">
              Podcast RSS feed URL
            </label>
            <input
              id="feed-url"
              className="min-w-0 flex-1 border border-[#17211d]/25 bg-[#fffdf8] px-4 py-3 text-sm outline-none placeholder:text-[#516159] focus:border-[#b8452f]"
              type="url"
              value={feedUrl}
              onChange={(event) => setFeedUrl(event.target.value)}
              placeholder="Paste a podcast RSS feed URL"
              required
            />
            <button
              className="bg-[#17211d] px-5 py-3 text-sm font-semibold text-[#f4f1e8] transition-colors hover:bg-[#b8452f] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={transcriptStatus === "loading"}
              type="submit"
            >
              Load
            </button>
          </form>

          <div className="mb-8 border-t border-[#17211d]/15">
            <div className="flex items-center justify-between py-4">
              <p className="font-mono text-xs tracking-[0.15em] uppercase text-[#516159]">
                Recently loaded episodes
              </p>
              {hasLoadedHistory && historyEpisodes.length > 0 ? (
                <button
                  className="border border-[#17211d]/25 px-3 py-1.5 text-xs font-semibold uppercase transition-colors hover:border-[#b8452f] hover:text-[#b8452f] disabled:opacity-50"
                  disabled={isHistoryLoading}
                  onClick={() => void clearHistory()}
                  type="button"
                >
                  Clear history
                </button>
              ) : null}
            </div>

            {!hasLoadedHistory ? (
              <button
                className="mb-4 border border-[#17211d]/25 px-3 py-2 text-xs font-semibold uppercase transition-colors hover:border-[#b8452f] hover:text-[#b8452f]"
                onClick={() => void fetchEpisodeHistory()}
                type="button"
              >
                Show history
              </button>
            ) : null}

            {isHistoryLoading ? (
              <p className="pb-4 text-sm text-[#516159]">Loading history...</p>
            ) : historyEpisodes.length === 0 ? (
              <p className="pb-4 text-sm text-[#516159]">No saved episodes yet.</p>
            ) : (
              <ul>
                {historyEpisodes.map((episode) => (
                  <li key={`history-${episode.id}`} className="border-t border-[#17211d]/15 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="truncate font-serif text-xl leading-tight">{episode.title}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.08em] text-[#516159]">
                          {episode.transcriptStatus === "ready"
                            ? "Transcript ready"
                            : episode.transcriptStatus === "processing"
                              ? "Transcript processing"
                              : episode.transcriptStatus === "failed"
                                ? "Transcript failed"
                                : "Transcript not prepared"}
                        </p>
                        <p className="mt-1 truncate text-sm text-[#516159]">
                          Last updated {new Date(episode.lastLoadedAt).toLocaleDateString()}
                        </p>
                        {Number.isFinite(playbackCheckpoints[episode.id]) ? (
                          <p className="mt-1 text-sm font-semibold text-[#b8452f]">
                            Resume at {formatSeconds(playbackCheckpoints[episode.id])}
                          </p>
                        ) : null}
                      </div>
                      <button
                        className="shrink-0 border border-[#17211d]/25 px-3 py-2 text-xs font-semibold uppercase transition-colors hover:border-[#b8452f] hover:text-[#b8452f]"
                        onClick={() => void selectEpisode(episode)}
                        type="button"
                      >
                        Resume
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {notice ? <p className="mb-6 text-sm text-[#b8452f]">{notice}</p> : null}

          {episodes.length > 0 && !selectedEpisode ? (
            <div className="border-t border-[#17211d]/15">
              <p className="py-4 font-mono text-xs tracking-[0.15em] uppercase text-[#516159]">
                Choose an episode
              </p>
              <ul>
                {episodes.map((episode) => (
                  <li key={episode.id} className="border-t border-[#17211d]/15">
                    <button
                      className="group flex w-full items-start justify-between gap-6 py-5 text-left"
                      onClick={() => void selectEpisode(episode)}
                      type="button"
                    >
                      <span>
                        <span className="block font-serif text-2xl leading-tight group-hover:text-[#b8452f]">
                          {episode.title}
                        </span>
                        {episode.publishedAt ? (
                          <span className="mt-2 block text-sm text-[#516159]">
                            {new Date(episode.publishedAt).toLocaleDateString()}
                          </span>
                        ) : null}
                      </span>
                      <span aria-hidden="true" className="text-2xl text-[#b8452f]">
                        +
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {selectedEpisode ? (
            <div className="border-t border-[#17211d]/15 pt-7">
              <p className="font-mono text-xs tracking-[0.15em] uppercase text-[#516159]">
                Now playing
              </p>
              <h2 className="mt-3 font-serif text-4xl leading-tight">
                {selectedEpisode.title}
              </h2>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-[#516159]">
                {selectedEpisode.description}
              </p>
              <p className="mt-3 font-mono text-xs tracking-[0.12em] text-[#516159] uppercase">
                {transcriptLabel}
              </p>
            </div>
          ) : null}
        </section>
      </div>

      {isChatOpen ? (
        <aside className="fixed right-5 top-1/2 z-40 flex max-h-[70vh] w-[min(24rem,calc(100vw-2.5rem))] -translate-y-1/2 flex-col border border-[#17211d]/20 bg-[#fffdf8] p-5 shadow-[0_8px_28px_rgba(23,33,29,0.22)] md:p-7">
          <audio ref={answerAudioRef} className="hidden" />
          <div className="border-b border-[#17211d]/15 pb-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-xs font-semibold tracking-[0.16em] text-[#b8452f] uppercase">
                  Episode Q&A
                </p>
                <h2 className="mt-2 font-serif text-3xl">Ask while you listen.</h2>
              </div>
              <button
                className="shrink-0 border border-[#17211d]/25 px-3 py-2 text-xs font-semibold uppercase transition-colors hover:border-[#b8452f] hover:text-[#b8452f]"
                onClick={() => setIsChatOpen(false)}
                title="Close chat"
                type="button"
              >
                ✕
              </button>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                className={`shrink-0 border px-3 py-2 text-xs font-semibold uppercase transition-colors ${
                  voiceEnabled
                    ? "border-[#b8452f] text-[#b8452f]"
                    : "border-[#17211d]/25 text-[#516159]"
                }`}
                onClick={() => setVoiceEnabled(!voiceEnabled)}
                title={voiceEnabled ? "Voice answers on" : "Voice answers off"}
                type="button"
              >
                {voiceEnabled ? "🔊" : "🔇"}
              </button>
              <button
                className={`shrink-0 border px-3 py-2 text-xs font-semibold uppercase transition-colors ${
                  continuousListening
                    ? "border-[#b8452f] text-[#b8452f]"
                    : "border-[#17211d]/25 text-[#516159]"
                }`}
                onClick={() => setContinuousListening(!continuousListening)}
                title={
                  continuousListening
                    ? "Continuous mode on"
                    : "Continuous mode off"
                }
                type="button"
              >
                {continuousListening ? "Auto On" : "Auto Off"}
              </button>
            </div>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto py-6" aria-live="polite">
            {messages.length === 0 ? (
              <p className="max-w-sm text-sm leading-6 text-[#516159]">
                Questions unlock after the episode transcript is ready, and can
                cover the full episode.
              </p>
            ) : (
              messages.map((chatMessage) => (
                <article
                  key={chatMessage.id}
                  className={
                    chatMessage.role === "user"
                      ? "ml-7 border-l-2 border-[#b8452f] pl-4"
                      : "mr-4"
                  }
                >
                  <p className="mb-1 font-mono text-[11px] tracking-[0.14em] text-[#516159] uppercase">
                    {chatMessage.role === "user" ? "You" : "Episode"}
                  </p>
                  <p className="text-sm leading-6">{chatMessage.text}</p>
                </article>
              ))
            )}
          </div>

          <form className="border-t border-[#17211d]/15 pt-5" onSubmit={askQuestion}>
            <label className="sr-only" htmlFor="question">
              Ask about this episode
            </label>
            <textarea
              id="question"
              className="h-24 w-full resize-none border border-[#17211d]/25 bg-[#f4f1e8] p-3 text-sm outline-none placeholder:text-[#516159] focus:border-[#b8452f] disabled:opacity-50"
              disabled={transcriptStatus !== "ready" || isAsking || isRecording}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Ask about anything in this episode..."
              value={message}
            />
            <div className="mt-3 flex gap-2">
              <button
                className={`shrink-0 border px-4 py-3 text-sm font-semibold uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  isRecording
                    ? "border-[#b8452f] bg-[#b8452f] text-white animate-pulse"
                    : "border-[#17211d]/25 hover:border-[#b8452f] hover:text-[#b8452f]"
                }`}
                disabled={transcriptStatus !== "ready" || isAsking || isTranscribingVoice}
                onClick={isRecording ? stopRecording : startRecording}
                title={isRecording ? "Listening - click to stop early" : "Tap once and speak your question"}
                type="button"
              >
                {isTranscribingVoice ? "⏳" : isRecording ? "🔴" : "🎤"}
              </button>
              <button
                className="flex-1 bg-[#b8452f] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#17211d] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!message.trim() || transcriptStatus !== "ready" || isAsking || isRecording}
                type="submit"
              >
                {isAsking ? "Thinking..." : "Ask the episode"}
              </button>
            </div>
          </form>
        </aside>
      ) : (
        <button
          className="fixed bottom-24 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#b8452f] text-2xl text-white shadow-[0_8px_20px_rgba(23,33,29,0.28)] transition-colors hover:bg-[#17211d]"
          onClick={() => setIsChatOpen(true)}
          title="Ask the episode"
          type="button"
        >
          💬
        </button>
      )}

      {selectedEpisode ? (
        <div
          ref={playerBarRef}
          className={
            isPlayerDocked
              ? "fixed inset-x-0 bottom-0 z-50 border-t border-[#17211d]/20 bg-[#fffdf8] px-5 py-3 shadow-[0_-4px_16px_rgba(23,33,29,0.12)] md:px-10"
              : "fixed z-50 w-[min(22rem,calc(100vw-2.5rem))] border border-[#17211d]/20 bg-[#fffdf8] px-4 py-3 shadow-[0_8px_28px_rgba(23,33,29,0.28)]"
          }
          style={isPlayerDocked ? undefined : { left: playerPosition.x, top: playerPosition.y }}
        >
          <div className={isPlayerDocked ? "mx-auto flex max-w-7xl items-center gap-4" : "flex flex-col gap-2"}>
            {isPlayerDocked ? null : (
              <div
                className="-mx-4 -mt-3 mb-1 flex cursor-move items-center justify-between border-b border-[#17211d]/15 px-4 py-2 touch-none select-none"
                onPointerDown={handlePlayerDragPointerDown}
                onPointerMove={handlePlayerDragPointerMove}
                onPointerUp={handlePlayerDragPointerUp}
              >
                <span className="font-mono text-[10px] tracking-[0.14em] text-[#516159] uppercase">
                  ⠿ Drag to move
                </span>
                <button
                  className="text-xs font-semibold uppercase text-[#516159] hover:text-[#b8452f]"
                  onClick={() => setIsPlayerDocked(true)}
                  title="Dock player"
                  type="button"
                >
                  Dock
                </button>
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-serif text-lg leading-tight">
                {selectedEpisode.title}
              </p>
              <audio
                ref={audioRef}
                className="mt-2 w-full accent-[#b8452f]"
                controls
                onLoadedMetadata={(event) => {
                  if (resumePlaybackSeconds === null) {
                    return;
                  }

                  const maxSeek = Math.max(0, event.currentTarget.duration - 1);
                  event.currentTarget.currentTime = Math.min(resumePlaybackSeconds, maxSeek);
                  setPlaybackSeconds(event.currentTarget.currentTime);
                  setResumePlaybackSeconds(null);
                }}
                onTimeUpdate={(event) => {
                  const currentTime = event.currentTarget.currentTime;
                  setPlaybackSeconds(currentTime);

                  if (selectedEpisode) {
                    updatePlaybackPosition(selectedEpisode.id, currentTime);
                  }
                }}
                onPlay={() => {
                  if ("mediaSession" in navigator) {
                    navigator.mediaSession.playbackState = "playing";
                  }
                }}
                onPause={() => {
                  if ("mediaSession" in navigator) {
                    navigator.mediaSession.playbackState = "paused";
                  }
                }}
                src={selectedEpisode.audioUrl}
              >
                Your browser does not support audio playback.
              </audio>
            </div>
            <div className={isPlayerDocked ? "flex shrink-0 gap-2" : "flex justify-end gap-2"}>
              {isPlayerDocked ? (
                <button
                  className="shrink-0 border border-[#17211d]/25 px-3 py-2 text-xs font-semibold uppercase transition-colors hover:border-[#b8452f] hover:text-[#b8452f]"
                  onClick={undockPlayer}
                  title="Undock player"
                  type="button"
                >
                  ⤢
                </button>
              ) : null}
              <button
                className="shrink-0 border border-[#17211d]/25 px-3 py-2 text-xs font-semibold uppercase transition-colors hover:border-[#b8452f] hover:text-[#b8452f]"
                onClick={() => {
                  audioRef.current?.pause();
                  setSelectedEpisode(null);
                  setIsPlayerDocked(false);
                  hasPositionedPlayerRef.current = false;
                }}
                title="Close player"
                type="button"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
