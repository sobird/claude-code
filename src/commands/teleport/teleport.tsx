import * as React from 'react'

import { TeleportResumeWrapper } from '../../components/TeleportResumeWrapper.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import type { TeleportRemoteResponse } from '../../utils/conversationRecovery.js'

type TeleportProps = {
  onExit: Parameters<LocalJSXCommandCall>[0]
  context: Parameters<LocalJSXCommandCall>[1]
}

function Teleport({ onExit, context }: TeleportProps): React.ReactNode {
  const handleComplete = (result: TeleportRemoteResponse) => {
    context.setMessages(() => result.log)
    onExit('Session resumed successfully', { display: 'system' })
  }
  const handleCancel = () => onExit('Teleport cancelled', { display: 'system' })
  const handleError = (message: string) => onExit(message, { display: 'system' })

  return (
    <TeleportResumeWrapper
      onComplete={handleComplete}
      onCancel={handleCancel}
      onError={handleError}
      isEmbedded
      source="localCommand"
    />
  )
}

export const call: LocalJSXCommandCall = async (onDone, context) => {
  return <Teleport onExit={onDone} context={context} />
}
