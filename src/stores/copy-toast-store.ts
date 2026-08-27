import { createStore } from "@xstate/store-react";

export type CopyToastState = {
  visible: boolean;
};

export const copyToastStore = createStore({
  context: { visible: false } as CopyToastState,
  on: {
    show: () => ({ visible: true }),
    hide: () => ({ visible: false }),
  },
});