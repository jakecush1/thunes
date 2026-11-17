/**
 * The project has no Node type declarations (@types/node is not a dependency).
 * These are the few Node APIs the build-time asset scanner and its tests use.
 */
declare module 'node:fs' {
  interface Dirent {
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
  }
  interface Stats {
    size: number;
    isDirectory(): boolean;
    isFile(): boolean;
  }
  const fs: {
    readdirSync(path: string, options: { withFileTypes: true }): Dirent[];
    statSync(path: string): Stats;
    existsSync(path: string): boolean;
    readFileSync(path: string, encoding: 'utf8'): string;
    openSync(path: string, flags: string): number;
    readSync(fd: number, buffer: Uint8Array, offset: number, length: number, position: number): number;
    closeSync(fd: number): void;
    mkdirSync(path: string, options?: { recursive?: boolean }): void;
    mkdtempSync(prefix: string): string;
    writeFileSync(path: string, data: string | Uint8Array): void;
    rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  };
  export default fs;
}

declare module 'node:path' {
  const path: {
    join(...parts: string[]): string;
    resolve(...parts: string[]): string;
    relative(from: string, to: string): string;
    dirname(path: string): string;
    basename(path: string): string;
    sep: string;
  };
  export default path;
}
