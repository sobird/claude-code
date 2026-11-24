import { getTranslations } from 'next-intl/server'

import { DeviceApproval } from '@/components/device/DeviceApproval'
import { SettingsApiProvider } from '@/components/settings/use-settings-api'

import styles from './page.module.css'

/** `/device` — 批准插件设备码，并给出「连接一台机器」的安装命令。 */
export default async function DevicePage() {
  const t = await getTranslations('device')

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('title')}</h1>
        <p className={styles.description}>{t('description')}</p>
      </header>

      <SettingsApiProvider>
        <DeviceApproval />
      </SettingsApiProvider>
    </div>
  )
}
