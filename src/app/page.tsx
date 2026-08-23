"use client";

import { FormEvent, useRef, useState } from "react";

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
      const payload = (await response.json()) as {
        episodes?: EpisodeHistoryItem[];
      };

      if (!response.ok || !payload.episodes) {
        setHistoryEpisodes([]);
        return;
      }

      setHistoryEpisodes(payload.episodes);
    } catch {
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

      const payload = (await response.json()) as { text?: string; error?: string };

      if (!response.ok || !payload.text) {
        throw new Error(payload.error ?? "Unable to transcribe voice.");
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
      const payload = (await response.json()) as {
        episodes?: Episode[];
        error?: string;
      };

      if (!response.ok || !payload.episodes) {
        throw new Error(payload.error ?? "Unable to load that podcast feed.");
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
      const payload = (await response.json()) as {
        podcasts?: PodcastSearchResult[];
        error?: string;
      };

      if (!response.ok || !payload.podcasts) {
        throw new Error(payload.error ?? "Unable to search podcasts.");
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
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to prepare this episode.");
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
      const payload = (await response.json()) as { answer?: string; error?: string };

      if (!response.ok || !payload.answer) {
        throw new Error(payload.error ?? "Unable to answer that question.");
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
      <div className="mx-auto grid min-h-screen max-w-7xl gap-10 px-5 py-8 md:px-10 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)] lg:py-12">
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
              <audio
                ref={audioRef}
                className="mt-8 w-full accent-[#b8452f]"
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
                src={selectedEpisode.audioUrl}
              >
                Your browser does not support audio playback.
              </audio>
              <p className="mt-3 font-mono text-xs tracking-[0.12em] text-[#516159] uppercase">
                {transcriptLabel}
              </p>
            </div>
          ) : null}
        </section>

        <aside className="flex min-h-[520px] flex-col border border-[#17211d]/20 bg-[#fffdf8] p-5 md:p-7">
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

          <div className="flex-1 space-y-5 py-6" aria-live="polite">
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
      </div>
    </main>
  );
}
