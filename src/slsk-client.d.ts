declare module 'slsk-client' {
  interface SlskConnectOptions {
    user: string
    pass: string
    host?: string
    port?: number
    incomingPort?: number
    sharedFolders?: string[]
  }

  interface SlskFile {
    user: string
    file: string
    size: number
    slots: boolean
    bitrate?: number
    speed?: number
  }

  interface SlskSearchOptions {
    req: string
    timeout?: number
  }

  interface SlskDownloadOptions {
    file: SlskFile
    path?: string
  }

  interface SlskDownloadResult {
    buffer: Buffer
  }

  interface SlskClient {
    search(opts: SlskSearchOptions, cb: (err: Error | null, res: SlskFile[]) => void): void
    download(opts: SlskDownloadOptions, cb: (err: Error | null, data: SlskDownloadResult) => void): void
    on(event: string, listener: (...args: unknown[]) => void): void
  }

  function connect(opts: SlskConnectOptions, cb: (err: Error | null, client: SlskClient) => void): void

  export { connect, SlskClient, SlskFile, SlskSearchOptions, SlskDownloadOptions, SlskDownloadResult, SlskConnectOptions }
}
