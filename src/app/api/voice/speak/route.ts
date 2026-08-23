import { NextResponse } from "next/server";

const TTS_URL = "https://api.openai.com/v1/audio/speech";

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured on the server." },
      { status: 500 },
    );
  }

  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;

  if (!body || typeof body.text !== "string" || !body.text.trim()) {
    return NextResponse.json({ error: "Text is required." }, { status: 400 });
  }

  try {
    const response = await fetch(TTS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1",
        voice: "alloy",
        input: body.text.trim(),
        speed: 1.0,
      }),
    });

    if (!response.ok) {
      throw new Error("Text-to-speech service failed.");
    }

    const audioBuffer = await response.arrayBuffer();

    return new NextResponse(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": audioBuffer.byteLength.toString(),
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to generate speech.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
