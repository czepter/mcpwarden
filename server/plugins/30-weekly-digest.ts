import { getMailer } from '../mail'
import { runWeeklyDigest } from '../mail/digest'
import { getRuntime } from '../gateway/runtime'
import { getConfig } from '../utils/config'

// Weekly summary mails (opt-in). Hourly tick; the per-user marker (user_preference.weekly_last_sent_at) makes it idempotent,
// also across several instances. Does nothing without a configured mailer.
const TICK_MS = 3_600_000

export default defineNitroPlugin((nitroApp) => {
  const mailer = getMailer()
  if (!mailer.enabled) return
  const run = () => {
    getRuntime()
      .then(rt => runWeeklyDigest({ repo: rt.repo, mailer, baseUrl: getConfig().baseUrl }))
      .catch(() => console.error('[mcpwarden] weekly digest run failed'))
  }
  const timer = setInterval(run, TICK_MS)
  timer.unref()
  setTimeout(run, 5 * 60_000).unref()
  nitroApp.hooks.hook('close', () => clearInterval(timer))
})
