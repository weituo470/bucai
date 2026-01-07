import { describe, expect, test } from "bun:test"
import { Disambiguation } from "../../src/disambiguation"

describe("disambiguation", () => {
  test("generates server-log candidates and picks sensible default", () => {
    const result = Disambiguation.analyze("帮我处理一下服务器日志", { maxCandidates: 5, maxBatch: 10 })
    expect(result.kind).toBe("ambiguous")
    if (result.kind !== "ambiguous") return
    expect(result.candidates[0]?.text).toBe("删除生产环境P002服务器近7天的旧日志")
  })

  test("matches PRD server-ops example", () => {
    const result = Disambiguation.analyze("帮我清理服务器日志", { maxCandidates: 5, maxBatch: 10 })
    expect(result.kind).toBe("ambiguous")
    if (result.kind !== "ambiguous") return
    expect(result.candidates[0]?.text).toBe("删除生产环境P002服务器近7天的旧日志")
  })

  test("boosts candidates when explicit hints exist", () => {
    const result = Disambiguation.analyze("查一下测试环境服务器日志报错 24小时", { maxCandidates: 5, maxBatch: 10 })
    expect(result.kind).toBe("ambiguous")
    if (result.kind !== "ambiguous") return
    expect(result.candidates[0]?.text).toBe("查询测试环境S001服务器近24小时日志的报错")
  })

  test("matches PRD multi-agent CRM example", () => {
    const result = Disambiguation.analyze("同步CRM数据", { maxCandidates: 5, maxBatch: 10 })
    expect(result.kind).toBe("ambiguous")
    if (result.kind !== "ambiguous") return
    expect(result.candidates[0]?.text).toBe("将测试环境CRM客户数据同步至生产环境，覆盖重复条目")
  })

  test("matches PRD codegen perf example", () => {
    const result = Disambiguation.analyze("优化接口性能", { maxCandidates: 5, maxBatch: 10 })
    expect(result.kind).toBe("ambiguous")
    if (result.kind !== "ambiguous") return
    expect(result.candidates[0]?.text).toBe("优化用户登录接口的响应速度，目标延迟低于200ms")
  })

  test("auto-resolves batch inputs up to 10 lines", () => {
    const result = Disambiguation.analyze(
      ["帮我处理一下服务器日志", "查一下测试环境服务器日志报错 24小时"].join("\n"),
      { maxCandidates: 5, maxBatch: 10 },
    )
    expect(result.kind).toBe("batch_resolved")
    if (result.kind !== "batch_resolved") return
    expect(result.count).toBe(2)
    expect(result.resolvedLines).toEqual([
      "删除生产环境P002服务器近7天的旧日志",
      "查询测试环境S001服务器近24小时日志的报错",
    ])
  })

  test("enforces batch max=10", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `line ${i + 1}`).join("\n")
    const result = Disambiguation.analyze(eleven, { maxCandidates: 5, maxBatch: 10 })
    expect(result.kind).toBe("error")
    if (result.kind !== "error") return
    expect(result.code).toBe("batch_limit_exceeded")
    expect(result.limit).toBe(10)
    expect(result.count).toBe(11)
  })

  test("returns cleaned text when no template matches", () => {
    const result = Disambiguation.analyze("请帮我修复一个bug，谢谢", { maxCandidates: 5, maxBatch: 10 })
    expect(result.kind).toBe("none")
    if (result.kind !== "none") return
    expect(result.cleaned).toBe("修复一个bug")
  })

  test("meets baseline accuracy threshold", () => {
    const cases = [
      { input: "帮我清理服务器日志", expected: "删除生产环境P002服务器近7天的旧日志" },
      { input: "清理服务器日志", expected: "删除生产环境P002服务器近7天的旧日志" },
      { input: "删除服务器日志", expected: "删除生产环境P002服务器近7天的旧日志" },
      { input: "备份服务器日志", expected: "打包备份生产环境P002服务器近7天的日志" },
      { input: "查一下服务器日志报错", expected: "查询生产环境P002服务器近7天日志的报错" },
      { input: "查一下测试环境服务器日志报错 24小时", expected: "查询测试环境S001服务器近24小时日志的报错" },
      { input: "清理测试环境服务器日志 24小时", expected: "删除测试环境S001服务器近24小时的旧日志" },
      { input: "删除生产环境日志 24小时", expected: "删除生产环境P002服务器近24小时的旧日志" },
      { input: "打包归档服务器日志", expected: "打包备份生产环境P002服务器近7天的日志" },
      { input: "查询服务器日志错误 7天", expected: "查询生产环境P002服务器近7天日志的报错" },
      { input: "同步CRM数据", expected: "将测试环境CRM客户数据同步至生产环境，覆盖重复条目" },
      { input: "同步crm数据", expected: "将测试环境CRM客户数据同步至生产环境，覆盖重复条目" },
      { input: "将测试环境CRM客户数据同步至生产环境", expected: "将测试环境CRM客户数据同步至生产环境，覆盖重复条目" },
      { input: "同步CRM客户数据 跳过重复", expected: "将测试环境CRM客户数据同步至生产环境，跳过重复条目" },
      { input: "优化接口性能", expected: "优化用户登录接口的响应速度，目标延迟低于200ms" },
      { input: "优化登录接口性能", expected: "优化用户登录接口的响应速度，目标延迟低于200ms" },
      { input: "优化接口响应速度 500ms", expected: "优化用户登录接口的响应速度，目标延迟低于500ms" },
      { input: "优化用户登录接口延迟 200ms", expected: "优化用户登录接口的响应速度，目标延迟低于200ms" },
      { input: "请帮我修复一个bug，谢谢", expected: "修复一个bug" },
      { input: "请优化一下，谢谢", expected: "优化" },
    ] as const

    const resolved = (input: string) => {
      const result = Disambiguation.analyze(input, { maxCandidates: 5, maxBatch: 10 })
      if (result.kind === "ambiguous") return result.candidates[0]?.text ?? result.cleaned
      if (result.kind === "batch_resolved") return result.resolvedLines.join("\n")
      if (result.kind === "none") return result.cleaned
      return input
    }

    const correct = cases.filter((c) => resolved(c.input) === c.expected).length
    const accuracy = correct / cases.length
    expect(accuracy).toBeGreaterThanOrEqual(0.95)
  })
})
