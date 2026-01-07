import { RGBA, TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useDialog, type DialogContext } from "@tui/ui/dialog"
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { Locale } from "@/util/locale"
import { Disambiguation } from "@/disambiguation"

export type DialogDisambiguateProps = {
  original: string
  cleaned: string
  slots: Disambiguation.Slot[]
  candidates: Disambiguation.Candidate[]
  countdownMs: number
  onResolve: (value: string) => void
  onCancel: () => void
}

export function DialogDisambiguate(props: DialogDisambiguateProps) {
  const dialog = useDialog()
  const { theme } = useTheme()

  const [selected, setSelected] = createSignal(0)
  const deadline = Date.now() + props.countdownMs
  const [secondsLeft, setSecondsLeft] = createSignal(Math.max(0, Math.ceil(props.countdownMs / 1000)))

  const options = createMemo(() => props.candidates.map((c) => c.text))
  const defaultValue = createMemo(() => options()[0] ?? props.cleaned)

  const resolve = (value: string) => {
    props.onResolve(value)
    dialog.clear()
  }

  const cancel = () => {
    props.onCancel()
    dialog.clear()
  }

  useKeyboard((evt) => {
    if (evt.name === "escape") {
      cancel()
      return
    }
    if (evt.name === "up") setSelected((i) => (i - 1 + options().length) % options().length)
    if (evt.name === "down") setSelected((i) => (i + 1) % options().length)
    if (evt.name === "return") resolve(options()[selected()] ?? defaultValue())

    const n = Number.parseInt(evt.name, 10)
    if (Number.isFinite(n) && n >= 1 && n <= options().length) {
      resolve(options()[n - 1]!)
    }
  })

  onMount(() => {
    const interval = setInterval(() => {
      setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)))
    }, 200)
    onCleanup(() => {
      clearInterval(interval)
    })
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Disambiguate
        </text>
        <text fg={theme.textMuted}>{secondsLeft()}s · esc cancel</text>
      </box>

      <Show when={props.cleaned !== props.original}>
        <box>
          <text fg={theme.textMuted}>
            <span style={{ fg: theme.text }}>Input:</span> {Locale.truncate(props.original, 52)}
          </text>
          <text fg={theme.textMuted}>
            <span style={{ fg: theme.text }}>Clean:</span> {Locale.truncate(props.cleaned, 52)}
          </text>
        </box>
      </Show>

      <box gap={0}>
        <For each={props.slots}>
          {(slot) => {
            const fg = slot.level === "high" ? theme.error : theme.warning
            const joined = slot.options.map((o) => o.label).join(" / ")
            return (
              <text fg={theme.textMuted}>
                <span style={{ fg, bold: true }}>{slot.level === "high" ? "●" : "○"}</span>{" "}
                <span style={{ fg: theme.text }}>{slot.label}:</span> {joined}
              </text>
            )
          }}
        </For>
      </box>

      <box paddingTop={1} paddingBottom={1} gap={0}>
        <For each={options()}>
          {(opt, index) => {
            const active = createMemo(() => index() === selected())
            return (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={active() ? theme.primary : RGBA.fromInts(0, 0, 0, 0)}
                onMouseUp={() => resolve(opt)}
              >
                <text fg={active() ? theme.selectedListItemText : theme.text} attributes={active() ? TextAttributes.BOLD : undefined}>
                  {index() + 1}. {Locale.truncate(opt, 54)}
                </text>
              </box>
            )
          }}
        </For>
      </box>

      <box paddingBottom={1} flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted}>
          enter <span style={{ fg: theme.textMuted }}>select</span>
        </text>
        <text fg={theme.textMuted}>
          1-{options().length} <span style={{ fg: theme.textMuted }}>quick pick</span>
        </text>
      </box>
    </box>
  )
}

DialogDisambiguate.show = (
  dialog: DialogContext,
  data: Pick<Disambiguation.AmbiguousResult, "original" | "cleaned" | "slots" | "candidates">,
  options: { countdownMs: number },
) => {
  return new Promise<string | null>((resolve) => {
    if (data.candidates.length === 0) {
      resolve(data.cleaned)
      return
    }
    let settled = false
    const countdownMs = Number.isFinite(options.countdownMs) && options.countdownMs > 0 ? options.countdownMs : 3000
    const fallback = () => data.candidates[0]?.text ?? data.cleaned
    const timeout = setTimeout(() => {
      settle(fallback())
      dialog.clear()
    }, countdownMs)

    const settle = (value: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(value)
    }

    dialog.replace(
      () => (
        <DialogDisambiguate
          original={data.original}
          cleaned={data.cleaned}
          slots={data.slots}
          candidates={data.candidates}
          countdownMs={countdownMs}
          onResolve={(value) => settle(value)}
          onCancel={() => settle(null)}
        />
      ),
      () => {
        // If the dialog is closed (esc) without an explicit selection, treat it as cancel.
        settle(null)
      },
    )
  })
}
