import type { Settings } from "@aod/shared-schema";
import { defaultSettings } from "@aod/shared-schema";
import { getSetting } from "../storage/settings-repo";

type TranslationConfig = Settings["thought_bubble"]["translation"];

function getTranslationConfig(): TranslationConfig {
  const settings = getSetting<Settings>("app");
  return settings?.thought_bubble?.translation ?? defaultSettings.thought_bubble.translation;
}

/**
 * Translate thinking text using the configured API.
 *
 * - If translation is disabled or api_key is empty, returns the original text.
 * - If translation is enabled and fails, returns an error string (no silent fallback).
 */
export async function translateThinking(text: string): Promise<string> {
  const config = getTranslationConfig();

  if (!config.enabled || !config.api_key) {
    return text;
  }

  const body = {
    model: config.model,
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `Translate the following AI agent's internal thought to ${config.target_language}. Keep it concise. Only output the translation, nothing else.\n\n${text}`,
      },
    ],
  };

  let response: Response;
  try {
    response = await fetch(config.api_endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.api_key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "network error";
    return `[Translation Error: ${reason}]`;
  }

  if (!response.ok) {
    return `[Translation Error: HTTP ${response.status}]`;
  }

  try {
    const json = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const textBlock = json.content?.find((b) => b.type === "text" && typeof b.text === "string");
    if (!textBlock?.text) {
      return `[Translation Error: empty response]`;
    }
    return textBlock.text;
  } catch {
    return `[Translation Error: invalid response format]`;
  }
}
