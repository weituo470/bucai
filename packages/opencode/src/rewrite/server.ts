import z from "zod"
import { Identifier } from "@/id/id"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { streamText, wrapLanguageModel, extractReasoningMiddleware, type ModelMessage } from "ai"
import { mergeDeep, pipe } from "remeda"
import { Instance } from "@/project/instance"
import { Flag } from "@/flag/flag"

export namespace RewriteServer {
  const SYSTEM_PROMPT = [
    "你是一个面向开发者的指令标准化器。",
    "任务：将用户输入改写为更清晰、无歧义、适合下发给 AI/Agent 的指令文本。",
    "规则：",
    "1) 只做最小必要改写：补全/插入合适标点（如“、”“，”“；”）以拆分短语；不要改变原意。",
    "2) 不要添加新的需求、背景、解释或 Markdown。",
    "3) 只输出改写后的文本，不要加引号，不要附带其他内容。",
    "4) 如果输入已经清晰无需改写，原样输出。",
    "示例：输入“首页商城我的几个分页”输出“首页、商城、我的几个分页；”。",
  ].join("\n")

  export const Input = z.object({
    input: z.string().min(1),
    model: z
      .object({
        providerID: z.string(),
        modelID: z.string(),
      })
      .optional(),
    timeout_ms: z.number().int().positive().optional(),
    max_tokens: z.number().int().positive().optional(),
    temperature: z.number().min(0).max(2).optional(),
  })
  export type Input = z.infer<typeof Input>

  export const Output = z.object({
    output: z.string(),
    model: z.object({
      providerID: z.string(),
      modelID: z.string(),
    }),
  })
  export type Output = z.infer<typeof Output>

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

  export async function rewrite(input: Input): Promise<Output> {
    const modelRef = input.model ?? (await Provider.defaultModel())
    const model = await Provider.getModel(modelRef.providerID, modelRef.modelID)
    const provider = await Provider.getProvider(model.providerID)
    const sessionID = Identifier.create("session", false)

    const baseOptions = ProviderTransform.options(model, sessionID, provider?.options)
    const mergedOptions = pipe(baseOptions, mergeDeep(model.options))

    const abort = new AbortController()
    const timeoutMs = Number.isFinite(input.timeout_ms) && input.timeout_ms! > 0 ? input.timeout_ms! : 1500
    const timer = setTimeout(() => abort.abort(), timeoutMs)

    try {
      const language = await Provider.getLanguage(model)
      const wrapped = wrapLanguageModel({
        model: language,
        middleware: [
          {
            async transformParams(args) {
              if (args.type === "stream") {
                // @ts-expect-error
                args.params.prompt = ProviderTransform.message(args.params.prompt, model)
              }
              return args.params
            },
          },
          extractReasoningMiddleware({ tagName: "think", startWithReasoning: false }),
        ],
      })

      const maxOutputTokens = Number.isFinite(input.max_tokens) && input.max_tokens! > 0 ? input.max_tokens! : 256
      const temperature = Number.isFinite(input.temperature) ? input.temperature : 0

      const stream = await streamText({
        abortSignal: abort.signal,
        maxRetries: 0,
        model: wrapped,
        providerOptions: ProviderTransform.providerOptions(model, mergedOptions),
        temperature,
        maxOutputTokens,
        headers: {
          ...(model.providerID.startsWith("opencode")
            ? {
                "x-opencode-project": Instance.project.id,
                "x-opencode-session": sessionID,
                "x-opencode-request": Identifier.create("message", false),
                "x-opencode-client": Flag.OPENCODE_CLIENT,
              }
            : undefined),
          ...model.headers,
        },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: input.input },
        ] satisfies ModelMessage[],
      })

      let text = ""
      for await (const value of stream.fullStream) {
        if (value.type === "text-delta") {
          text += value.text
        }
      }

      const output = normalizeModelOutput(text)
      return {
        output: output.length > 0 ? output : input.input.trim(),
        model: modelRef,
      }
    } finally {
      clearTimeout(timer)
      abort.abort()
    }
  }
}

