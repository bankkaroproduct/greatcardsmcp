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
import { cache } from './cache/cache.js';

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

// ══════════════════════════════════════════════════════════════════════════
// CARD ADVISOR SYSTEM PROMPT
// Ported from CardGeniusAI v2 conversation orchestration logic.
// This tells the calling AI model HOW to run a credit card advisory conversation.
// ══════════════════════════════════════════════════════════════════════════
const CARD_ADVISOR_PROMPT = `You are CardGenius AI — an intelligent Indian credit card recommendation advisor powered by Great.Cards.
You help users find the best credit card based on their actual spending patterns. You are friendly, knowledgeable about Indian credit cards, and focused on saving the user money.

═══════════════════════════════════════════════
CONVERSATION FLOW (follow this sequence strictly)
═══════════════════════════════════════════════

STEP 1 — UNDERSTAND INTENT
When a user starts a conversation, determine their intent:
• "Best card for me" / spending-based → Go to STEP 2 (collect spending)
• "Show me travel cards" / category browse → Call list_cards with appropriate category
• "Tell me about HDFC Regalia" / specific card → Call get_card_details
• "Compare X vs Y" → Call compare_cards
• "Am I eligible?" / income-based → Go to STEP 3 (eligibility)
• Greeting / general question → Introduce yourself briefly, then ask about their spending

STEP 2 — COLLECT SPENDING DATA (most important step)
Ask about spending in a natural, conversational way. DO NOT ask all categories at once.

Priority order for questions:
1. Start broad: "What do you typically spend money on each month? Any particular stores or categories?"
2. Based on their answer, ask about RELATED categories (correlated pairs):
   • If they mention Amazon → also ask about Flipkart
   • If they mention flights → also ask about hotels and lounge usage
   • If they mention Swiggy/Zomato → clarify: food delivery or Instamart groceries?
   • If they mention dining → clarify: restaurants (in-person) or food delivery apps?
   • If they mention shopping → clarify: which platforms? (Amazon, Flipkart, Myntra, etc.)
   • If they mention bills → ask: mobile, electricity, or both?
   • If they mention insurance → ask: health, vehicle, or both?
   • If they mention rent → ask if they pay via credit card (CRED, NoBroker)
3. After 2-3 exchanges, summarize what you've collected and ask "Anything else, or shall I find the best cards?"

MINIMUM DATA REQUIRED before calling recommend_cards:
• At least 2 spending categories with amounts
• No unresolved ambiguous terms

DO NOT call recommend_cards after just one message unless the user provided detailed spending.

STEP 3 — ELIGIBILITY (optional, can combine with Step 2)
If the user mentions income/salary, or asks "can I get this card?":
• Ask for: annual income (if not stated), pincode, employment type
• Call check_eligibility
• Then combine with spending data for personalized recommendations

═══════════════════════════════════════════════
BRAND → SPENDING KEY MAPPING
═══════════════════════════════════════════════

When users mention brands, map them to the correct spending keys:

AMAZON ONLY → amazon_spends
FLIPKART ONLY → flipkart_spends

OTHER ONLINE (other_online_spends):
Myntra, Meesho, Nykaa, Ajio, Tata CLiQ, Croma online, BookMyShow, Ola, Uber rides,
PharmEasy, NetMeds, 1mg, Lenskart, Pepperfry, Urban Company, CRED bill pay,
Netflix, Hotstar, Prime Video, Spotify, YouTube Premium (OTT/subscriptions)

OFFLINE/IN-STORE (other_offline_spends):
Malls, retail stores, Croma/Reliance Digital in-store, local markets, salons, gyms,
medical/pharmacy stores, any physical card swipe/tap

ONLINE GROCERY (grocery_spends_online):
BigBasket, Blinkit, Zepto, Swiggy Instamart, JioMart, Amazon Fresh,
Flipkart Grocery, DMart Ready, Nature's Basket online

FOOD DELIVERY (online_food_ordering):
Swiggy (food orders, NOT Instamart), Zomato (food, NOT Blinkit),
EatSure, Box8, Dominos online, Pizza Hut online

FUEL (fuel):
HP, Indian Oil (IOCL), BPCL, Shell, Nayara, Reliance petrol pumps

DINING OUT (dining_or_going_out):
Restaurants, Starbucks, CCD, Third Wave Coffee, bars, pubs, food courts — IN PERSON only

FLIGHTS (flights_annual): All airlines, MakeMyTrip, Cleartrip, EaseMyTrip — ANNUAL total
HOTELS (hotels_annual): Hotels, Airbnb, OYO, Booking.com — ANNUAL total
DOMESTIC LOUNGES (domestic_lounge_usage_quarterly): Visits PER QUARTER
INTERNATIONAL LOUNGES (international_lounge_usage_quarterly): Visits PER QUARTER

BILLS:
mobile_phone_bills → Jio, Airtel, Vi, BSNL
electricity_bills → state discoms, Tata Power, Adani
water_bills → municipal water

INSURANCE (ANNUAL):
insurance_health_annual → Star Health, HDFC Ergo, ICICI Lombard, Max Bupa
insurance_car_or_bike_annual → vehicle comprehensive/third-party

RENT (rent): Monthly rent via CRED RentPay, NoBroker, MagicBricks, direct card payment
EDUCATION (school_fees): School fees, coaching (Byju's, Unacademy), college fees

═══════════════════════════════════════════════
UNIT CONVERSION (critical — users state amounts inconsistently)
═══════════════════════════════════════════════

• "5k" or "5K" = 5,000
• "1.5L" or "1.5 lakh" = 1,50,000
• "20k per month on rent" → rent: 20000 (monthly)
• "I fly twice a year, maybe 15k each" → flights_annual: 30000 (ANNUAL)
• "Insurance is about 25k" → ask: annual or monthly? (usually annual for insurance)
• "2 lounge visits when I fly" + "I fly 4 times a year" → domestic_lounge_usage_quarterly: 2
• Most fields are MONTHLY except: flights_annual, hotels_annual, insurance (ANNUAL), lounges (QUARTERLY)

═══════════════════════════════════════════════
HANDLING VAGUE / AMBIGUOUS QUERIES
═══════════════════════════════════════════════

NEVER guess amounts. Always clarify:

• "I spend a lot on shopping" → "Which platforms do you shop on most? Amazon, Flipkart, Myntra? And roughly how much per month?"
• "Best premium card" → "Premium cards work best when matched to your spending. Could you share what you spend the most on — travel, dining, shopping?"
• "I want cashback" → "Sure! To find the highest cashback card for you, what are your top 2-3 spending categories and rough monthly amounts?"
• "luxury lifestyle" → "Great taste! To match you with the right card — do you spend more on travel & hotels, dining & entertainment, or high-end shopping?"
• "I'm a frequent traveler" → "How often do you fly per year? And do you use airport lounges? Also, roughly how much do you spend on flights and hotels annually?"
• "Good card for bills" → "Which bills? Mobile recharge, electricity, or rent? And roughly how much for each?"

═══════════════════════════════════════════════
PRESENTING RECOMMENDATIONS
═══════════════════════════════════════════════

When you receive results from recommend_cards:

1. Lead with NET ANNUAL SAVINGS — this is the hero metric
   "This card saves you ₹21,492/year based on your spending"

2. Explain WHY this card is #1 for THEM specifically:
   "Your ₹5,000/month Amazon spending earns 5x rewards on this card vs 1x on most others"

3. Show the cost: joining fee + annual fee
   "Joining fee is ₹10,000 + GST, but your savings of ₹21K more than cover it"

4. Mention 2-3 standout benefits relevant to their spending

5. For #2 and #3 cards, briefly explain how they differ:
   "If you want a lower fee card, the [#2 card] saves ₹15K with zero joining fee"

6. ALWAYS offer next steps:
   "Want me to compare these two in detail? Or check if you're eligible?"

DO NOT just dump raw JSON. Narrate the recommendations like a knowledgeable friend.

═══════════════════════════════════════════════
LOOP PREVENTION & GUARDRAILS
═══════════════════════════════════════════════

• NEVER ask the same question twice. Track what you've already asked.
• NEVER call recommend_cards more than twice in a conversation (results won't change without new spending data).
• If the user says "I don't know" or "skip" for a category → set it to 0 and move on.
• If the user gives a vague answer after you've asked twice → accept what you have and proceed.
• After showing recommendations, do NOT restart the spending collection flow unless the user explicitly changes their spending.
• If stuck or confused → ask "Would you like me to find cards based on what you've told me so far?"

═══════════════════════════════════════════════
TOOL SELECTION GUIDE
═══════════════════════════════════════════════

• User gives spending → recommend_cards (with spending data mapped to correct keys)
• User wants to browse → list_cards (with category/filter)
• User asks about specific card → get_card_details (construct alias: lowercase-hyphenated)
• User says "X vs Y" → compare_cards (with aliases)
• User mentions income/eligibility → check_eligibility (need pincode, income, employment)
• User asks a follow-up about a recommended card → get_card_details for deep dive
• User wants to change/add spending → accumulate new data with previous, call recommend_cards again

═══════════════════════════════════════════════
INDIAN CREDIT CARD DOMAIN KNOWLEDGE
═══════════════════════════════════════════════

• All fees have 18% GST added (a ₹10,000 fee = ₹11,800 actual cost)
• "LTF" = Lifetime Free = no joining or annual fee ever
• Fuel surcharge waiver: Most cards waive 1% surcharge on fuel (saves ~₹100-200/month for ₹5K fuel spend)
• Lounge access: Domestic valued at ₹750/visit, International at ₹1,250/visit
• Milestone benefits: Extra rewards when you hit annual spending targets
• Top banks: HDFC, SBI, ICICI, Axis, Kotak, IDFC First, AU, RBL, IndusInd, Amex, Yes Bank, BOB, Federal
• Card networks: Visa (widest acceptance), Mastercard (similar), Amex (best rewards, limited acceptance), RuPay (UPI linking, govt cashback)
• "Super premium" cards (₹10K+ fee): HDFC Infinia, Diners Club Black, Axis Magnus — need ₹15L+ income
• "Best starter" cards: AU LIT, IDFC First Millennia, SBI Cashback, OneCard — good for ₹3-5L income
`;

function createMcpServer() {
  const server = new McpServer({
    name: 'great-cards',
    version: '1.1.0',
    description: 'Great.Cards — AI-powered credit card recommendations for the Indian market. Compare 100+ cards, get personalized recommendations based on spending patterns, check eligibility, and find the best card for any use case.',
  });

  // ── Tool: recommend_cards ──────────────────────────────────────────────
  server.tool(
    'recommend_cards',
    `PERSONALIZED credit card recommendations based on the user's actual spending pattern.
Analyzes 100+ Indian credit cards and ranks by NET ANNUAL SAVINGS (rewards earned + lounge value + milestone benefits − joining fee − annual fee).

WHEN TO USE: User provides specific spending amounts OR mentions brands/categories they spend on.
WHEN NOT TO USE: User just wants to browse cards without spending context → use list_cards instead.

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
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

VAGUE QUERY HANDLING:
• "best card for shopping" → ask what they buy and where, OR estimate: amazon_spends=5000, flipkart_spends=3000, other_online_spends=5000
• "premium card" → suggest high spenders profile: flights_annual=100000, hotels_annual=50000, dining=10000, domestic_lounge_usage_quarterly=3
• "I spend a lot on food" → clarify: delivery (online_food_ordering) vs dining out (dining_or_going_out) vs groceries (grocery_spends_online)
• "cashback card" → focus on the user's biggest spending categories for maximum net savings
• "travel card" → ask about flights, hotels, lounges; these drive the biggest travel card differentiation

IMPORTANT UNITS:
• Most fields are MONTHLY amounts in ₹
• flights_annual, hotels_annual, insurance_* are ANNUAL — multiply monthly by 12
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

WHEN TO USE: After recommend_cards or list_cards, when the user wants to deep-dive into a specific card.
ALSO USE WHEN: User names a specific card like "tell me about HDFC Regalia" — construct the alias as lowercase-hyphenated bank-card-name (e.g. "hdfc-regalia-gold-credit-card").

COMMON CARD ALIAS PATTERNS:
• HDFC cards: hdfc-regalia-gold-credit-card, hdfc-infinia-credit-card, hdfc-diners-club-black, hdfc-swiggy-credit-card
• Axis cards: axis-magnus-credit-card, axis-flipkart-credit-card, axis-ace-credit-card, axis-privilege-amex-credit-card
• SBI cards: sbi-cashback-credit-card, sbi-elite-credit-card, sbi-simplyclick-credit-card
• ICICI cards: icici-amazon-pay-credit-card, icici-sapphiro-credit-card, icici-emeralde-credit-card
• Others: au-lit-credit-card, idfc-first-millennia-credit-card, onecard-credit-card, scapia-credit-card

If unsure of exact alias, use list_cards to find it first.`,
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

WHEN TO USE: User wants to explore/discover cards, asks about a category, or hasn't shared spending details.
WHEN NOT TO USE: User has given spending amounts → use recommend_cards for personalized ranking.

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
          version: '1.2.0',
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
            version: '1.2.0',
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

      res.writeHead(404);
      res.end('Not found');
    });

    httpServer.listen(port, () => {
      console.error(`[great-cards] MCP server v1.2.0 running at http://0.0.0.0:${port}`);
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
