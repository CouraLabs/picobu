import type { Loop, LoopMessage } from '@agent/loop/create-loop.ts'
import { AbstractChat, type ChatInit, type ChatState, type ChatStatus } from 'ai'

export class Chat extends AbstractChat<LoopMessage> {
  readonly loop: Loop
  constructor({ loop, ...init }: ChatInit<LoopMessage> & { state: ChatState<LoopMessage>; loop: Loop }) {
    super(init)
    this.loop = loop
  }
}

const cloneMessages = (value: LoopMessage[]): LoopMessage[] => {
  try {
    return structuredClone(value)
  } catch (error) {
    console.error('picobu: message snapshot failed, falling back to shared references:', error)
    return value
  }
}

export type ChatChangeHandler = (state: ChatState<LoopMessage>) => void

export function createHeadlessChatState(messages: LoopMessage[] = [], onChange?: ChatChangeHandler): ChatState<LoopMessage> {
  let status: ChatStatus = 'ready'
  let error: Error | undefined
  let messageList: LoopMessage[] = cloneMessages(messages)
  const notify = () => onChange?.(state)
  const state: ChatState<LoopMessage> = {
    get status() {
      return status
    },
    set status(value) {
      status = value
      notify()
    },
    get error() {
      return error
    },
    set error(value) {
      error = value
      notify()
    },
    get messages() {
      return messageList
    },
    set messages(value) {
      messageList = cloneMessages(value)
      notify()
    },
    pushMessage: (message) => {
      const cloned = cloneMessages([message])[0]
      if (!cloned) throw new Error('Failed to clone message')
      messageList.push(cloned)
      notify()
    },
    popMessage: () => {
      const popped = messageList.pop()
      notify()
      return popped
    },
    replaceMessage: (index, message) => {
      const cloned = cloneMessages([message])[0]
      if (!cloned) throw new Error('Failed to clone message')
      messageList[index] = cloned
      notify()
    },
    snapshot: <T>(thing: T): T => structuredClone(thing),
  }
  return state
}
