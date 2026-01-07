import { test, expect } from "bun:test"
import { Rewrite } from "../../src/rewrite"

test("rewrite.shouldRewrite triggers on Chinese text without punctuation", () => {
  expect(Rewrite.shouldRewrite("首页商城我的几个分页")).toBe(true)
  expect(Rewrite.shouldRewrite("首页、商城、我的几个分页；")).toBe(false)
  expect(Rewrite.shouldRewrite("npm install")).toBe(false)
  expect(Rewrite.shouldRewrite("```ts\nconsole.log(1)\n```")).toBe(false)
})

test("rewrite.rewrite calls openai-compatible endpoint and parses content", async () => {
  let calledUrl = ""
  const fetcher = async (input: RequestInfo | URL) => {
    calledUrl = String(input)
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "首页、商城、我的几个分页；",
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  }

  const result = await Rewrite.rewrite("首页商城我的几个分页", {
    url: "https://example.com",
    model: "test-model",
    fetcher,
  })

  expect(calledUrl).toBe("https://example.com/v1/chat/completions")
  expect(result.kind).toBe("rewritten")
  if (result.kind === "rewritten") {
    expect(result.output).toBe("首页、商城、我的几个分页；")
  }
})

test("rewrite.rewrite strips code fences and quotes", async () => {
  const fetcher = async () => {
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "```text\n“首页、商城、我的几个分页；”\n```",
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  }

  const result = await Rewrite.rewrite("首页商城我的几个分页", {
    url: "https://example.com/v1",
    model: "test-model",
    fetcher,
  })

  expect(result.kind).toBe("rewritten")
  if (result.kind === "rewritten") {
    expect(result.output).toBe("首页、商城、我的几个分页；")
  }
})

test("rewrite.rewrite returns error on non-2xx response", async () => {
  const fetcher = async () => new Response("bad request", { status: 400 })
  const result = await Rewrite.rewrite("首页商城我的几个分页", {
    url: "https://example.com",
    model: "test-model",
    fetcher,
  })
  expect(result.kind).toBe("error")
})

