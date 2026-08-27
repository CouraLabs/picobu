import { createStore } from "@xstate/store-react";

export type CodingState = {
  messages: []
  prompt?: {
    current?: string,
    images?: { id: string, data: string }[], 
    list?: string[]
  }
}

export const codingStore = createStore({
  context: {
    messages: [],
  } as CodingState,
  on: {
    prompt: (state, event: { prompt: string }) => ({
      ...state,
      prompt: {
        current: event.prompt,
        list: [ event.prompt, ...(state.prompt?.list ?? []) ]
      }
    })
  }
});