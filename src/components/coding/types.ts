export type ToolStatus = "success" | "error";

export type ReadToolCallProps = {
  status: ToolStatus;
  path: string;
  range?: { from?: number; to?: number };
  output?: string;
  filetype?: string;
  error?: string;
};

export type EditToolCallProps = {
  status: ToolStatus;
  path: string;
  message?: string;
  diff?: string;
  error?: string;
};

export type WriteToolCallProps = {
  status: ToolStatus;
  path: string;
  output?: string;
  content?: string;
  error?: string;
};

export type BashToolCallProps = {
  status: ToolStatus;
  command: string;
  cwd?: string;
  output?: string;
  error?: string;
};

export type GrepToolCallProps = {
  status: ToolStatus;
  pattern: string;
  path?: string;
  output?: string;
  filetype?: string;
  error?: string;
};

export type GlobToolCallProps = {
  status: ToolStatus;
  pattern: string;
  output?: string;
  error?: string;
};

/** Discriminated union of every tool call the coding page can render. */
export type ToolCallModel =
  | ({ name: "read" } & ReadToolCallProps)
  | ({ name: "edit" } & EditToolCallProps)
  | ({ name: "write" } & WriteToolCallProps)
  | ({ name: "bash" } & BashToolCallProps)
  | ({ name: "grep" } & GrepToolCallProps)
  | ({ name: "glob" } & GlobToolCallProps);