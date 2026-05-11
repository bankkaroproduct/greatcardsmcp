import { z } from 'zod';
import { apiClient } from '../api/client.js';

export const apiDiagnosticsSchema = z.object({
  scope: z.enum(['quick','full']).optional().default('quick')
    .describe('quick runs core API checks with small payloads. full adds category listing and eligibility checks.'),
  timeout_ms: z.number().optional().default(8000)
    .describe('Per-check timeout in milliseconds. Defaults to 8000.'),
  include_samples: z.boolean().optional().default(false)
    .describe('Include small sanitized response samples for debugging schema drift. Samples never include credentials.'),
});

type DiagnosticStatus = 'pass' | 'fail' | 'timeout';

interface DiagnosticCheck {
  name: string;
  status: DiagnosticStatus;
  elapsed_ms: number;
  summary: string;
  sample?: unknown;
  error?: string;
}

async function withTimeout<T>(label: string, timeoutMs: number, fn: () => Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function runCheck(
  name: string,
  timeoutMs: number,
  includeSamples: boolean,
  fn: () => Promise<{ summary: string; sample?: unknown }>
): Promise<DiagnosticCheck> {
  const started = Date.now();
  try {
    const result = await withTimeout(name, timeoutMs, fn);
    return {
      name,
      status: 'pass',
      elapsed_ms: Date.now() - started,
      summary: result.summary,
      ...(includeSamples && result.sample !== undefined && { sample: result.sample }),
    };
  } catch (err: any) {
    const message = err?.message || String(err);
    return {
      name,
      status: message.includes('timed out') ? 'timeout' : 'fail',
      elapsed_ms: Date.now() - started,
      summary: message.includes('timed out') ? 'Check exceeded timeout' : 'Check failed',
      error: message.slice(0, 500),
    };
  }
}

function pickCards(response: any): any[] {
  return Array.isArray(response?.data?.cards)
    ? response.data.cards
    : (Array.isArray(response?.data) ? response.data : []);
}

function pickSavings(response: any): any[] {
  return Array.isArray(response?.data?.savings)
    ? response.data.savings
    : (Array.isArray(response?.data) ? response.data : []);
}

function cardSample(card: any) {
  return {
    name: card?.card_name || card?.name || null,
    bank: card?.banks?.[0]?.name || card?.bank_name || null,
    alias: card?.seo_card_alias || card?.card_alias || null,
  };
}

export async function runApiDiagnostics(input: z.infer<typeof apiDiagnosticsSchema>) {
  const { scope, timeout_ms, include_samples } = input;
  const checks: DiagnosticCheck[] = [];

  checks.push(await runCheck('card_listing_all', timeout_ms, include_samples, async () => {
    const response = await apiClient.getCardListing({});
    const cards = pickCards(response);
    return {
      summary: `Returned ${cards.length} cards`,
      sample: cards.slice(0, 3).map(cardSample),
    };
  }));

  checks.push(await runCheck('card_details_sbi_cashback', timeout_ms, include_samples, async () => {
    const response = await apiClient.getCardDetails('sbi-cashback-credit-card');
    const raw = response?.data;
    const card = Array.isArray(raw) ? raw[0] : raw;
    return {
      summary: card ? `Resolved ${card.card_name || card.name || 'card details'}` : 'No card returned',
      sample: cardSample(card),
    };
  }));

  checks.push(await runCheck('recommendation_calculate', timeout_ms, include_samples, async () => {
    const response = await apiClient.calculateCardGenius({
      amazon_spends: 5000,
      online_food_ordering: 2000,
      fuel: 3000,
    });
    const savings = pickSavings(response);
    return {
      summary: `Returned ${savings.length} savings rows`,
      sample: savings.slice(0, 3).map((s: any) => ({
        card_name: s.card_name,
        alias: s.seo_card_alias || s.card_alias,
        yearly_savings: s.total_savings_yearly ?? null,
      })),
    };
  }));

  if (scope === 'full') {
    checks.push(await runCheck('card_listing_shopping_category', timeout_ms, include_samples, async () => {
      const response = await apiClient.getCardListing({ slug: 'best-shopping-credit-card' });
      const cards = pickCards(response);
      return {
        summary: `Returned ${cards.length} shopping cards`,
        sample: cards.slice(0, 3).map(cardSample),
      };
    }));

    checks.push(await runCheck('eligibility_bangalore_salaried', timeout_ms, include_samples, async () => {
      const response = await apiClient.checkEligibility({
        pincode: '560001',
        inhandIncome: '1200000',
        empStatus: 'salaried',
      });
      const cards = pickCards(response);
      return {
        summary: `Returned ${cards.length} eligible cards`,
        sample: cards.slice(0, 3).map(cardSample),
      };
    }));
  }

  const failed = checks.filter(c => c.status !== 'pass');
  const slowest = [...checks].sort((a, b) => b.elapsed_ms - a.elapsed_ms)[0] || null;

  return {
    status: failed.length ? 'degraded' : 'ok',
    generated_at: new Date().toISOString(),
    scope,
    api_base: process.env.PARTNER_BASE_URL || 'https://platform.bankkaro.com/partner',
    timeout_ms,
    summary: {
      total_checks: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
      slowest_check: slowest ? { name: slowest.name, elapsed_ms: slowest.elapsed_ms } : null,
    },
    checks,
    next_debug_step: failed.length
      ? 'Inspect failed check errors and compare response shape with the API contract.'
      : scope === 'quick'
        ? 'Run again with scope="full" to include category listing and eligibility checks.'
        : 'All diagnostics passed.',
  };
}
