/**
 * WebBrowser — control the embedded browser panel (codename "bagel").
 *
 * AppState carries the panel surface (`bagelActive`, `bagelUrl`,
 * `bagelPanelVisible`) and REPL.tsx renders `WebBrowserPanel` under
 * feature('WEB_BROWSER_TOOL'). This tool is the model-facing handle on that
 * state: open a page in the panel, report what is showing, or close it.
 *
 * Approximation: upstream drives a native Bun `WebView` for page interaction.
 * This tree has the panel and the state plumbing but no cross-platform WebView
 * host, so the tool manages the URL/visibility contract and the panel renders
 * the address and status. Anything that requires reading or clicking page
 * content should use WebFetch; this tool is only for putting a page in front
 * of the user.
 */

import { z } from 'zod/v4'

import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(['open', 'status', 'close']).describe('Operation to perform.'),
    url: z.string().optional().describe('Page to show (open only). Must be http(s).'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    action: z.string(),
    url: z.string().optional(),
    active: z.boolean(),
    panelVisible: z.boolean(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

export const WebBrowserTool = buildTool({
  name: 'WebBrowser',
  searchHint: 'show a web page in the embedded browser panel',
  maxResultSizeChars: 2_000,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    // Loaded only under feature('WEB_BROWSER_TOOL').
    return true
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  toAutoClassifierInput(input) {
    return `WebBrowser ${input.action}${input.url ? ` ${input.url}` : ''}`
  },
  renderToolUseMessage(input) {
    return `WebBrowser ${input.action}${input.url ? `: ${input.url}` : ''}`
  },
  async description() {
    return 'Open, inspect, or close the browser panel.'
  },
  async prompt() {
    return 'Control the browser panel that the user can see. Use "open" with an http(s) URL to show a page, "status" to check what is displayed, and "close" to dismiss it. The panel is for the user to look at — to read or extract page content, use WebFetch instead.'
  },
  async call(input, context) {
    switch (input.action) {
      case 'open': {
        if (!input.url) throw new Error('The open action requires a "url".')
        let parsedUrl: URL
        try {
          parsedUrl = new URL(input.url)
        } catch {
          throw new Error(`Not a valid URL: ${input.url}`)
        }
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          throw new Error('Only http(s) URLs can be opened in the browser panel.')
        }
        context.setAppState((prev) => ({
          ...prev,
          bagelActive: true,
          bagelUrl: parsedUrl.toString(),
          bagelPanelVisible: true,
        }))
        return {
          data: { action: input.action, url: parsedUrl.toString(), active: true, panelVisible: true },
        }
      }
      case 'status': {
        const state = context.getAppState()
        return {
          data: {
            action: input.action,
            url: state.bagelUrl,
            active: state.bagelActive ?? false,
            panelVisible: state.bagelPanelVisible ?? false,
          },
        }
      }
      case 'close': {
        context.setAppState((prev) => ({ ...prev, bagelActive: false, bagelPanelVisible: false }))
        return {
          data: { action: input.action, url: context.getAppState().bagelUrl, active: false, panelVisible: false },
        }
      }
      default:
        throw new Error(`Unknown browser action: ${String((input as { action?: unknown }).action)}`)
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    if (output.action === 'status') {
      const content = output.active
        ? `Browser panel showing ${output.url ?? '(no page)'}${output.panelVisible ? '' : ' (hidden)'}.`
        : 'Browser panel is not open.'
      return { type: 'tool_result', tool_use_id: toolUseID, content }
    }
    const content =
      output.action === 'open' ? `Opened ${output.url} in the browser panel.` : 'Closed the browser panel.'
    return { type: 'tool_result', tool_use_id: toolUseID, content }
  },
} satisfies ToolDef<InputSchema, Output>)
