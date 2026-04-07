export type ApiMetricEntry = { ttftMs: number; firstTokenTime: number; lastTokenTime: number; responseLengthBaseline: number; endResponseLength: number }

/**
 * Computes a human-readable text representation of TTFT (Time To First Token) metrics.
 *
 * @param metrics Array of API metric entries containing timing information
 * @returns Formatted string showing average TTFT or "N/A" if no metrics available
 */
export function computeTtftText(metrics: ApiMetricEntry[]): string {
  if (!metrics || metrics.length === 0) {
    return 'N/A'
  }

  // Calculate average TTFT in milliseconds
  const totalTtft = metrics.reduce((sum, metric) => sum + metric.ttftMs, 0)
  const averageTtftMs = Math.round(totalTtft / metrics.length)

  // Convert to seconds for display if it's reasonable, otherwise show ms
  if (averageTtftMs < 1000) {
    return `${averageTtftMs}ms`
  } else {
    const averageTtftSec = (averageTtftMs / 1000).toFixed(2)
    return `${averageTtftSec}s`
  }
}