import { z } from 'zod';
import { apiClient, type SpendingData } from '../api/client.js';
import { enrichCardGeniusResults } from '../enrichment/cardGenius.js';

// Embedded in every response so the LLM agent always has next-step guidance
const LLM_CONTEXT = {
  _llm_instructions: {
    output_format: {
      table_rule: 'When presenting 2+ cards, ALWAYS use a markdown table. Rank rows by net_annual_savings (highest first). Bold the #1 card name.',
      table_columns: 'Max 5 columns: Card | Net Savings/yr | Fee (incl. GST) | Top Reward | Verdict. Keep it scannable — no column overload.',
      monthly_framing: 'Show savings in ₹/month alongside annual (e.g. "₹14,400/yr (₹1,200/mo)"). Monthly is more relatable for Indian users.',
      fee_payback: 'For every paid card, show fee payback: "Your savings cover the ₹X fee in Y months." This makes the cost tangible.',
      fee_waiver_flag: 'If a card has a fee waiver condition, flag it prominently: "⚡ Fee waived on ₹X annual spend". This changes the decision for many users.',
      one_line_verdict: 'Each card gets a 1-line verdict: "Best if you spend heavily on Amazon + dining" or "Great free card for beginners".',
      spending_match: 'Show how much of the user\'s declared spending each card covers: "Covers 85% of your spending categories" — helps users understand fit.',
    },
    how_to_present: [
      'Lead with the #1 card and its net_annual_savings — this is the headline number.',
      'Explain WHY it ranked #1 using the spending_breakdown (e.g. "Your ₹8K/month Amazon spending earns 5x rewards on this card").',
      'For #2 and #3: brief comparison highlighting the trade-off (e.g. "lower fee but no lounge access").',
      'NEVER list more than 3-4 cards — it overwhelms the user.',
      'NEVER show raw JSON to the user — always narrate the results.',
    ],
    next_actions: [
      'Offer to compare top 2: "Want me to compare these two side by side?" → use compare_cards with the card_alias values.',
      'Offer deep-dive: "Want to know more about [top card]\'s rewards structure?" → use get_card_details with the card_alias.',
      'Offer eligibility: "Want to check if you qualify for [top card]?" → use check_eligibility (need pincode, income, employment).',
      'If user didn\'t share all spending: "I notice you didn\'t mention [category]. Adding that could change the ranking — do you spend on [category]?"',
      'ALWAYS end with a clear CTA: "Apply via Great.Cards" or offer a next step — never just dump data and stop.',
    ],
    anti_hallucination: [
      'NEVER invent reward rates, points multipliers, or benefits not in the response data.',
      'NEVER claim a card is "free" if joining_fee or annual_fee shows a non-zero amount.',
      'NEVER say "this card has no annual fee" unless annual_fee literally says "Free".',
      'If spending_breakdown is empty or missing for a card, say "detailed breakdown unavailable" — don\'t guess.',
      'Use card_alias from this response for any follow-up tool calls — NEVER construct aliases manually.',
    ],
    fee_context: 'All fees include 18% GST. "Joining fee" is a one-time Year 1 cost (not deducted from annual savings). "Annual fee" is the recurring yearly cost. Many cards waive the annual fee if you spend above a threshold (check get_card_details for waiver conditions).',
    savings_formula: 'net_annual_savings = annual_rewards_value + milestone_benefits + lounge_value - annual_fee. Joining fee is excluded as it is a one-time cost. A positive number means the card pays for itself annually.',
    context_check: 'If you haven\'t called get_advisor_context yet this session and need to collect more spending data, call it with topic="correlated_pairs" to know which categories to ask about next.',
  },
};

export const recommendCardsSchema = z.object({
  amazon_spends: z.number().optional().describe('Monthly Amazon spending in ₹ (Amazon ONLY — not other e-commerce)'),
  flipkart_spends: z.number().optional().describe('Monthly Flipkart spending in ₹ (Flipkart ONLY — not other e-commerce)'),
  other_online_spends: z.number().optional().describe('Monthly OTHER online shopping in ₹. INCLUDES: Myntra, Meesho, Nykaa, Ajio, Tata CLiQ, Croma online, BookMyShow, Ola, Uber cabs, PharmEasy, NetMeds, 1mg, Lenskart, Pepperfry, Urban Company. EXCLUDES: Amazon, Flipkart, Swiggy/Zomato food, BigBasket/Blinkit/Zepto groceries (these have their own keys)'),
  other_offline_spends: z.number().optional().describe('Monthly offline/in-store spending in ₹. INCLUDES: malls, retail stores, clothing shops, electronics stores (Croma/Reliance Digital in-store), local markets, salons, gyms, medical/pharmacy in-store, any physical swipe/tap. EXCLUDES: restaurants (use dining_or_going_out), petrol pumps (use fuel), grocery stores if buying online (use grocery_spends_online)'),
  grocery_spends_online: z.number().optional().describe('Monthly ONLINE grocery spending in ₹. INCLUDES: BigBasket, Blinkit, Zepto, Swiggy Instamart, JioMart, Amazon Fresh, Flipkart Grocery, DMart Ready, Nature\'s Basket online. EXCLUDES: physical grocery stores (use offline_grocery), Swiggy/Zomato restaurant food delivery (use online_food_ordering)'),
  online_food_ordering: z.number().optional().describe('Monthly food DELIVERY spending in ₹. INCLUDES: Swiggy food delivery, Zomato food delivery, EatSure, Box8, Dominos online, Pizza Hut online. EXCLUDES: dining at restaurants in person (use dining_or_going_out), Swiggy Instamart/grocery (use grocery_spends_online)'),
  fuel: z.number().optional().describe('Monthly fuel/petrol/diesel spending in ₹ at petrol pumps. INCLUDES: HP, Indian Oil (IOCL), Bharat Petroleum (BPCL), Shell, Nayara, Reliance petrol pumps. Key: many cards offer fuel surcharge waiver (1% saving on every fill)'),
  dining_or_going_out: z.number().optional().describe('Monthly restaurant/dining OUT spending in ₹. INCLUDES: restaurants, cafes (Starbucks, CCD, Third Wave), bars, pubs, cloud kitchens dine-in, food courts. This is IN-PERSON dining only. EXCLUDES: food delivery apps (use online_food_ordering)'),
  flights_annual: z.number().optional().describe('ANNUAL flight ticket spending in ₹ (NOT monthly). INCLUDES: domestic and international flights booked on MakeMyTrip, Cleartrip, EaseMyTrip, airline websites (IndiGo, Air India, Vistara, SpiceJet, AirAsia), Google Flights. Convert monthly to annual if user gives monthly'),
  hotels_annual: z.number().optional().describe('ANNUAL hotel/stay spending in ₹ (NOT monthly). INCLUDES: hotels, resorts, Airbnb, OYO, MakeMyTrip stays, Booking.com, Goibibo. Convert monthly to annual if user gives monthly'),
  domestic_lounge_usage_quarterly: z.number().optional().describe('Domestic airport lounge visits PER QUARTER (not monthly, not annual). If user says "I fly 4 times a year" → that\'s ~1 per quarter. If "twice a month" → ~6 per quarter. Common: Priority Pass, DreamFolks, individual bank lounges. Valued at ₹750 per visit'),
  international_lounge_usage_quarterly: z.number().optional().describe('International airport lounge visits PER QUARTER. Valued at ₹1,250 per visit. Most relevant for frequent international travelers'),
  mobile_phone_bills: z.number().optional().describe('Monthly mobile/phone bill in ₹. INCLUDES: Jio, Airtel, Vi (Vodafone-Idea), BSNL postpaid/prepaid recharges'),
  electricity_bills: z.number().optional().describe('Monthly electricity bill in ₹. INCLUDES: state discom bills, Tata Power, Adani Electricity, BSES, CESC'),
  water_bills: z.number().optional().describe('Monthly water bill in ₹'),
  insurance_health_annual: z.number().optional().describe('ANNUAL health insurance premium in ₹ (NOT monthly). INCLUDES: Star Health, HDFC Ergo, ICICI Lombard, Max Bupa, Niva Bupa, employer top-up plans. Convert monthly to annual if needed'),
  insurance_car_or_bike_annual: z.number().optional().describe('ANNUAL vehicle insurance premium in ₹ (NOT monthly). INCLUDES: car and two-wheeler insurance — comprehensive, third-party, own-damage'),
  rent: z.number().optional().describe('Monthly rent payment in ₹. INCLUDES: rent paid via CRED RentPay, NoBroker, MagicBricks RentPay, Paytm, or directly on credit card. Note: most rent platforms charge 1-2% convenience fee, so net benefit depends on card reward rate exceeding this'),
  school_fees: z.number().optional().describe('Monthly school/education fees in ₹. INCLUDES: school tuition, coaching (Aakash, Allen, FIITJEE, Byju\'s, Unacademy), college fees, university fees paid on credit card'),
  offline_grocery: z.number().optional().describe('Monthly OFFLINE/physical grocery store spending in ₹. INCLUDES: DMart, Reliance Smart, Reliance Fresh, Nature\'s Basket, 24Seven, local kirana stores, supermarkets, liquor stores — any in-person grocery/household purchase. EXCLUDES: online grocery apps (use grocery_spends_online)'),
  life_insurance: z.number().optional().describe('ANNUAL life insurance premium in ₹ (NOT monthly). INCLUDES: LIC, HDFC Life, SBI Life, ICICI Prudential Life, Max Life, Tata AIA Life, Bajaj Allianz Life, PNB MetLife, term plans, endowment plans, ULIPs. EXCLUDES: health insurance (use insurance_health_annual), vehicle insurance (use insurance_car_or_bike_annual)'),
  top_n: z.number().optional().default(5).describe('Number of top cards to return (default 5)'),
  response_format: z.enum(['full', 'brief', 'comparison']).optional().default('full').describe('"full" = detailed breakdown per card, "brief" = card name + net savings + fees only, "comparison" = table-friendly flat structure'),
});

export async function recommendCards(input: z.infer<typeof recommendCardsSchema>) {
  const { top_n, response_format, ...spendingData } = input;

  const calcResponse = await apiClient.calculateCardGenius(spendingData as SpendingData);
  const savings = calcResponse?.data?.savings || calcResponse?.data;

  if (!savings) {
    return { error: 'No recommendations available for the given spending profile.' };
  }

  const enriched = await enrichCardGeniusResults({
    savings: Array.isArray(savings) ? savings : [savings],
    responses: spendingData as Record<string, number>,
    fetchDetails: true,
  });

  const topCards = enriched.slice(0, top_n);

  if (response_format === 'brief') {
    return {
      total_cards_analyzed: enriched.length,
      recommendations: topCards.map((card, rank) => ({
        rank: rank + 1,
        card_name: card.card_name,
        bank_name: card.bank_name,
        net_annual_savings: `₹${card.net_savings.toLocaleString('en-IN')}`,
        joining_fee: card.joining_fees === 0 ? 'Free' : `₹${card.joining_fees.toLocaleString('en-IN')}`,
        annual_fee: card.annual_fees === 0 ? 'Free' : `₹${card.annual_fees!.toLocaleString('en-IN')}`,
        card_alias: card.seo_card_alias,
      })),
      _format_hint: 'Present as a ranked list. net_annual_savings is the primary metric — it accounts for rewards earned MINUS fees paid.',
      ...LLM_CONTEXT,
    };
  }

  if (response_format === 'comparison') {
    return {
      total_cards_analyzed: enriched.length,
      recommendations: topCards.map((card, rank) => ({
        rank: rank + 1,
        card_name: card.card_name,
        bank_name: card.bank_name,
        net_annual_savings: card.net_savings,
        annual_rewards: card.total_savings_yearly,
        milestone_benefits: card.milestone_benefits_only || 0,
        lounge_value: card.airport_lounge_value || 0,
        joining_fee: card.joining_fees,
        annual_fee: card.annual_fees,
        card_alias: card.seo_card_alias,
      })),
      _format_hint: 'Numeric values for easy comparison. Present as a table. net_annual_savings = annual_rewards + milestone_benefits + lounge_value - joining_fee - annual_fee.',
      ...LLM_CONTEXT,
    };
  }

  return {
    total_cards_analyzed: enriched.length,
    recommendations: topCards.map((card, rank) => ({
      rank: rank + 1,
      card_name: card.card_name,
      bank_name: card.bank_name,
      card_type: card.card_type,
      net_annual_savings: `₹${card.net_savings.toLocaleString('en-IN')}`,
      annual_rewards_value: `₹${card.total_savings_yearly.toLocaleString('en-IN')}`,
      milestone_benefits: `₹${(card.milestone_benefits_only || 0).toLocaleString('en-IN')}`,
      lounge_value: `₹${(card.airport_lounge_value || 0).toLocaleString('en-IN')}`,
      joining_fee: card.joining_fees === 0 ? 'Free' : `₹${card.joining_fees.toLocaleString('en-IN')} (incl. GST)`,
      annual_fee: card.annual_fees === 0 ? 'Free' : `₹${card.annual_fees!.toLocaleString('en-IN')} (incl. GST)`,
      welcome_benefits: card.welcome_benefits,
      spending_breakdown: card.spending_breakdown,
      card_alias: card.seo_card_alias,
      rating: card.rating,
      image: card.card_bg_image,
    })),
    _format_hint: 'net_annual_savings is the KEY metric — it\'s what the user actually saves after fees. Always lead with this. spending_breakdown shows exactly where savings come from per category.',
    ...LLM_CONTEXT,
  };
}
