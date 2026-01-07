export namespace Rewrite {
  export type Options = {
    url: string
    model: string
    apiKey?: string
    timeoutMs?: number
    temperature?: number
    maxTokens?: number
    systemPrompt?: string
    fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  }

  export type Result =
    | { kind: "rewritten"; original: string; output: string }
    | { kind: "unchanged"; original: string; output: string }
    | { kind: "error"; original: string; message: string }

  const DEFAULT_SYSTEM_PROMPT = [
    "你是一个面向开发者的指令标准化器。",
    "任务：将用户输入改写为更清晰、无歧义、适合下发给 AI/Agent 的指令文本。",
    "规则：",
    "1) 只做最小必要改写：补全/插入合适标点（如“、”“，”“；”）以拆分短语；不要改变原意。",
    "2) 不要添加新的需求、背景、解释或 Markdown。",
    "3) 只输出改写后的文本，不要加引号，不要附带其他内容。",
    "4) 如果输入已经清晰无需改写，原样输出。",
    "示例：输入“首页商城我的几个分页”输出“首页、商城、我的几个分页；”。",
  ].join("\n")

  function resolveChatCompletionsURL(url: string) {
    const trimmed = url.trim()
    if (!trimmed) return ""
    const normalized = trimmed.replace(/\/+$/, "")
    if (normalized.endsWith("/chat/completions") || normalized.endsWith("/v1/chat/completions")) return normalized
    if (normalized.endsWith("/v1")) return `${normalized}/chat/completions`
    return `${normalized}/v1/chat/completions`
  }

  function unwrapCodeFence(text: string) {
    const trimmed = text.trim()
    const match = trimmed.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/)
    return match ? match[1]!.trim() : trimmed
  }

  function unwrapQuotes(text: string) {
    const trimmed = text.trim()
    const pairs: Array<[string, string]> = [
      ["“", "”"],
      ["‘", "’"],
      ['"', '"'],
      ["'", "'"],
      ["`", "`"],
    ]
    for (const [left, right] of pairs) {
      if (trimmed.startsWith(left) && trimmed.endsWith(right) && trimmed.length >= left.length + right.length) {
        return trimmed.slice(left.length, trimmed.length - right.length).trim()
      }
    }
    return trimmed
  }

  function normalizeModelOutput(text: string) {
    let out = unwrapCodeFence(text)
    out = out.replace(/^(改写|输出|结果)\s*[:：]\s*/i, "")
    out = unwrapQuotes(out)
    return out.trim()
  }

  function looksLikeCode(text: string) {
    if (text.includes("```")) return true
    if (/[{}[\]<>]/.test(text)) return true
    if (/;\s*$/.test(text) && /function|class|const|let|var/.test(text)) return true
    if (/^\s*(import|export)\s/m.test(text)) return true
    if (/\b(def|return|lambda|=>)\b/.test(text)) return true
    return false
  }

  export function shouldRewrite(input: string) {
    const text = input.trim()
    if (!text) return false
    if (text.startsWith("/") || text.startsWith("!")) return false
    if (text.includes("\n")) return false
    if (text.length < 6 || text.length > 280) return false
    if (!/[\u4E00-\u9FFF]/.test(text)) return false
    if (looksLikeCode(text)) return false

    // If there's already punctuation that likely disambiguates, skip.
    if (/[，。；、,.!?;:]/.test(text)) return false
    return true
  }

  function extractMessageContent(json: any): string | undefined {
    const choice = json?.choices?.[0]
    const content = choice?.message?.content ?? choice?.delta?.content ?? choice?.text
    return typeof content === "string" ? content : undefined
  }

  export async function rewrite(input: string, options: Options): Promise<Result> {
    const original = input
    const url = resolveChatCompletionsURL(options.url)
    if (!url) return { kind: "error", original, message: "Missing rewrite URL" }
    if (!options.model) return { kind: "error", original, message: "Missing rewrite model" }

    const fetcher = options.fetcher ?? fetch
    const timeoutMs = Number.isFinite(options.timeoutMs) && (options.timeoutMs as number) > 0 ? (options.timeoutMs as number) : 1500

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const headers = new Headers({
        "content-type": "application/json",
      })
      if (options.apiKey) headers.set("authorization", `Bearer ${options.apiKey}`)

      const body = {
        model: options.model,
        temperature: options.temperature ?? 0,
        max_tokens: options.maxTokens ?? 256,
        messages: [
          { role: "system", content: options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT },
          { role: "user", content: input },
        ],
      }

      const response = await fetcher(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!response.ok) {
        const preview = await response.text().catch(() => "")
        return {
          kind: "error",
          original,
          message: `Rewrite request failed (${response.status}): ${preview.slice(0, 200)}`,
        }
      }

      const json = await response.json().catch(() => undefined)
      const content = extractMessageContent(json)
      if (!content) return { kind: "error", original, message: "Rewrite response missing content" }

      const output = normalizeModelOutput(content)
      if (!output) return { kind: "error", original, message: "Rewrite returned empty output" }

      const normalizedOriginal = original.trim()
      if (output === normalizedOriginal) return { kind: "unchanged", original, output }
      return { kind: "rewritten", original, output }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        return { kind: "error", original, message: `Rewrite timed out after ${timeoutMs}ms` }
      }
      return { kind: "error", original, message: err?.message ? String(err.message) : "Rewrite failed" }
    } finally {
      clearTimeout(timeout)
    }
  }
}
