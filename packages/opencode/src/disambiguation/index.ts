export namespace Disambiguation {
  export type Level = "high" | "medium"

  export type SlotOption = {
    id: string
    label: string
    value: string
    weight: number
    aliases?: string[]
  }

  export type Slot = {
    id: string
    label: string
    level: Level
    options: SlotOption[]
  }

  export type Candidate = {
    text: string
    score: number
    selection: Record<string, string>
  }

  export type ErrorResult = {
    kind: "error"
    code: "batch_limit_exceeded"
    message: string
    limit: number
    count: number
  }

  export type NoneResult = {
    kind: "none"
    original: string
    cleaned: string
  }

  export type AmbiguousResult = {
    kind: "ambiguous"
    original: string
    cleaned: string
    slots: Slot[]
    candidates: Candidate[]
  }

  export type BatchResolvedResult = {
    kind: "batch_resolved"
    original: string
    cleanedLines: string[]
    resolvedLines: string[]
    limit: number
    count: number
  }

  export type Result = ErrorResult | NoneResult | AmbiguousResult | BatchResolvedResult

  export type Options = {
    maxBatch: number
    maxCandidates: number
  }

  export type LexiconOverride = Partial<{
    server_log: Partial<{
      server: SlotOption[]
      action: SlotOption[]
      range: SlotOption[]
    }>
    crm_sync: Partial<{
      source: SlotOption[]
      target: SlotOption[]
      dataset: SlotOption[]
      conflict: SlotOption[]
    }>
    api_performance: Partial<{
      endpoint: SlotOption[]
      latency: SlotOption[]
    }>
  }>

  export type AnalyzeConfig = Partial<Options> & {
    lexicon?: LexiconOverride
  }

  const DEFAULT_OPTIONS: Options = {
    maxBatch: 10,
    maxCandidates: 5,
  }

  function isSlotOption(value: any): value is SlotOption {
    return (
      Boolean(value) &&
      typeof value === "object" &&
      typeof value.id === "string" &&
      typeof value.label === "string" &&
      typeof value.value === "string" &&
      typeof value.weight === "number" &&
      (value.aliases === undefined || (Array.isArray(value.aliases) && value.aliases.every((a: any) => typeof a === "string")))
    )
  }

  function isSlotOptionArray(value: any): value is SlotOption[] {
    return Array.isArray(value) && value.every((x) => isSlotOption(x))
  }

  function normalizeWhitespace(text: string) {
    return text.replace(/\r\n/g, "\n").replace(/\t/g, " ").replace(/[ ]{2,}/g, " ").trim()
  }

  function stripRedundantPhrases(text: string) {
    const original = normalizeWhitespace(text)
    let next = original

    const leadingPatterns: RegExp[] = [/^(请|麻烦|帮忙|劳烦)\s*/g, /^帮我把\s*/g, /^帮我先\s*/g, /^帮我\s*/g]
    for (const re of leadingPatterns) next = next.replace(re, "")

    const fillerPatterns: RegExp[] = [
      /(\s|^)(一下|一下下|一下子|下|下吧)(\s|$)/g,
      /(\s|^)(谢谢|多谢|thanks)(\s|$)/gi,
    ]
    for (const re of fillerPatterns) next = next.replace(re, " ")

    next = next.replace(/[，,。.!！?？；;:：]+$/g, "")
    next = next.replace(/[，,\s]*(谢谢|多谢|thanks)\s*$/gi, "")

    return normalizeWhitespace(next)
  }

  function containsAny(text: string, needles: string[]) {
    return needles.some((n) => text.toLowerCase().includes(n.toLowerCase()))
  }

  function scoreOption(option: SlotOption, input: string) {
    if (!option.aliases || option.aliases.length === 0) return option.weight
    const boost = option.aliases.some((a) => input.toLowerCase().includes(a.toLowerCase())) ? 100 : 0
    return option.weight + boost
  }

  function applyTemplate(template: string, vars: Record<string, string>) {
    return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? `{${key}}`)
  }

  function serverLogSlots(override?: LexiconOverride["server_log"]): Slot[] {
    const overrideServer = override?.server
    const overrideAction = override?.action
    const overrideRange = override?.range
    const defaultServer = [
      {
        id: "prod_p002",
        label: "生产环境P002",
        value: "生产环境P002服务器",
        weight: 3,
        aliases: ["生产", "prod", "p002"],
      },
      {
        id: "test_s001",
        label: "测试环境S001",
        value: "测试环境S001服务器",
        weight: 2,
        aliases: ["测试", "test", "s001"],
      },
      {
        id: "all",
        label: "全部服务器",
        value: "全部服务器",
        weight: 1,
        aliases: ["全部", "all"],
      },
    ] satisfies SlotOption[]
    const defaultAction = [
      {
        id: "delete_old",
        label: "删除旧日志",
        value: "删除{server}{range}的旧日志",
        weight: 3,
        aliases: ["删除", "清理", "清除", "删", "cleanup"],
      },
      {
        id: "query_error",
        label: "查询报错",
        value: "查询{server}{range}日志的报错",
        weight: 2,
        aliases: ["查询", "查", "报错", "错误", "error"],
      },
      {
        id: "backup",
        label: "打包备份",
        value: "打包备份{server}{range}的日志",
        weight: 1,
        aliases: ["备份", "打包", "归档", "archive"],
      },
    ] satisfies SlotOption[]
    const defaultRange = [
      {
        id: "7d",
        label: "近7天",
        value: "近7天",
        weight: 3,
        aliases: ["7天", "7d", "一周", "近7天"],
      },
      {
        id: "24h",
        label: "近24小时",
        value: "近24小时",
        weight: 2,
        aliases: ["24小时", "24h", "一天", "1天"],
      },
      {
        id: "all_history",
        label: "全部历史",
        value: "全部历史",
        weight: 1,
        aliases: ["全部", "所有", "历史", "all"],
      },
    ] satisfies SlotOption[]
    return [
      {
        id: "server",
        label: "服务器",
        level: "high",
        options: isSlotOptionArray(overrideServer) ? overrideServer : defaultServer,
      },
      {
        id: "action",
        label: "处理",
        level: "high",
        options: isSlotOptionArray(overrideAction) ? overrideAction : defaultAction,
      },
      {
        id: "range",
        label: "日志范围",
        level: "medium",
        options: isSlotOptionArray(overrideRange) ? overrideRange : defaultRange,
      },
    ]
  }

  function crmSyncSlots(override?: LexiconOverride["crm_sync"]): Slot[] {
    const overrideSource = override?.source
    const overrideTarget = override?.target
    const overrideDataset = override?.dataset
    const overrideConflict = override?.conflict
    const defaultSource = [
      { id: "test", label: "测试环境", value: "测试环境", weight: 3, aliases: ["测试", "test", "staging"] },
      { id: "prod", label: "生产环境", value: "生产环境", weight: 1, aliases: ["生产", "prod"] },
    ] satisfies SlotOption[]
    const defaultTarget = [
      { id: "prod", label: "生产环境", value: "生产环境", weight: 3, aliases: ["生产", "prod"] },
      { id: "test", label: "测试环境", value: "测试环境", weight: 1, aliases: ["测试", "test", "staging"] },
    ] satisfies SlotOption[]
    const defaultDataset = [
      { id: "customer", label: "客户数据", value: "CRM客户数据", weight: 3, aliases: ["客户", "customer"] },
      { id: "all", label: "全量数据", value: "CRM全量数据", weight: 1, aliases: ["全量", "所有", "all"] },
    ] satisfies SlotOption[]
    const defaultConflict = [
      { id: "overwrite", label: "覆盖重复条目", value: "覆盖重复条目", weight: 3, aliases: ["覆盖", "overwrite"] },
      { id: "skip", label: "跳过重复条目", value: "跳过重复条目", weight: 1, aliases: ["跳过", "skip"] },
    ] satisfies SlotOption[]
    return [
      {
        id: "source",
        label: "来源环境",
        level: "high",
        options: isSlotOptionArray(overrideSource) ? overrideSource : defaultSource,
      },
      {
        id: "target",
        label: "目标环境",
        level: "high",
        options: isSlotOptionArray(overrideTarget) ? overrideTarget : defaultTarget,
      },
      {
        id: "dataset",
        label: "数据范围",
        level: "medium",
        options: isSlotOptionArray(overrideDataset) ? overrideDataset : defaultDataset,
      },
      {
        id: "conflict",
        label: "冲突策略",
        level: "medium",
        options: isSlotOptionArray(overrideConflict) ? overrideConflict : defaultConflict,
      },
    ]
  }

  function apiPerformanceSlots(override?: LexiconOverride["api_performance"]): Slot[] {
    const overrideEndpoint = override?.endpoint
    const overrideLatency = override?.latency
    const defaultEndpoint = [
      { id: "login", label: "用户登录接口", value: "用户登录接口", weight: 3, aliases: ["登录", "login"] },
      { id: "all", label: "核心接口", value: "核心接口", weight: 1, aliases: ["核心", "主要"] },
    ] satisfies SlotOption[]
    const defaultLatency = [
      { id: "200ms", label: "低于200ms", value: "200ms", weight: 3, aliases: ["200ms", "200"] },
      { id: "500ms", label: "低于500ms", value: "500ms", weight: 1, aliases: ["500ms", "500"] },
    ] satisfies SlotOption[]
    return [
      {
        id: "endpoint",
        label: "接口",
        level: "high",
        options: isSlotOptionArray(overrideEndpoint) ? overrideEndpoint : defaultEndpoint,
      },
      {
        id: "latency",
        label: "目标延迟",
        level: "medium",
        options: isSlotOptionArray(overrideLatency) ? overrideLatency : defaultLatency,
      },
    ]
  }

  function matchServerLog(text: string) {
    let score = 0
    if (containsAny(text, ["服务器", "server"])) score += 2
    if (containsAny(text, ["日志", "log"])) score += 2
    if (containsAny(text, ["清理", "删除", "备份", "报错", "错误", "error"])) score += 1
    return score
  }

  function matchCrmSync(text: string) {
    let score = 0
    if (containsAny(text, ["crm"])) score += 2
    if (containsAny(text, ["同步", "sync"])) score += 2
    if (containsAny(text, ["数据", "data"])) score += 1
    return score
  }

  function matchApiPerformance(text: string) {
    let score = 0
    if (containsAny(text, ["接口", "api"])) score += 2
    if (containsAny(text, ["优化", "optimize"])) score += 2
    if (containsAny(text, ["性能", "performance", "延迟", "latency", "响应"])) score += 1
    return score
  }

  function generateCandidates(input: string, slots: Slot[], maxCandidates: number, render: (s: Record<string, string>) => string) {
    if (slots.length === 0) return []

    let beam: Candidate[] = [{ text: input, score: 0, selection: {} }]
    for (const slot of slots) {
      const next: Candidate[] = []
      for (const candidate of beam) {
        for (const option of slot.options) {
          const score = candidate.score + scoreOption(option, input)
          next.push({
            text: candidate.text,
            score,
            selection: { ...candidate.selection, [slot.id]: option.value },
          })
        }
      }
      beam = next.toSorted((a, b) => b.score - a.score).slice(0, maxCandidates)
    }
    const rendered = beam
      .map((c) => {
        const text = normalizeWhitespace(render(c.selection))
        const score = c.score + (text ? 0 : -999)
        return { ...c, text, score }
      })
      .toSorted((a, b) => b.score - a.score)
      .slice(0, maxCandidates)
    return rendered
  }

  function analyzeSingle(text: string, options: Options, lexicon?: LexiconOverride): NoneResult | AmbiguousResult {
    const original = normalizeWhitespace(text)
    const cleaned = stripRedundantPhrases(original)

    const scores = [
      { id: "server_log" as const, score: matchServerLog(cleaned) },
      { id: "crm_sync" as const, score: matchCrmSync(cleaned) },
      { id: "api_performance" as const, score: matchApiPerformance(cleaned) },
    ].toSorted((a, b) => b.score - a.score)
    const winner = scores[0]

    if (!winner || winner.score === 0) {
      return { kind: "none", original, cleaned }
    }

    if (winner.id === "server_log") {
      const slots = serverLogSlots(lexicon?.server_log)
      const candidates = generateCandidates(cleaned, slots, options.maxCandidates, (selection) =>
        applyTemplate(selection.action ?? cleaned, selection),
      )
      return { kind: "ambiguous", original, cleaned, slots, candidates }
    }

    if (winner.id === "crm_sync") {
      const slots = crmSyncSlots(lexicon?.crm_sync)
      const candidates = generateCandidates(cleaned, slots, options.maxCandidates, (selection) => {
        const source = selection.source ?? ""
        const dataset = selection.dataset ?? "CRM数据"
        const target = selection.target ?? ""
        const conflict = selection.conflict ?? ""
        const comma = conflict ? "，" : ""
        return `将${source}${dataset}同步至${target}${comma}${conflict}`
      })
      return { kind: "ambiguous", original, cleaned, slots, candidates }
    }

    const slots = apiPerformanceSlots(lexicon?.api_performance)
    const candidates = generateCandidates(cleaned, slots, options.maxCandidates, (selection) => {
      const endpoint = selection.endpoint ?? "接口"
      const latency = selection.latency ?? "200ms"
      return `优化${endpoint}的响应速度，目标延迟低于${latency}`
    })

    return { kind: "ambiguous", original, cleaned, slots, candidates }
  }

  function splitLines(text: string) {
    const lines = text.replace(/\r\n/g, "\n").split("\n")
    const nonEmpty = lines.map((l) => l.trim()).filter((l) => l.length > 0)
    return nonEmpty
  }

  function looksLikeCodeLine(line: string) {
    return (
      line.includes("```") ||
      /(^|\s)(import|export|function|class|const|let|var)\b/i.test(line) ||
      /=>|;|\{|\}|\(|\)|<\/\w+>/.test(line)
    )
  }

  function looksLikeBatch(lines: string[]) {
    if (lines.length < 2) return false
    if (lines.some((l) => l.length > 200)) return false
    if (lines.some((l) => looksLikeCodeLine(l))) return false
    return true
  }

  export function analyze(text: string, config?: AnalyzeConfig): Result {
    const options = { ...DEFAULT_OPTIONS, ...config }
    const lexicon = config?.lexicon
    const original = normalizeWhitespace(text)
    const items = splitLines(original)

    if (items.length > 1) {
      if (looksLikeBatch(items)) {
        if (items.length > options.maxBatch) {
          return {
            kind: "error",
            code: "batch_limit_exceeded",
            message: `Maximum of ${options.maxBatch} instructions per batch`,
            limit: options.maxBatch,
            count: items.length,
          }
        }

        const cleanedLines: string[] = []
        const resolvedLines: string[] = []
        for (const line of items) {
          const analyzed = analyzeSingle(line, options, lexicon)
          cleanedLines.push(analyzed.cleaned)
          if (analyzed.kind === "ambiguous") {
            resolvedLines.push(analyzed.candidates[0]?.text ?? analyzed.cleaned)
          } else {
            resolvedLines.push(analyzed.cleaned)
          }
        }

        return {
          kind: "batch_resolved",
          original,
          cleanedLines,
          resolvedLines,
          limit: options.maxBatch,
          count: items.length,
        }
      }
    }

    return analyzeSingle(original, options, lexicon)
  }
}
