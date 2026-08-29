/**
 * Weekly C3 token usage rollup from ~/.c3/state/usage.jsonl.
 *
 *   npx tsx scripts/usage-report.ts            # print the last 7 days
 *   npx tsx scripts/usage-report.ts --days 14
 *   npx tsx scripts/usage-report.ts --post     # also post to the usage Discord channel
 *
 * No model call: this is arithmetic over the ledger, so it runs from system
 * cron for free (Fridays 09:20 ET on chipdev), not as a C3 trigger.
 */
import { formatSummary, readUsage, summarizeUsage } from '../src/lib/usage/ledger'
import { USAGE_CHANNEL_ID, usageLedgerPath } from '../src/lib/usage'
import { postDiscordChunked } from '../src/lib/webhooks/discord-mirror'

async function main() {
  const args = process.argv.slice(2)
  const days = Number(args[args.indexOf('--days') + 1]) || 7
  const post = args.includes('--post')
  const records = readUsage(usageLedgerPath())
  const now = new Date()
  const text = formatSummary(summarizeUsage(records, now, days), days, now)
  console.log(text)
  if (!post) return
  const token = process.env.DISCORD_BOT_TOKEN
  if (!token) throw new Error('DISCORD_BOT_TOKEN is unset')
  const id = await postDiscordChunked(token, USAGE_CHANNEL_ID, text)
  if (!id) throw new Error('Discord refused the post')
  console.log(`posted to ${USAGE_CHANNEL_ID} as ${id}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
