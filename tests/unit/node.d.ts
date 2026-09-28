// The little of Node that unit tests use. The project has no Node types on purpose, so game code cannot reach
// for Node APIs by accident.
declare module 'node:child_process' {
  export function execFileSync(file: string, args: readonly string[], options: { encoding: 'utf8' }): string;
}

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}
