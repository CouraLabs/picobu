// Ambient declarations for text imports (import attributes `with { type: "text" }`):
// the web client inlines xterm's CSS/JS from node_modules at bundle time.
declare module "*.css" {
  const content: string;
  export default content;
}

declare module "*.js" {
  const content: string;
  export default content;
}
