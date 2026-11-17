/**
 * Groq chat completions (OpenAI-compatible) with tool calling. Reasoning is
 * hidden: Qwen's raw <think> blocks are not valid alongside tool calls on
 * Groq, and the assistant only needs the answer.
 */
'use strict';

class GroqError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const MAX_RETRY_WAIT_MS = 25000;
const MAX_RETRIES = 2;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createGroq({ apiKey, model, baseUrl, timeoutMs, maxCompletionTokens, fetchImpl = fetch }) {
  async function request(body, signal) {
    return fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST', signal, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body,
    });
  }

  async function chat({ messages, tools }) {
    const body = JSON.stringify({
      model, messages, temperature: 0.2, max_completion_tokens: maxCompletionTokens, reasoning_format: 'hidden',
      ...(tools && tools.length ? { tools, tool_choice: 'auto', parallel_tool_calls: true } : {}),
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await request(body, controller.signal);
      // The free Groq tier allows ~8k tokens a minute; a turn's second or third call often has to wait for the window.
      for (let attempt = 0; response.status === 429 && attempt < MAX_RETRIES; attempt += 1) {
        const wait = Math.min(MAX_RETRY_WAIT_MS, Math.max(1000, (Number(response.headers.get('retry-after')) || 5) * 1000));
        console.warn(`[assistant] groq 429, waiting ${Math.round(wait / 1000)}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await sleep(wait);
        response = await request(body, controller.signal);
      }
    } catch (error) {
      throw new GroqError(error.name === 'AbortError' ? 504 : 502, 'The assistant model did not answer in time. Please try again.');
    } finally { clearTimeout(timer); }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error(`[assistant] groq ${response.status}: ${text.slice(0, 300)}`);
      throw new GroqError(response.status === 429 ? 429 : 502, response.status === 429 ? 'The assistant is busy right now; try again in a moment.' : 'The assistant model is unavailable right now.');
    }
    const data = await response.json();
    const choice = data?.choices?.[0];
    if (!choice?.message) throw new GroqError(502, 'The assistant model returned an empty answer.');
    return { message: choice.message, finishReason: choice.finish_reason, usage: data.usage || null };
  }
  return { chat, model };
}

module.exports = { createGroq, GroqError };
