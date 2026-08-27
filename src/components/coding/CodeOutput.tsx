import { useSelector } from "@xstate/store-react";
import { themeStore } from "../../stores/theme-store";
import { ScrollableOutput } from "./ScrollableOutput";

type CodeOutputProps = {
  filetype?: string;
  content: string;
};

/** Scrollable, syntax-highlighted code block for a tool's file/content output. */
export const CodeOutput = ({ filetype, content }: CodeOutputProps) => {
  const syntax = useSelector(themeStore, (s) => s.context.syntax);

  return (
    <ScrollableOutput>
      <code selectable={false} filetype={filetype} syntaxStyle={syntax} content={content} />
    </ScrollableOutput>
  );
};