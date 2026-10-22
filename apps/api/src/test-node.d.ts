// Minimal Node typings for the source-scan test only (the Worker project has no @types/node).
declare module 'node:fs' {
  export function readFileSync(path: URL, encoding: 'utf8'): string;
}

interface ImportMeta {
  url: string;
}
