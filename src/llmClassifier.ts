/**
 * Warden CI \u2014 LLM escalation layer (Gemini).
 *
 * Only files that land in the "uncertain" heuristic band get sent here (see scoring.ts).
 * This keeps per-scan API cost proportional to ambiguity, not to diff size \u2014 important
 * because Year 1 unit economics depend on cost-per-seat staying low at $15\u2013$25/dev/month.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { ChangedFile, LlmClassification } from "./types";

// gemini-2.0-flash is the current fast/cheap model suited to this per-file classification
// task. If your API key only has access to older models, swap this to "gemini-1.5-flash".
const MODEL = "gemini-2.0-flash";
const MAX_DIFF_CHARS_TO_LLM = 6000; // keep prompts small and cheap; truncate long diffs

let client: GoogleGenerativeAI | null = null;
function getClient(): GoogleGenerativeAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
    client = new GoogleGenerativeAI(apiKey);
  }
  return client;
}

const SYSTEM_PROMPT = `You are a code-review assistant that estimates the likelihood a code
change was AI-generated and pasted in without adaptation, contains hallucinated
(non-existent) API usage, or is otherwise unverifiable/unreviewed \u2014 as opposed to
ordinary human-authored code.

You are NOT judging code quality or style. A perfectly good human-written PR should
score low. Score high only for signals like: hallucinated library calls, boilerplate
that doesn't match the surrounding codebase's conventions, inconsistent logic that
suggests no one traced through the actual code path, or telltale generation artifacts.

Respond with ONLY a JSON object, no markdown fences, no preamble:
{"score": <integer 0-100>, "rationale": "<one or two sentences, specific to this diff>"}`;

/**
 * Classifies a single file's diff. Falls back to a neutral score if the API call fails
 * (network issues, rate limits) so a transient outage never blocks a PR check outright.
 */
export async function classifyFile(file: ChangedFile): Promise<LlmClassification> {
  const patch = (file.patch || "").slice(0, MAX_DIFF_CHARS_TO_LLM);

  try {
    const genAI = getClient();
    const model = genAI.getGenerativeModel({
      model: MODEL,
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: { responseMimeType: "application/json" },
    });

    const result = await model.generateContent(
      `Filename: ${file.filename}\n\nDiff (unified format, truncated if long):\n${patch}`
    );

    const raw = result.response.text().trim();
    const cleaned = raw.replace(/^```json\s*|\s*```$/g, "");
    const parsed = JSON.parse(cleaned);

    const score = Math.max(0, Math.min(100, Number(parsed.score)));
    return {
      filename: file.filename,
      score: Number.isFinite(score) ? score : 50,
      rationale: String(parsed.rationale || "No rationale returned."),
      usedFallback: false,
    };
  } catch (err) {
    return {
      filename: file.filename,
      score: 50, // neutral \u2014 don't let an API failure silently pass or silently fail a PR
      rationale: `LLM classification unavailable (${(err as Error).message}); falling back to heuristic score only.`,
      usedFallback: true,
    };
  }
}

export async function classifyFiles(files: ChangedFile[]): Promise<LlmClassification[]> {
  // Sequential on purpose for the MVP: keeps rate-limit handling simple and cost predictable.
  // Parallelize with a concurrency cap once volume justifies the added complexity.
  const results: LlmClassification[] = [];
  for (const file of files) {
    results.push(await classifyFile(file));
  }
  return results;
}
