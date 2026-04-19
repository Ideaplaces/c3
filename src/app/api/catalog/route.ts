/**
 * C3 product catalog endpoint.
 *
 * Consumed by ideaplaces.com at build time to render the product card and
 * detail page. Schema matches `src/lib/catalog/schema.ts` (copy of the
 * ideaplaces-website source of truth).
 */

import { NextResponse } from 'next/server'
import type { ProductCatalog } from '@/lib/catalog/schema'

export const dynamic = 'force-static'
export const revalidate = 300

export async function GET(): Promise<NextResponse> {
  const catalog: ProductCatalog = {
    $schema: 1,
    name: 'C3',
    slug: 'c3',
    status: 'live',
    url: 'https://c3.ideaplaces.com',
    category: 'Developer Tools',
    tagline:
      'An open-source AI agent that runs on your dev machine and does your work while you sleep.',
    description:
      'C3 turns your always-on dev machine into an autonomous agent platform. Slack alerts and Discord messages trigger headless Claude Code sessions that investigate errors, trace code, create PRs, and report back. Watch the agent work live from your browser, or continue the conversation from your phone. Open source (Apache 2.0), bring your own machine, your own tunnel, your own channels.',
    features: [
      {
        title: 'Runs on YOUR machine',
        body: 'Not a sandboxed cloud agent. It has your repos, your secrets, your CLI tools, your database access. Same permissions as you.',
      },
      {
        title: 'Channel-triggered sessions',
        body: 'Slack alerts and Discord messages start headless Claude Code sessions. The agent investigates and reports back in the same thread.',
      },
      {
        title: 'Watch it work, resume anytime',
        body: 'Every session is streamed to a web UI and fully resumable. Agent ran at 3am? Open it on your phone at 9am and keep going.',
      },
      {
        title: 'Encode your expertise as prompts',
        body: 'Prompt templates turn your internal playbooks into agent instructions. A 200-line prompt tells the agent exactly how you investigate an outage.',
      },
      {
        title: 'Cron-driven automations',
        body: 'Schedule agents on a cron. Weekly cost reports, daily PR babysitting, overnight cleanup — runs on your machine, reports to your channels.',
      },
      {
        title: 'Open source, self-hosted',
        body: 'Apache 2.0. Bring your own machine, your own tunnel (Cloudflare Tunnel recommended), your own channels. No vendor lock-in.',
      },
    ],
    pricing: {
      currency: 'USD',
      tiers: [
        {
          name: 'Self-hosted',
          price: 0,
          period: null,
          features: [
            'Apache 2.0 license',
            'Runs on your own machine',
            'Discord, Slack, and cron triggers',
            'Bring your own Claude API key or Claude Max',
            'Full source on GitHub',
          ],
          highlighted: true,
          cta: {
            label: 'Star on GitHub',
            href: 'https://github.com/Ideaplaces/c3',
          },
        },
      ],
    },
    theme: {
      primary: '#7c3aed',
      accent: '#22d3ee',
    },
    cta: {
      label: 'Visit c3.ideaplaces.com',
      href: 'https://c3.ideaplaces.com',
    },
    links: {
      github: 'https://github.com/Ideaplaces/c3',
      docs: 'https://github.com/Ideaplaces/c3#readme',
      changelog: 'https://github.com/Ideaplaces/c3/releases',
    },
  }

  return NextResponse.json(catalog, {
    headers: {
      'Cache-Control': 'public, max-age=300, s-maxage=300',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    },
  })
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '86400',
    },
  })
}
