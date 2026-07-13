import { z } from "zod";
import { ProviderError, request, type Fetcher } from "./http";

const wordSchema = z.object({
  word: z.string().min(1),
  punctuated_word: z.string().min(1).optional(),
  start: z.number().nonnegative(),
  end: z.number().positive(),
}).passthrough();

const transcriptionSchema = z.object({
  results: z.object({
    channels: z.array(z.object({
      alternatives: z.array(z.object({ words: z.array(wordSchema) }).passthrough()).min(1),
    }).passthrough()).min(1),
  }).passthrough(),
}).passthrough();

export interface NarrationResult {
  audio: Uint8Array;
  words: Array<{ word: string; startSeconds: number; endSeconds: number }>;
  model: string;
}

export interface NarrationProvider {
  narrate(text: string): Promise<NarrationResult>;
}

export interface DeepgramClientOptions {
  apiKey: string;
  ttsModel: string;
  sttModel?: string;
  baseUrl?: string;
  fetcher?: Fetcher;
  timeoutMs?: number;
}

export class DeepgramClient implements NarrationProvider {
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly sttModel: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: DeepgramClientOptions) {
    if (!options.apiKey) throw new ProviderError("deepgram", "configuration", false, "DEEPGRAM_API_KEY is required");
    if (!options.ttsModel) throw new ProviderError("deepgram", "configuration", false, "DEEPGRAM_TTS_MODEL is required");
    this.baseUrl = (options.baseUrl ?? "https://api.deepgram.com/v1").replace(/\/$/, "");
    this.fetcher = options.fetcher ?? fetch;
    this.sttModel = options.sttModel ?? "nova-3";
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  async narrate(text: string): Promise<NarrationResult> {
    if (!text.trim()) throw new ProviderError("deepgram", "invalid_response", false, "Approved narration text is required");
    const headers = { Authorization: `Token ${this.options.apiKey}` };
    const speech = await request("deepgram", this.fetcher, `${this.baseUrl}/speak?model=${encodeURIComponent(this.options.ttsModel)}&encoding=linear16&container=wav`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json", Accept: "audio/wav" },
      body: JSON.stringify({ text }),
    }, this.timeoutMs);
    const audio = new Uint8Array(await speech.arrayBuffer());
    if (!audio.byteLength) throw new ProviderError("deepgram", "invalid_response", true, "Deepgram returned empty narration audio");
    const transcription = await request("deepgram", this.fetcher, `${this.baseUrl}/listen?model=${encodeURIComponent(this.sttModel)}&smart_format=true&punctuate=true`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "audio/wav", Accept: "application/json" },
      body: audio,
    }, this.timeoutMs);
    let parsed: z.infer<typeof transcriptionSchema>;
    try {
      parsed = transcriptionSchema.parse(await transcription.json());
    } catch (error) {
      const detail = error instanceof z.ZodError
        ? error.issues.slice(0, 5).map(({ path, message }) => `${path.join(".") || "response"}: ${message}`).join("; ")
        : "response was not valid JSON";
      throw new ProviderError("deepgram", "invalid_response", true, `Deepgram returned invalid prerecorded transcription data (${detail})`, { cause: error });
    }
    const words = parsed.results.channels[0]!.alternatives[0]!.words.map((word) => ({
      word: word.punctuated_word ?? word.word,
      startSeconds: word.start,
      endSeconds: word.end,
    }));
    if (!words.length) throw new ProviderError("deepgram", "invalid_response", true, "Deepgram prerecorded transcription did not include word timing");
    return { audio, words, model: this.options.ttsModel };
  }
}

export const deepgramFromEnvironment = (environment: Record<string, string | undefined>, options: Omit<DeepgramClientOptions, "apiKey" | "ttsModel"> = {}) => {
  const apiKey = environment.DEEPGRAM_API_KEY;
  const ttsModel = environment.DEEPGRAM_TTS_MODEL;
  if (!apiKey) throw new ProviderError("deepgram", "configuration", false, "DEEPGRAM_API_KEY is required");
  if (!ttsModel) throw new ProviderError("deepgram", "configuration", false, "DEEPGRAM_TTS_MODEL is required");
  return new DeepgramClient({ ...options, apiKey, ttsModel });
};
