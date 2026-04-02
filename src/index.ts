#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { URL } from 'url';
import { randomUUID } from 'crypto';

import { clientAuth } from './auth/clientAuth.js';
import { recommendCardsSchema, recommendCards } from './tools/recommend.js';
import { cardDetailsSchema, getCardDetails } from './tools/cardDetails.js';
import { listCardsSchema, listCards } from './tools/listCards.js';
import { compareCardsSchema, compareCards } from './tools/compare.js';
import { checkEligibilitySchema, checkEligibility } from './tools/eligibility.js';
import { advisorContextSchema, getAdvisorContext } from './tools/advisorContext.js';
import { cache } from './cache/cache.js';
import { CARD_ADVISOR_PROMPT } from './prompts/cardAdvisor.js';

// Load .env if present
import { readFileSync } from 'fs';
import { resolve } from 'path';
try {
  const envPath = resolve(process.cwd(), '.env');
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
} catch {
  // No .env file — rely on environment variables
}

function createMcpServer() {
  const server = new McpServer({
    name: 'great-cards',
    version: '1.3.0',
    description: 'Great.Cards — AI-powered credit card recommendations for the Indian market. Compare 100+ cards, get personalized recommendations based on spending patterns, check eligibility, and find the best card for any use case.',
  });

  // ── Tool: recommend_cards ──────────────────────────────────────────────
  server.tool(
    'recommend_cards',
    `PERSONALIZED credit card recommendations based on the user's actual spending pattern.
Analyzes 100+ Indian credit cards and ranks by NET ANNUAL SAVINGS (rewards earned + lounge value + milestone benefits - joining fee - annual fee).

PRE-REQUISITE: If you haven't called get_advisor_context yet this session, call it FIRST to load brand mappings and conversation flow. Without it, you'll mismap brands to spending keys.

WHEN TO USE: User provides specific spending amounts OR mentions brands/categories they spend on.
WHEN NOT TO USE: User just wants to browse cards without spending context -> use list_cards instead.

SPENDING KEY MAPPING (CRITICAL — map user mentions to correct keys):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• amazon_spends → Amazon.in ONLY
• flipkart_spends → Flipkart ONLY
• other_online_spends → ALL other e-commerce: Myntra, Meesho, Nykaa, Ajio, Tata CLiQ, Croma online, BookMyShow, Ola, Uber rides, PharmEasy, NetMeds, 1mg, Lenskart, Pepperfry, Urban Company, CRED bills, subscription boxes
• other_offline_spends → Physical store purchases: malls, retail, electronics stores, local markets, salons, gyms, medical stores, any POS/tap/swipe
• grocery_spends_online → Online grocery ONLY: BigBasket, Blinkit, Zepto, Swiggy Instamart, JioMart, Amazon Fresh, Flipkart Grocery, DMart Ready
• online_food_ordering → Food DELIVERY: Swiggy (food, not Instamart), Zomato, EatSure, Dominos/Pizza Hut online orders
• fuel → Petrol pumps: HP, Indian Oil, BPCL, Shell, Nayara, Reliance
• dining_or_going_out → IN-PERSON restaurants, cafes (Starbucks, CCD, Third Wave), bars, pubs, food courts
• flights_annual → ANNUAL flight spend (all airlines, all booking platforms) — convert monthly×12
• hotels_annual → ANNUAL hotel/stay spend (hotels, Airbnb, OYO) — convert monthly×12
• domestic_lounge_usage_quarterly → Domestic lounge visits PER QUARTER — "fly 4x/year" = 1/quarter
• international_lounge_usage_quarterly → International lounge visits PER QUARTER
• mobile_phone_bills → Jio, Airtel, Vi, BSNL monthly bills
• electricity_bills → Monthly electricity bill
• water_bills → Monthly water bill
• insurance_health_annual → ANNUAL health insurance premium — convert monthly×12
• insurance_car_or_bike_annual → ANNUAL vehicle insurance — convert monthly×12
• rent → Monthly rent (via CRED RentPay, NoBroker, etc.)
• school_fees → Monthly education fees (school, coaching, college)
• offline_grocery → Monthly physical grocery store spend: DMart, Reliance Smart/Fresh, Nature's Basket, 24Seven, kirana stores, liquor stores
• life_insurance → ANNUAL life insurance premium: LIC, HDFC Life, SBI Life, ICICI Prudential, Max Life, Tata AIA, term plans, ULIPs
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

VAGUE QUERY HANDLING:
• "best card for shopping" → ask what they buy and where, OR estimate: amazon_spends=5000, flipkart_spends=3000, other_online_spends=5000
• "premium card" → suggest high spenders profile: flights_annual=100000, hotels_annual=50000, dining=10000, domestic_lounge_usage_quarterly=3
• "I spend a lot on food" → clarify: delivery (online_food_ordering) vs dining out (dining_or_going_out) vs groceries (grocery_spends_online)
• "cashback card" → focus on the user's biggest spending categories for maximum net savings
• "travel card" → ask about flights, hotels, lounges; these drive the biggest travel card differentiation

IMPORTANT UNITS:
• Most fields are MONTHLY amounts in ₹ (including offline_grocery)
• flights_annual, hotels_annual, insurance_health_annual, insurance_car_or_bike_annual, life_insurance are ANNUAL — multiply monthly by 12
• lounge fields are PER QUARTER — divide annual visits by 4
• All fee outputs include 18% GST`,
    recommendCardsSchema.shape,
    async (input) => {
      try {
        const result = await recommendCards(recommendCardsSchema.parse(input));
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ── Tool: get_card_details ─────────────────────────────────────────────
  server.tool(
    'get_card_details',
    `Get FULL details of a specific credit card by its alias/slug.
Returns: fees (with 18% GST), all benefits, rewards structure, eligibility, ratings.
NOTE: If you haven't called get_advisor_context yet, do so first — it has the full card alias reference.

WHEN TO USE: After recommend_cards or list_cards, when the user wants to deep-dive into a specific card.
ALSO USE WHEN: User names a specific card like "tell me about HDFC Regalia" — construct the alias as lowercase-hyphenated bank-card-name (e.g. "hdfc-regalia-gold-credit-card").

COMMON CARD ALIAS PATTERNS (aliases are NOT predictable — use list_cards if unsure):
• HDFC: hdfc-regalia-gold, hdfc-millenia-credit-card, hdfc-swiggy-credit-card, hdfc-infinia-credit-card, hdfc-diners-club-black, hdfc-diners-club-black-metal-credit-card, hdfc-diners-privilege-credit-card, hdfc-freedom-credit-card, hdfc-indian-oil-credit-card, hdfc-pixel-play-credit-card, hdfc-rupay-credit-card, hdfc-indigo-credit-card, HDFC-Moneyback-Credit-Card, hdfc-moneyback-plus-credit-card, hdfc-marriott-bonvoy-credit-card, hdfc-tata-neu-plus-credit-card, hdfc-irctc-credit-card, shoppers-stop-black-hdfc-credit-card, paytm-hdfc-bank-select-credit-card, hdfc-bharat-credit-card, hdfc-superia-airline-credit-card, hdfc-biz-grow-credit-card, hdfc-biz-first-credit-card
• Axis: axis-bank-magnus-credit-card, axis-flipkart-credit-card, axis-privilege-amex-credit-card, axis-atlas-credit-card, axis-neo-credit-card, axis-bank-myzone-credit-card, axis-horizon-credit-card, axis-cashback-credit-card, axis-indian-oil-rupay-credit-card, axis-select-credit-card, axis-airtel-credit-card, axis-aura-credit-card, axis-rewards-credit-card, axis-samsung-infinite-credit-card, axis-bank-privilege-credit-card, axis-shopper-stop-credit-card
• SBI: sbi-cashback-credit-card, sbi-elite-card, sbi-aurum-credit-card, sbi-simply-click-credit-card, sbi-bpcl-octane-credit-card, flipkart-sbi-credit-card, tata-neu-infinity-sbi-credit-card, irctc-sbi-platinum-card, sbi-simply-save-credit-card, sbi-prime-credit-card, sbi-card-pulse-credit-card
• ICICI: icici-amazon-pay-credit-card, icici-sapphiro-credit-card, icici-hpcl-coral-credit-card, icici-rubyx-credit-card, icici-platinum-chip-credit-card, makemytrip-icici-signature, icici-hpcl-super-saver-credit-card, times-black-credit-card
• IDFC: idfc-first-millennia-credit-card, idfc-first-select-credit-card, idfc-first-classic-credit-card, idfc-first-wow-credit-card, idfc-wealth-credit-card, idfc-first-private-credit-card, idfc-swyp-credit-card, idfc-ashva-credit-card, idfc-mayura-credit-card
• Others: scapia-credit-card, au-altura-credit-card, au-altura-plus-credit-card, au-nomo-credit-card, au-zenith-credit-card, zagg-rupay-credit-card, hsbc-travel-one, hsbc-live-plus-credit-card, standard-charted-ultimate, amex-platinum-travel-credit-card, american-express-platinum-card, amex-gold-credit-card, kotak-zen-signature-credit-card, indusind-legend-credit-card, rbl-world-safari-credit-card, yes-bank-ace-credit-card, jupiter-edge-credit-card
⚠️ ALIAS QUIRKS: Some aliases have mixed case (HDFC-Moneyback-Credit-Card), typos (standard-charted-ultimate), or missing suffixes (hdfc-diners-club-black has no -credit-card). ALWAYS use list_cards to verify.

IMPORTANT: Aliases are inconsistent (some have -credit-card suffix, some don't, some use bank name, some don't). ALWAYS use list_cards first if you're not 100% sure of the alias.`,
    cardDetailsSchema.shape,
    async (input) => {
      try {
        const result = await getCardDetails(cardDetailsSchema.parse(input));
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ── Tool: list_cards ───────────────────────────────────────────────────
  server.tool(
    'list_cards',
    `Browse and filter credit cards without needing spending data.
NOTE: If you haven't called get_advisor_context yet, do so first — it has category mappings and feature-to-filter rules.

WHEN TO USE: User wants to explore/discover cards, asks about a category, or hasn't shared spending details.
WHEN NOT TO USE: User has given spending amounts -> use recommend_cards for personalized ranking.

CATEGORY MAPPING (map user intent to category slug):
• "premium" / "luxury" / "lounge access" / "travel" / "airport" → best-travel-credit-card
• "shopping" / "cashback" / "online shopping" / "rewards" → best-shopping-credit-card
• "fuel" / "petrol" / "diesel" / "fuel surcharge" → best-fuel-credit-card
• "dining" / "restaurant" / "food" (in-person) / "Starbucks" → best-dining-credit-card
• "grocery" / "BigBasket" / "Blinkit" / "Zepto" → best-cards-grocery-shopping
• "Swiggy" / "Zomato" / "food delivery" → online-food-ordering
• "utility" / "bills" / "recharge" / "electricity" → best-utility-credit-card
• "all cards" / no specific category → leave empty

USER INTENT → FILTER MAPPING:
• "free card" / "no fee" / "LTF" / "lifetime free" / "no annual charge" → free_cards="true"
• "Amex" / "American Express" → card_networks=["American Express"]
• "works internationally" → card_networks=["Visa"] or ["Mastercard"]
• "RuPay" / "UPI linked" → card_networks=["RuPay"]
• "budget card" / "entry level" → annual_fees="0-500" or free_cards="true"
• "super premium" / "invite only" → annual_fees="10000+"
• "HDFC card" / "Axis card" etc → use bank_ids if known, otherwise suggest using recommend_cards

COMMON FOLLOW-UP: After listing, user often picks a card → use get_card_details for the deep dive.`,
    listCardsSchema.shape,
    async (input) => {
      try {
        const result = await listCards(listCardsSchema.parse(input));
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ── Tool: compare_cards ────────────────────────────────────────────────
  server.tool(
    'compare_cards',
    `Compare 2-3 credit cards side by side.
NOTE: If you haven't called get_advisor_context yet, do so first — it has correct card alias patterns.

WHEN TO USE: User is deciding between specific cards, says "X vs Y", or asks "which is better".
REQUIRES: card_aliases from previous recommend_cards or list_cards results.

Present the comparison highlighting the differences that matter for the user's use case.
Common comparisons: HDFC Regalia vs Axis Magnus, SBI Cashback vs ICICI Amazon Pay, HDFC Swiggy vs Axis Flipkart.`,
    compareCardsSchema.shape,
    async (input) => {
      try {
        const result = await compareCards(compareCardsSchema.parse(input));
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ── Tool: check_eligibility ────────────────────────────────────────────
  server.tool(
    'check_eligibility',
    `Check which cards a user can actually APPLY for based on pincode, income, and employment.
NOTE: If you haven't called get_advisor_context yet, do so first — it has income conversion rules and employment mapping.

WHEN TO USE: User asks "can I get this card?", "which cards am I eligible for?", "I earn X, what can I get?", or before recommending cards to someone with a stated income.

INCOME CONVERSION (users state income in many ways):
• "50k/month" or "50k per month" → annual_income = "600000"
• "10 LPA" or "10 lakhs per annum" → annual_income = "1000000"
• "1.5L/month" → annual_income = "1800000"
• "8 lakhs" (ambiguous) → likely annual, so "800000"

EMPLOYMENT MAPPING:
• Salaried: full-time, part-time, contract workers, government employees
• Self-employed: freelancers, business owners, consultants, doctors/lawyers/CAs with own practice, gig workers, YouTubers, influencers

IDEAL FLOW: check_eligibility first → then recommend_cards with spending to find the BEST eligible card.`,
    checkEligibilitySchema.shape,
    async (input) => {
      try {
        const result = await checkEligibility(checkEligibilitySchema.parse(input));
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ── Tool: get_advisor_context ────────────────────────────────────────────
  server.tool(
    'get_advisor_context',
    `CALL THIS FIRST before starting any credit card advisory conversation.

Returns the complete CardGenius advisory playbook: conversation flow logic, 700+ brand-to-spending-key mappings, correlated category pairs, unit conversion rules, persona handling, vague query responses, and Indian credit card domain knowledge.

WITHOUT this context, you will:
- Mismap brands to wrong spending keys (e.g. putting Swiggy Instamart under food delivery instead of grocery)
- Miss correlated categories (e.g. asking about flights but forgetting hotels and lounges)
- Get units wrong (e.g. treating annual insurance as monthly)
- Not know how to handle vague queries, personas, or feature requests

USAGE:
- Call with topic="full" at the START of every conversation (~13K tokens, covers everything)
- Or call with a specific topic for targeted context: "brand_mappings", "correlated_pairs", "unit_conversion", "personas", "domain_knowledge", etc.
- You only need to call this ONCE per session — the context applies to all subsequent interactions.

FOR CHATBOT DEVELOPERS: Call this at session init and inject the "context" field into your system prompt.`,
    advisorContextSchema.shape,
    async (input) => {
      try {
        const result = getAdvisorContext(advisorContextSchema.parse(input));
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ── Prompt: Card Recommendation Advisor ─────────────────────────────────
  server.prompt(
    'card-advisor',
    'System instructions for an AI credit card recommendation advisor. Load this prompt to guide conversation flow, spending extraction, and card recommendations.',
    () => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: CARD_ADVISOR_PROMPT,
        },
      }],
    })
  );

  // ── Resource: cache stats ──────────────────────────────────────────────
  server.resource(
    'cache-stats',
    'greatcards://cache/stats',
    async () => ({
      contents: [{
        uri: 'greatcards://cache/stats',
        mimeType: 'application/json',
        text: JSON.stringify(cache.stats(), null, 2),
      }],
    })
  );

  return server;
}

// ── Start ──────────────────────────────────────────────────────────────
async function main() {
  const mode = (process.env.MCP_TRANSPORT || 'stdio').toLowerCase();
  const server = createMcpServer();

  if (mode === 'sse') {
    const port = Number(process.env.PORT) || 3100;

    // Track sessions for both transport types
    const transports: Record<string, StreamableHTTPServerTransport | SSEServerTransport> = {};

    function extractApiKey(req: IncomingMessage): string | null {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        return authHeader.slice(7).trim();
      }
      try {
        const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
        return url.searchParams.get('api_key');
      } catch {
        return null;
      }
    }

    function sendJSON(res: ServerResponse, status: number, body: object) {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    }

    function getRequestBody(req: IncomingMessage): Promise<any> {
      return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString();
            resolve(body ? JSON.parse(body) : undefined);
          } catch (e) {
            reject(e);
          }
        });
        req.on('error', reject);
      });
    }

    const httpServer = createServer(async (req, res) => {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
      res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // Health check (no auth required)
      if (req.url?.startsWith('/health')) {
        sendJSON(res, 200, {
          status: 'ok',
          server: 'great-cards',
          version: '1.3.0',
          auth_enabled: clientAuth.isEnabled,
          active_sessions: Object.keys(transports).length,
          cache: cache.stats(),
        });
        return;
      }

      const urlPath = req.url?.split('?')[0];

      // ══════════════════════════════════════════════════════════════
      // STREAMABLE HTTP TRANSPORT (Protocol 2025-03-26)
      // Claude custom connectors use this — single /mcp endpoint
      // ══════════════════════════════════════════════════════════════

      if (urlPath === '/mcp') {
        // Auth check (skip for non-authenticated setups)
        const apiKey = extractApiKey(req);
        const client = clientAuth.authenticate(apiKey);
        if (!client) {
          sendJSON(res, 401, { error: 'Unauthorized' });
          return;
        }
        if (!clientAuth.checkRateLimit(apiKey || 'default', client.rateLimit)) {
          sendJSON(res, 429, { error: 'Rate limited' });
          return;
        }
        process.env.PARTNER_API_KEY = client.partnerApiKey;

        console.error(`[great-cards] /mcp ${req.method} session=${req.headers['mcp-session-id'] || 'none'}`);

        if (req.method === 'POST') {
          const body = await getRequestBody(req);
          console.error(`[great-cards] /mcp POST body method=${body?.method} id=${body?.id}`);

          const sessionId = req.headers['mcp-session-id'] as string | undefined;

          // Existing session
          if (sessionId && transports[sessionId]) {
            const transport = transports[sessionId];
            if (transport instanceof StreamableHTTPServerTransport) {
              await transport.handleRequest(req, res, body);
              return;
            }
          }

          // New session — any POST without session ID starts a new session
          // (isInitializeRequest check is too strict for some clients)
          if (!sessionId) {
            console.error(`[great-cards] Creating new streamable session. isInit=${isInitializeRequest(body)}`);
            const transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => randomUUID(),
            });

            const sessionServer = createMcpServer();
            await sessionServer.connect(transport);

            transport.onclose = () => {
              const sid = Object.entries(transports).find(([, t]) => t === transport)?.[0];
              if (sid) {
                delete transports[sid];
                console.error(`[great-cards] Streamable session ended: ${client.name}`);
              }
            };

            await transport.handleRequest(req, res, body);

            const respSessionId = res.getHeader('mcp-session-id') as string;
            if (respSessionId) {
              transports[respSessionId] = transport;
              console.error(`[great-cards] Streamable session started: ${client.name} (${respSessionId.slice(0, 8)}...)`);
            }
            return;
          }

          sendJSON(res, 400, {
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Bad Request: Invalid session ID' },
            id: null,
          });
          return;
        }

        if (req.method === 'GET') {
          const sessionId = req.headers['mcp-session-id'] as string | undefined;
          if (sessionId && transports[sessionId] instanceof StreamableHTTPServerTransport) {
            const transport = transports[sessionId] as StreamableHTTPServerTransport;
            await transport.handleRequest(req, res);
            return;
          }
          // GET without session — return server info (not an error)
          sendJSON(res, 200, {
            name: 'great-cards',
            version: '1.3.0',
            description: 'Great.Cards MCP Server — POST to this endpoint to initialize a session',
          });
          return;
        }

        if (req.method === 'DELETE') {
          const sessionId = req.headers['mcp-session-id'] as string | undefined;
          if (sessionId && transports[sessionId] instanceof StreamableHTTPServerTransport) {
            const transport = transports[sessionId] as StreamableHTTPServerTransport;
            await transport.handleRequest(req, res);
            delete transports[sessionId];
            return;
          }
          res.writeHead(204);
          res.end();
          return;
        }

        res.writeHead(405);
        res.end('Method not allowed');
        return;
      }

      // ══════════════════════════════════════════════════════════════
      // LEGACY SSE TRANSPORT (Protocol 2024-11-05)
      // For older MCP clients that use /sse + /messages
      // ══════════════════════════════════════════════════════════════

      // Auth check for legacy endpoints
      const apiKey = extractApiKey(req);
      const client = clientAuth.authenticate(apiKey);
      if (!client) {
        sendJSON(res, 401, { error: 'Unauthorized' });
        return;
      }
      if (!clientAuth.checkRateLimit(apiKey || 'default', client.rateLimit)) {
        sendJSON(res, 429, { error: 'Rate limited' });
        return;
      }
      process.env.PARTNER_API_KEY = client.partnerApiKey;

      if (urlPath === '/sse' && req.method === 'GET') {
        const sessionServer = createMcpServer();
        const sseTransport = new SSEServerTransport('/messages', res);

        transports[sseTransport.sessionId] = sseTransport;
        console.error(`[great-cards] SSE session started: ${client.name} (${sseTransport.sessionId.slice(0, 8)}...)`);

        res.on('close', () => {
          delete transports[sseTransport.sessionId];
          console.error(`[great-cards] SSE session ended: ${client.name}`);
        });

        await sessionServer.connect(sseTransport);
        return;
      }

      if (urlPath === '/messages' && req.method === 'POST') {
        try {
          const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
          const sessionId = url.searchParams.get('sessionId');
          if (sessionId && transports[sessionId] instanceof SSEServerTransport) {
            const transport = transports[sessionId] as SSEServerTransport;
            await transport.handlePostMessage(req, res);
            return;
          }
        } catch { /* */ }
        sendJSON(res, 400, { error: 'No active SSE session found' });
        return;
      }

      // Root / — landing page
      if (urlPath === '/' || urlPath === '') {
        sendJSON(res, 200, {
          name: 'Great.Cards MCP Server',
          version: '1.3.0',
          description: 'AI-powered credit card recommendations for the Indian market.',
          endpoints: {
            '/mcp': 'Streamable HTTP transport (POST to initialize, GET for SSE stream, DELETE to close) — for Claude custom connectors',
            '/sse': 'Legacy SSE transport (GET) — for older MCP clients',
            '/messages': 'Legacy SSE message endpoint (POST)',
            '/health': 'Health check (GET)',
          },
          tools: ['get_advisor_context', 'recommend_cards', 'get_card_details', 'list_cards', 'compare_cards', 'check_eligibility'],
          spending_keys: 21,
          brands_mapped: '700+',
        });
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    httpServer.listen(port, () => {
      console.error(`[great-cards] MCP server v1.3.0 running at http://0.0.0.0:${port}`);
      console.error(`[great-cards] Auth: ${clientAuth.isEnabled ? 'ENABLED' : 'DISABLED (using default key)'}`);
      console.error(`[great-cards] Streamable HTTP: POST/GET/DELETE /mcp (for Claude connectors)`);
      console.error(`[great-cards] Legacy SSE: GET /sse + POST /messages`);
      console.error(`[great-cards] Health: GET /health`);
    });
  } else {
    // Default: stdio transport (for Claude Desktop, Claude Code, local MCP clients)
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[great-cards] MCP server running on stdio');
  }
}

main().catch((err) => {
  console.error('[great-cards] Fatal error:', err);
  process.exit(1);
});
