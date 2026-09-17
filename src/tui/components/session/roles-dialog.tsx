import { resolveModelRef } from '@agent/model/resolver.ts'
import { options, updateSettings } from '@config/options.ts'
import { closeDialog, openDialog } from '@states/dialog.state.ts'
import { theme } from '@states/theme-state.ts'
import { Button } from '@tui/components/button.tsx'
import { ModelSelect } from '@tui/components/session/model-select.tsx'
import { THINKING_LEVELS } from '@tui/components/session/session-status.tsx'
import { type Accessor, createSignal, For, Show } from 'solid-js'

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

interface RolesDialogState {
  defaultModel: Accessor<string>
  tiny: Accessor<string>
  flash: Accessor<string>
  heavy: Accessor<string>
  flashThinking: Accessor<string>
  heavyThinkingLevel: Accessor<string>
  setDefaultModel: (v: string) => void
  setTiny: (v: string) => void
  setFlash: (v: string) => void
  setHeavy: (v: string) => void
  setFlashThinking: (v: string) => void
  setHeavyThinkingLevel: (v: string) => void
}

export const openRolesDialog = () => {
  const roles = () => options.harness.modelRoles ?? {}
  const [defaultModel, setDefaultModel] = createSignal(options.harness.defaultModel ?? '')
  const [tiny, setTiny] = createSignal(roles().tiny ?? '')
  const [flash, setFlash] = createSignal(roles().flash ?? '')
  const [heavy, setHeavy] = createSignal(roles().heavy ?? '')
  const [flashThinking, setFlashThinking] = createSignal(roles().flashThinking ?? 'medium')
  const [heavyThinkingLevel, setHeavyThinkingLevel] = createSignal(roles().heavyThinkingLevel ?? 'high')
  const state: RolesDialogState = {
    defaultModel,
    tiny,
    flash,
    heavy,
    flashThinking,
    heavyThinkingLevel,
    setDefaultModel,
    setTiny,
    setFlash,
    setHeavy,
    setFlashThinking,
    setHeavyThinkingLevel,
  }
  const render = () => openDialog(() => <RolesDialogView state={state} reopen={render} />)
  render()
}

const RolesDialogView = (props: { state: RolesDialogState; reopen: () => void }) => {
  const [error, setError] = createSignal<string | undefined>(undefined)
  const [saving, setSaving] = createSignal(false)

  const save = async () => {
    setError(undefined)
    setSaving(true)
    try {
      for (const key of [props.state.defaultModel(), props.state.tiny(), props.state.flash(), props.state.heavy()].filter((v) => v.trim().length > 0)) {
        resolveModelRef(key)
      }
      const next = await updateSettings({
        harness: {
          ...options.harness,
          defaultModel: props.state.defaultModel().trim() || undefined,
          modelRoles: {
            tiny: props.state.tiny().trim() || undefined,
            flash: props.state.flash().trim() || undefined,
            flashThinking: props.state.flashThinking(),
            heavy: props.state.heavy().trim() || undefined,
            heavyThinkingLevel: props.state.heavyThinkingLevel(),
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

  const modelRows: Array<{ label: string; value: () => string; set: (v: string) => void }> = [
    { label: 'default', value: props.state.defaultModel, set: props.state.setDefaultModel },
    { label: 'tiny', value: props.state.tiny, set: props.state.setTiny },
    { label: 'flash', value: props.state.flash, set: props.state.setFlash },
    { label: 'heavy', value: props.state.heavy, set: props.state.setHeavy },
  ]

  const effortRows: Array<{ label: string; value: () => string; set: (v: string) => void }> = [
    { label: 'flashThinking', value: props.state.flashThinking, set: props.state.setFlashThinking },
    { label: 'heavyThinkingLevel', value: props.state.heavyThinkingLevel, set: props.state.setHeavyThinkingLevel },
  ]

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
