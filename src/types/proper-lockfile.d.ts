// Type declarations for proper-lockfile
// This package doesn't have @types, so we declare minimal types here

declare module 'proper-lockfile' {
  export interface LockOptions {
    retries?: {
      retries: number
      factor?: number
      minTimeout?: number
      maxTimeout?: number
    } | number
    stale?: number
    realpath?: boolean
    onCompromised?: (err: Error) => void
    lockfilePath?: string
  }

  export interface UnlockOptions {
    realpath?: boolean
    lockfilePath?: string
  }

  export interface CheckOptions {
    realpath?: boolean
    stale?: number
    lockfilePath?: string
  }

  export type ReleaseFunction = () => Promise<void>

  export function lock(
    file: string,
    options?: LockOptions
  ): Promise<ReleaseFunction>

  export function unlock(
    file: string,
    options?: UnlockOptions
  ): Promise<void>

  export function check(
    file: string,
    options?: CheckOptions
  ): Promise<boolean>

  export function lockSync(
    file: string,
    options?: LockOptions
  ): ReleaseFunction

  export function unlockSync(
    file: string,
    options?: UnlockOptions
  ): void

  export function checkSync(
    file: string,
    options?: CheckOptions
  ): boolean
}
