/** Served at `/code/~offline` and precached as the service-worker fallback. */
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background p-6 text-center">
      <h1 className="font-display text-xl font-semibold text-text-primary">You are offline · 当前离线</h1>
      <p className="max-w-sm text-sm text-text-secondary">
        Remote Control needs a connection. Reconnect and the app will pick up where you left off.
        <br />
        远程控制需要网络连接。重新连接后，应用会从上次中断的地方继续。
      </p>
    </main>
  )
}
