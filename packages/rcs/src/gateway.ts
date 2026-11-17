/**
 * Gateway Hono app factory.
 *
 * Mounts the same route table as the old monolithic server (minus static serving — Next.js
 * serves the UI) and injects the repository bundle into every request context. Kept free
 * of Bun-only server APIs so tests can drive it through `app.request` and Next code can
 * import the types.
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'

import type { AppEnv } from './auth/context.js'
import { webCorsOptions } from './auth/cors.js'
import type { GatewayConfig } from './config.js'
import type { Repositories } from './db/repositories/types.js'
import acpRoutes from './routes/acp/index.js'
import v1Environments from './routes/v1/environments.js'
import v1EnvironmentsWork from './routes/v1/environments.work.js'
import v1SessionIngress from './routes/v1/session-ingress.js'
import v1Sessions from './routes/v1/sessions.js'
import v2CodeSessions from './routes/v2/code-sessions.js'
import v2WorkerEventsStream from './routes/v2/worker-events-stream.js'
import v2WorkerEvents from './routes/v2/worker-events.js'
import v2Worker from './routes/v2/worker.js'
import webAccount from './routes/web/account.js'
import webAdmin from './routes/web/admin.js'
import webAttachments from './routes/web/attachments.js'
import webAuth from './routes/web/auth.js'
import webControl from './routes/web/control.js'
import webEnvironments from './routes/web/environments.js'
import webSessions from './routes/web/sessions.js'

export interface CreateGatewayOptions {
  config: GatewayConfig
  repos: Repositories
}

export function createGateway({ config, repos }: CreateGatewayOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  // Repositories are shared across requests (they wrap a connection pool), so inject the
  // single bundle once up front; every auth middleware and route reads `c.get('repos')`.
  app.use('*', async (c, next) => {
    c.set('repos', repos)
    await next()
  })

  // Normalize double slashes (e.g. `//v1/environments/bridge` → `/v1/environments/bridge`)
  // before routing; some proxies collapse paths inconsistently and the CLI has historically
  // built URLs with a stray leading slash.
  app.use('*', async (c, next) => {
    const path = new URL(c.req.url).pathname
    if (!path.includes('//')) return next()
    const url = new URL(c.req.url)
    url.pathname = path.replace(/\/+/g, '/')
    return app.fetch(new Request(url.toString(), c.req.raw))
  })

  app.use('/web/*', cors(webCorsOptions(config.webCorsOrigins)))

  app.get('/health', (c) => c.json({ status: 'ok', version: config.version }))

  // v1 Environments (list/create + work polling share the `/v1/environments` prefix).
  app.route('/v1/environments', v1Environments)
  app.route('/v1/environments', v1EnvironmentsWork)

  app.route('/v1/sessions', v1Sessions)

  // Ingress is mounted at both /v1 and /v2 so the CLI's buildSdkUrl works with or without
  // an Envoy proxy rewriting /v1 → /v2.
  app.route('/v1/session_ingress', v1SessionIngress)
  app.route('/v2/session_ingress', v1SessionIngress)

  app.route('/v1/code/sessions', v2CodeSessions)
  app.route('/v1/code/sessions', v2Worker)
  app.route('/v1/code/sessions', v2WorkerEventsStream)
  app.route('/v1/code/sessions', v2WorkerEvents)

  app.route('/web', webAuth)
  app.route('/web', webSessions)
  app.route('/web', webControl)
  app.route('/web', webAttachments)
  app.route('/web', webEnvironments)
  app.route('/web', webAccount)
  app.route('/web', webAdmin)

  app.route('/acp', acpRoutes)

  return app
}
