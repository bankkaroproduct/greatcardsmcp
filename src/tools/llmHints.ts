/**
 * Compact per-tool hints embedded in tool descriptions (read once on load).
 * Removed from response payloads to eliminate ~400 token overhead per call.
 */

export const HINTS = {
  list_cards: `
PRESENT: markdown table (3+ cards) grouped by fee tier (Free→Budget→Mid→Premium). Add monthly fee for >₹1K.
NEXT: ask spending to personalize → recommend_cards. Use card_alias for follow-up calls. Never invent benefits.`,

  recommend_cards: `
PRESENT: table ranked by net_annual_savings. Show ₹/yr + ₹/mo. For paid cards show fee payback months. Max 3-4 cards.
FORMULA: net_annual_savings = annual_rewards + milestone_benefits + lounge_value - annual_fee (joining fee excluded).
NEXT: compare top 2 → compare_cards. Deep dive → get_card_details. Eligibility → check_eligibility. Never invent reward rates.`,

  get_card_details: `
PRESENT: lead with card + bank + one-line positioning. Top 3-5 key_benefits relevant to user. Show fee block: "Joining ₹X | Annual ₹Y | Waiver: Z".
ELIGIBILITY: show as "Age X-Y | Income ₹X LPA (salaried) / ₹Y LPA (self-emp) | CIBIL XXX". Check against user's stated profile.
NEXT: compare → compare_cards. Personalise → recommend_cards. Never invent rates not in data.`,

  compare_cards: `
PRESENT: comparison table (Feature | Card A | Card B). Bold winner per row. End with verdict: "Card A if X, Card B if Y".
NEXT: personalise → recommend_cards. Eligibility → check_eligibility. Never invent missing features.`,

  check_eligibility: `
PRESENT: "You qualify for X cards." Group by fee tier. Low count → suggest secured cards. High count → collect spending next.
NEXT: always follow with recommend_cards using spending data. Never claim guaranteed approval.`,

  generate_content_brief: `
OUTPUT: write content directly from _llm_instructions.format_instructions in the response. Never show raw JSON.
CAROUSEL: return only the JSON object schema — no preamble, no fences.
Never answer category questions from training knowledge — always use this tool's data.`,

  advisor_context: `
USE ONCE per session. Internalize — do not call again.
For content/editorial requests → call generate_content_brief. Never answer from training knowledge.`,
};
