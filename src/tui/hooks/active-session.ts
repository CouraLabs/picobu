let activeSessionId: string | undefined;
let activeHasMessages = false;

export const setActiveSessionId = (id: string | undefined): void => {
  activeSessionId = id;
  if (id === undefined) activeHasMessages = false;
};

export const markActiveSessionHasMessages = (): void => {
  activeHasMessages = true;
};

export const getActiveSessionClose = (): { id: string; hasMessages: boolean } | undefined =>
  activeSessionId ? { id: activeSessionId, hasMessages: activeHasMessages } : undefined;
