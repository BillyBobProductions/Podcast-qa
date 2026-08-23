import { DEFERRED_ANSWER } from "@/lib/retrieval";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

export async function answerFromTranscript(
  question: string,
  context: string,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured on the server.");
  }

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_TEXT_MODEL ?? "gpt-4.1-mini",
      instructions: [
        "Answer the listener using only the supplied podcast transcript, which contains only content they have already heard.",
        "Do not use outside knowledge or claim details absent from the transcript.",
        "When the transcript contains a relevant discussion, answer directly and explain it in plain language, including when the listener uses different phrasing or an acronym.",
        "Only say that the episode has not covered the topic when the supplied transcript contains no relevant discussion at all.",
      ].join(" "),
      input: `Transcript:\n${context}\n\nQuestion: ${question}`,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("The answer service was unavailable. Please try again.");
  }

  const payload = (await response.json()) as {
    output?: Array<{
      type?: unknown;
      content?: Array<{ type?: unknown; text?: unknown }>;
    }>;
  };
  const answer = payload.output
    ?.filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text")
    .map((content) => content.text)
    .find((text): text is string => typeof text === "string" && text.trim().length > 0);

  return answer?.trim() ?? DEFERRED_ANSWER;
}