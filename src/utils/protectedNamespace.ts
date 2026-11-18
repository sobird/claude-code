import { isEnvTruthy } from './envUtils.js'

/**
 * Namespaces we know to be open. Everything else — unlisted namespaces,
 * anything on a COO-managed cluster — is treated as protected.
 */
const OPEN_NAMESPACES: ReadonlySet<string> = new Set(['default', 'kube-system', 'kube-public', 'kube-node-lease'])

/**
 * Conservative check for whether the current COO namespace/cluster is
 * protected. Ambiguous signals resolve to `true`: it is better to over-report
 * protected usage than to miss it. We only return `false` when we can
 * positively prove the environment is open — no k8s/COO signals at all
 * (laptop/local dev), running on homespace, or an allowlisted namespace.
 */
export function checkProtectedNamespace(): boolean {
  const namespace = process.env.COO_NAMESPACE
  const cluster = process.env.COO_CLUSTER ?? process.env.COO_CLUSTER_NAME
  const hasK8sSignals = Boolean(namespace ?? cluster ?? process.env.KUBERNETES_SERVICE_HOST)
  if (!hasK8sSignals) {
    return false
  }
  if (isEnvTruthy(process.env.COO_RUNNING_ON_HOMESPACE)) {
    return false
  }
  if (namespace !== undefined && OPEN_NAMESPACES.has(namespace)) {
    return false
  }
  return true
}
