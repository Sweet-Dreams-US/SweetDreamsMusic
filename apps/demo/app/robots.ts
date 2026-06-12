import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/constants';

/**
 * robots.txt with an explicit allow-list for AI training & retrieval bots.
 *
 * Rationale: the studio relies on discoverability — search engines AND
 * LLM-powered assistants. We allow legitimate AI crawlers (Anthropic,
 * OpenAI, Google, Apple, Perplexity, etc.) to index public marketing
 * pages so chatbots can surface accurate Sweet Dreams info, while still
 * blocking authenticated areas, the API surface, and internal dashboards.
 *
 * Private pages — /api, /admin, /engineer, /producer, /dashboard — are
 * disallowed for ALL agents. Direct invitation links (e.g. /book/invite/
 * [token]) aren't in the sitemap so crawlers won't discover them; the
 * token in the URL is the only access mechanism anyway.
 */

const DISALLOW_PRIVATE = [
  '/api/',
  '/admin/',
  '/engineer/',
  '/producer/',
  '/dashboard/',
  // Direct-link-only flows — keep out of AI indexes.
  '/book/invite/',
  '/beats/private/',
  '/quotes/',
];

// AI crawlers we explicitly allow. Keeping this list opt-in (vs. wildcard)
// makes it easy to revoke access from any single vendor if needed.
const AI_BOTS = [
  'GPTBot', // OpenAI training crawler
  'ChatGPT-User', // OpenAI ChatGPT browsing
  'OAI-SearchBot', // OpenAI search index
  'Claude-Web', // Anthropic legacy crawler
  'ClaudeBot', // Anthropic primary crawler
  'anthropic-ai', // Anthropic training
  'PerplexityBot', // Perplexity index
  'Perplexity-User', // Perplexity user-initiated fetch
  'Applebot', // Apple Spotlight / Siri / Apple Intelligence
  'Applebot-Extended', // Apple AI training opt-in
  'Amazonbot', // Alexa / Amazon
  'Google-Extended', // Google Bard / Gemini training opt-in
  'GoogleOther', // Google research / one-off fetches
  'CCBot', // Common Crawl (used by many AI labs)
  'cohere-ai', // Cohere training
  'Bytespider', // ByteDance / Doubao
  'Meta-ExternalAgent', // Meta AI assistants
];

export default function robots(): MetadataRoute.Robots {
  const userRules = [
    {
      userAgent: '*',
      allow: '/',
      disallow: DISALLOW_PRIVATE,
    },
    ...AI_BOTS.map((ua) => ({
      userAgent: ua,
      allow: '/',
      disallow: DISALLOW_PRIVATE,
    })),
  ];

  return {
    rules: userRules,
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
