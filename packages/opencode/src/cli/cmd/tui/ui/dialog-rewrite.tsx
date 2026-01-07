import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useDialog, type DialogContext } from "@tui/ui/dialog"
import { createSignal, onCleanup, onMount } from "solid-js"
import { Locale } from "@/util/locale"

export type DialogRewriteProps = {
  original: string
  rewritten: string
  countdownMs: number
  onAccept: (value: string) => void
  onCancel: () => void
}

export function DialogRewrite(props: DialogRewriteProps) {
  const dialog = useDialog()
  const { theme } = useTheme()

  const deadline = Date.now() + props.countdownMs
  const [secondsLeft, setSecondsLeft] = createSignal(Math.max(0, Math.ceil(props.countdownMs / 1000)))

  const accept = () => {
    props.onAccept(props.rewritten)
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
    if (evt.name === "return") {
      accept()
      return
    }
  })

  onMount(() => {
    const interval = setInterval(() => {
      setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)))
    }, 200)
    onCleanup(() => clearInterval(interval))
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Rewrite
        </text>
        <text fg={theme.textMuted}>{secondsLeft()}s / esc cancel</text>
      </box>

      <box gap={0}>
        <text fg={theme.textMuted}>
          <span style={{ fg: theme.text }}>Input:</span> {Locale.truncate(props.original, 56)}
        </text>
        <text fg={theme.textMuted}>
          <span style={{ fg: theme.text }}>Rewrite:</span> {Locale.truncate(props.rewritten, 56)}
        </text>
      </box>

      <box paddingTop={1} paddingBottom={1} flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted}>
          enter <span style={{ fg: theme.textMuted }}>accept</span>
        </text>
        <text fg={theme.textMuted}>
          (auto accept in {Math.max(0, Math.ceil(props.countdownMs / 1000))}s)
        </text>
      </box>
    </box>
  )
}

DialogRewrite.show = (
  dialog: DialogContext,
  data: { original: string; rewritten: string },
  options: { countdownMs: number },
) => {
  return new Promise<string | null>((resolve) => {
    const countdownMs = Number.isFinite(options.countdownMs) && options.countdownMs > 0 ? options.countdownMs : 3000
    let settled = false

    const settle = (value: string | null) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    const timeout = setTimeout(() => {
      settle(data.rewritten)
      dialog.clear()
    }, countdownMs)

    dialog.replace(
      () => (
        <DialogRewrite
          original={data.original}
          rewritten={data.rewritten}
          countdownMs={countdownMs}
          onAccept={(value) => {
            clearTimeout(timeout)
            settle(value)
          }}
          onCancel={() => {
            clearTimeout(timeout)
            settle(null)
          }}
        />
      ),
      () => {
        clearTimeout(timeout)
        settle(null)
      },
    )
  })
}

