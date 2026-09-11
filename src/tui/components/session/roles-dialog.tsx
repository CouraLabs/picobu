import { resolveModelRef } from '@agent/model/resolver.ts'
import { options, updateSettings } from '@config/options.ts'
import { closeDialog, openDialog } from '@states/dialog.state.ts'
import { theme } from '@states/theme-state.ts'
import { Button } from '@tui/components/button.tsx'
import { ModelSelect } from '@tui/components/session/model-select.tsx'
import { THINKING_LEVELS } from '@tui/components/session/session-status.tsx'
import { createSignal, For, Show } from 'solid-js'

const EFFORTS: Array<string> = [...THINKING_LEVELS]

const cycleEffort = (current: string): string => {
  const index = EFFORTS.indexOf(current)
  const next = EFFORTS[(index + 1) % EFFORTS.length] ?? EFFORTS[0]
  if (next === undefined) throw new Error('No thinking levels configured')
  return next
}

const openModelPicker = (current: string | undefined, onPick: (modelKey: string) => void, reopen: () => void) => {
  openDialog(() => (
    <ModelSelect
      currentModelKey={current}
      onSelect={(selected) => {
        onPick(selected)
        reopen()
      }}
    />
  ))
}

export const openRolesDialog = () => {
  const render = () => openDialog(() => <RolesDialogView reopen={render} />)
  render()
}

const RolesDialogView = (props: { reopen: () => void }) => {
  const roles = () => options.harness.modelRoles ?? {}
  const [defaultModel, setDefaultModel] = createSignal(options.harness.defaultModel ?? '')
  const [tiny, setTiny] = createSignal(roles().tiny ?? '')
  const [flash, setFlash] = createSignal(roles().flash ?? '')
  const [heavy, setHeavy] = createSignal(roles().heavy ?? '')
  const [flashThinking, setFlashThinking] = createSignal(roles().flashThinking ?? 'medium')
  const [heavyThinking, setHeavyThinking] = createSignal(roles().heavyThinkingLevel ?? 'high')
  const [error, setError] = createSignal<string | undefined>(undefined)
  const [saving, setSaving] = createSignal(false)

  const modelRows: Array<{ label: string; value: () => string; set: (v: string) => void }> = [
    { label: 'default', value: defaultModel, set: setDefaultModel },
    { label: 'tiny', value: tiny, set: setTiny },
    { label: 'flash', value: flash, set: setFlash },
    { label: 'heavy', value: heavy, set: setHeavy },
  ]

  const effortRows: Array<{ label: string; value: () => string; set: (v: string) => void }> = [
    { label: 'flashThinking', value: flashThinking, set: setFlashThinking },
    { label: 'heavyThinkingLevel', value: heavyThinking, set: setHeavyThinking },
  ]

  const save = async () => {
    setSaving(true)
    setError(undefined)
    try {
      for (const key of [defaultModel(), tiny(), flash(), heavy()].filter((v) => v.trim().length > 0)) {
        resolveModelRef(key)
      }
      const next = await updateSettings({
        harness: {
          ...options.harness,
          defaultModel: defaultModel().trim() || undefined,
          modelRoles: {
            tiny: tiny().trim() || undefined,
            flash: flash().trim() || undefined,
            flashThinking: flashThinking(),
            heavy: heavy().trim() || undefined,
            heavyThinkingLevel: heavyThinking(),
          },
        },
      })
      if (next.harness) options.harness = next.harness
      closeDialog()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <box flexDirection="column" width={72} paddingX={2} paddingY={1} gap={1}>
      <box border={['bottom']} borderColor={theme().border} flexShrink={0}>
        <text fg={theme().text}>Model roles</text>
      </box>
      <For each={modelRows}>
        {(row) => (
          <box flexDirection="row" gap={1} flexShrink={0} alignItems="center">
            <text fg={theme().textMuted}>{row.label}</text>
            <Button label={row.value().trim() ? row.value() : '(unset)'} onClick={() => openModelPicker(row.value().trim() || undefined, row.set, props.reopen)} />
          </box>
        )}
      </For>
      <For each={effortRows}>
        {(row) => (
          <box flexDirection="row" gap={1} flexShrink={0} alignItems="center">
            <text fg={theme().textMuted}>{row.label}</text>
            <Button label={row.value()} onClick={() => row.set(cycleEffort(row.value()))} />
          </box>
        )}
      </For>
      <Show when={error()}>
        <text fg={theme().error}>{error()}</text>
      </Show>
      <box flexDirection="row" gap={1} justifyContent="flex-end" flexShrink={0}>
        <Button label="Cancel" onClick={closeDialog} />
        <Button label={saving() ? 'Saving…' : 'Save'} onClick={() => void save()} />
      </box>
      <box border={['top']} borderColor={theme().border} flexShrink={0}>
        <text fg={theme().textMuted}>(esc to close · applies to future runs)</text>
      </box>
    </box>
  )
}
