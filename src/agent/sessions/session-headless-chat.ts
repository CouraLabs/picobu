import { AbstractChat, type ChatInit, type ChatState, type ChatStatus } from "ai";
import type { Loop, LoopMessage } from "@agent/loop/create-loop.ts";

export class Chat extends AbstractChat<LoopMessage> {
  readonly loop: Loop;
  constructor({
    loop,
    ...init
  }: ChatInit<LoopMessage> & { state: ChatState<LoopMessage>; loop: Loop }) {
    super(init);
    this.loop = loop;
  }
}

export type ChatChangeHandler = (state: ChatState<LoopMessage>) => void;

export function createHeadlessChatState(
  messages: LoopMessage[] = [],
  onChange?: ChatChangeHandler,
): ChatState<LoopMessage> {
  let status: ChatStatus = "ready";
  let error: Error | undefined;
  let messageList: LoopMessage[] = messages;
  const notify = () => onChange?.(state);
  const state: ChatState<LoopMessage> = {
    get status() {
      return status;
    },
    set status(value) {
      status = value;
      notify();
    },
    get error() {
      return error;
    },
    set error(value) {
      error = value;
      notify();
    },
    get messages() {
      return messageList;
    },
    set messages(value) {
      messageList = value;
      notify();
    },
    pushMessage: (message) => {
      messageList.push(message);
      notify();
    },
    popMessage: () => {
      const popped = messageList.pop();
      notify();
      return popped;
    },
    replaceMessage: (index, message) => {
      messageList[index] = message;
      notify();
    },
    snapshot: <T>(thing: T): T => structuredClone(thing),
  };
  return state;
}
