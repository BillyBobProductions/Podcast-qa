import { NextResponse } from "next/server";

const TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured on the server." },
      { status: 500 },
    );
  }

  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio");

    if (!(audioFile instanceof Blob)) {
      return NextResponse.json({ error: "Audio file is required." }, { status: 400 });
    }

    const transcriptionFormData = new FormData();
    transcriptionFormData.append("file", audioFile, "question.webm");
    transcriptionFormData.append("model", "whisper-1");
    transcriptionFormData.append("language", "en");

    const response = await fetch(TRANSCRIPTIONS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: transcriptionFormData,
    });

    if (!response.ok) {
      throw new Error("Transcription service failed.");
    }

    const payload = (await response.json()) as { text?: unknown };

    if (typeof payload.text !== "string" || !payload.text.trim()) {
      return NextResponse.json(
        { error: "No speech detected in audio." },
        { status: 400 },
      );
    }

    return NextResponse.json({ text: payload.text.trim() });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to transcribe audio.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
