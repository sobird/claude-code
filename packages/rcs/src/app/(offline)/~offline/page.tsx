import styles from './page.module.css'

/** Served at `/~offline` and precached as the service-worker fallback. */
export default function OfflinePage() {
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>You are offline · 当前离线</h1>
      <p className={styles.body}>
        Remote Control needs a connection. Reconnect and the app will pick up where you left off.
        <br />
        远程控制需要网络连接。重新连接后，应用会从上次中断的地方继续。
      </p>
    </main>
  )
}
