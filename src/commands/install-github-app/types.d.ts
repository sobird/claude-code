// Workflow files the installer can write into the target repository.
export type Workflow = 'claude' | 'claude-review'

export type Warning = {
  title: string
  message: string
  instructions: string[]
}

// Wizard state. Optional fields are only populated on error / workflow-action
// branches, so flows that never touch them can leave them unset.
export type State = {
  step:
    | 'check-gh'
    | 'warnings'
    | 'choose-repo'
    | 'install-app'
    | 'check-existing-workflow'
    | 'select-workflows'
    | 'check-existing-secret'
    | 'api-key'
    | 'creating'
    | 'success'
    | 'error'
    | 'oauth-flow'
  selectedRepoName: string
  currentRepo: string
  useCurrentRepo: boolean
  apiKeyOrOAuthToken: string
  useExistingKey: boolean
  currentWorkflowInstallStep: number
  warnings: Warning[]
  secretExists: boolean
  secretName: string
  useExistingSecret: boolean
  workflowExists: boolean
  selectedWorkflows: Workflow[]
  selectedApiKeyOption: 'existing' | 'new' | 'oauth'
  authType: 'api_key' | 'oauth_token'
  workflowAction?: 'update' | 'skip' | 'exit'
  error?: string
  errorReason?: string
  errorInstructions?: string[]
}
