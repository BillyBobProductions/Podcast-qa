# In the Moment

A prototype podcast player that answers text questions about a transcribed podcast episode.

## Run locally

1. Copy `.env.example` to `.env.local` and set `DATABASE_URL`, `ACCESS_CODE`, and `OPENAI_API_KEY`.
2. Install dependencies with `npm install`.
3. Generate Prisma client and apply schema:

```bash
npm run prisma:generate
npm run db:push
```

4. Start the app:

```bash
npm run dev
```

Open `http://localhost:3000`, paste an RSS feed URL, select an episode, wait for its transcription, then play and ask a question.

## Access gate

Set `ACCESS_CODE` to require an invite code before any app or API usage. When unset, the gate is disabled for local development.

## How answers are grounded

The server retrieves relevant passages from the full episode transcript and supplies only those passages to OpenAI when generating answers.

OpenAI calls are made only by server routes. `OPENAI_API_KEY` is never sent to the browser.

## Prototype limits

- OpenAI accepts transcription uploads up to 25 MB. Larger episodes are automatically re-encoded and split into 20-minute, 64 kbps MP3 chunks with FFmpeg, then their timestamped transcript segments are merged into one episode timeline. Install both `ffmpeg` and `ffprobe` and ensure they are on `PATH`.
- Transcription runs during the request. Long episodes may exceed local hosting request timeouts; production should use a queue, object storage, and persisted transcript records.
- Podcast episodes and transcripts are persisted in PostgreSQL via Prisma.
- Q&A chat history is intentionally not persisted in this version.
- Some podcast enclosure hosts block cross-origin browser playback. This prototype initially plays the enclosure URL directly; a guarded same-origin audio proxy can be added where necessary.
- Text Q&A is implemented. Voice questions should later use microphone capture plus realtime transcription, then submit the resulting text to the existing question route.

## Validation

```bash
npm run lint
npm run typecheck
npm run build
```

Database utilities:

```bash
npm run prisma:generate
npm run db:push
```

For Railway deploys, use the service `DATABASE_URL` provided by Railway Postgres and run `npm run db:push && npm run start` as the start command.

## Main files

- `src/app/page.tsx`: podcast player and text Q&A interface.
- `src/app/api/feeds/route.ts`: RSS feed parsing endpoint.
- `src/app/api/episodes/[episodeId]/transcribe/route.ts`: audio download and timestamped OpenAI transcription endpoint.
- `src/app/api/episodes/[episodeId]/questions/route.ts`: heard-only retrieval and OpenAI answer endpoint.
- `src/lib/retrieval.ts`: playback-time eligibility filtering and local lexical retrieval.
