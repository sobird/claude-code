import { bugs, name, version } from '../package.json'

export type BuildTarget = 'ant' | 'external'
export type BuildEnv = 'development' | 'production' | 'test'

export const defines = {
  'MACRO.VERSION': JSON.stringify(version),
  'MACRO.BUILD_TIME': JSON.stringify(new Date().toISOString()),
  'MACRO.FEEDBACK_CHANNEL': JSON.stringify(bugs.url),
  'MACRO.ISSUES_EXPLAINER': JSON.stringify(`report the issue at ${bugs.url}`),
  'MACRO.NATIVE_PACKAGE_URL': JSON.stringify(name),
  'MACRO.PACKAGE_URL': JSON.stringify(name),
  'MACRO.VERSION_CHANGELOG': JSON.stringify(''),
}

export const features = [
  // 'ABLATION_BASELINE',
  // 'AGENT_MEMORY_SNAPSHOT',
  'AGENT_TRIGGERS',
  'AGENT_TRIGGERS_REMOTE',
  // 'ALLOW_TEST_VERSIONS',
  // 'ANTI_DISTILLATION_CC',
  'AUTO_THEME',
  // 'AWAY_SUMMARY', // 默认：未开启
  // 'BASH_CLASSIFIER',
  // 'BG_SESSIONS',
  // 'BREAK_CACHE_COMMAND',
  'BRIDGE_MODE',
  // 'BUDDY',
  'BUILDING_CLAUDE_APPS',
  'BUILTIN_EXPLORE_PLAN_AGENTS',
  // 'BYOC_ENVIRONMENT_RUNNER',
  'CACHED_MICROCOMPACT',
  // 'CCR_AUTO_CONNECT',
  // 'CCR_MIRROR',
  // 'CCR_REMOTE_SETUP',
  'CHICAGO_MCP',
  // 'COMMIT_ATTRIBUTION',
  // 'COMPACTION_REMINDERS',
  // 'CONNECTOR_TEXT',
  // 'CONTEXT_COLLAPSE',  // 默认：未开启
  // 'COORDINATOR_MODE', // default: false
  // 'COWORKER_TYPE_TELEMETRY',
  // 'DAEMON', // 默认：未开启
  // 'DIRECT_CONNECT',
  // 'DOWNLOAD_USER_SETTINGS',
  // 'DUMP_SYSTEM_PROMPT',
  'ENHANCED_TELEMETRY_BETA',
  // 'EXPERIMENTAL_SKILL_SEARCH',
  'EXTRACT_MEMORIES',
  // 'FILE_PERSISTENCE',
  // 'FORK_SUBAGENT', // 默认 未开启
  // 'HARD_FAIL',
  // 'HISTORY_PICKER',
  // 'HISTORY_SNIP', // 默认 未开启
  // 'HOOK_PROMPTS',
  // 'IS_LIBC_GLIBC',
  // 'IS_LIBC_MUSL',
  'KAIROS',
  'KAIROS_BRIEF',
  // 'KAIROS_CHANNELS',
  // 'KAIROS_DREAM',
  // 'KAIROS_GITHUB_WEBHOOKS',
  // 'KAIROS_PUSH_NOTIFICATION',
  'LODESTONE',
  // 'MCP_RICH_OUTPUT',
  // 'MCP_SKILLS',
  // 'MEMORY_SHAPE_TELEMETRY',
  // 'MESSAGE_ACTIONS',
  // 'MONITOR_TOOL', // 默认 未开启
  'NATIVE_CLIENT_ATTESTATION',
  'NATIVE_CLIPBOARD_IMAGE',
  'NEW_INIT',
  // 'OVERFLOW_TEST_TOOL',
  // 'PERFETTO_TRACING',
  // 'POWERSHELL_AUTO_MODE',
  // 'PROACTIVE',
  // 'PROMPT_CACHE_BREAK_DETECTION',
  // 'QUICK_SEARCH',
  // 'REACTIVE_COMPACT',
  // 'REVIEW_ARTIFACT',
  // 'RUN_SKILL_GENERATOR',
  // 'SELF_HOSTED_RUNNER',
  // 'SHOT_STATS',
  // 'SKILL_IMPROVEMENT',
  // 'SKIP_DETECTION_WHEN_AUTOUPDATES_DISABLED',
  // 'SLOW_OPERATION_LOGGING',
  // 'SSH_REMOTE',
  // 'STREAMLINED_OUTPUT',
  'TEAMMEM',
  // 'TEMPLATES',
  // 'TERMINAL_PANEL',
  // 'TOKEN_BUDGET', // 默认不开启
  // 'TORCH',
  'TRANSCRIPT_CLASSIFIER',
  // 'TREE_SITTER_BASH',
  // 'TREE_SITTER_BASH_SHADOW',
  // 'UDS_INBOX',
  'ULTRAPLAN',
  'ULTRATHINK',
  // 'UNATTENDED_RETRY',
  // 'UPLOAD_USER_SETTINGS',
  // 'VERIFICATION_AGENT', // 默认：未开启
  'VOICE_MODE',
  // 'WEB_BROWSER_TOOL',
  // 'WORKFLOW_SCRIPTS',
]

export function define(buildTraget: BuildTarget = 'external', _buildEnv: BuildEnv = 'production') {
  return {
    ...defines,
    // 'process.env.NODE_ENV': JSON.stringify(_buildEnv),
    'process.env.USER_TYPE': JSON.stringify(buildTraget),
  }
}

export const defineArgs = Object.entries(defines).flatMap(([k, v]) => ['-d', `${k}:${v}`])
export const featureArgs = features.flatMap((feature) => ['--feature', feature])

export const banner = `#!/usr/bin/env node
// (c) Anthropic PBC. All rights reserved. Use is subject to the Legal Agreements outlined here: https://code.claude.com/docs/en/legal-and-compliance.

// Version: ${version}

// Want to see the unminified source? We're hiring!
// https://job-boards.greenhouse.io/anthropic/jobs/4816199008`

export const external = ['@vscode/ripgrep']
