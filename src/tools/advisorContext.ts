import { z } from 'zod';
import { CARD_ADVISOR_PROMPT } from '../prompts/cardAdvisor.js';
import { SECTION_MAP, ALL_TOPICS } from '../prompts/sections/index.js';

export const advisorContextSchema = z.object({
  topic: z.enum([
    'full',
    'conversation_flow',
    'data_collection',
    'brand_mappings',
    'correlated_pairs',
    'unit_conversion',
    'feature_mapping',
    'personas',
    'vague_queries',
    'presentation',
    'guardrails',
    'tool_guide',
    'domain_knowledge',
  ]).optional().default('tool_guide').describe(
    'Which context to load. Use "full" for the complete advisory playbook (~13K tokens — recommended on first call). ' +
    'Use specific topics for targeted context: "brand_mappings" (700+ brands), "correlated_pairs" (related categories to ask together), ' +
    '"unit_conversion" (monthly vs annual vs quarterly rules), "personas" (student, traveler, business owner templates), ' +
    '"domain_knowledge" (fees, rewards, lounges, banks, networks).'
  ),
});

/**
 * Extract a section from the monolithic prompt by its label prefix.
 * Sections are delimited by "━━━" separator lines with "SECTION N:" headers.
 */
function extractSection(fullPrompt: string, sectionLabel: string): string {
  const startIdx = fullPrompt.indexOf(sectionLabel);
  if (startIdx === -1) return `[Section "${sectionLabel}" not found in prompt]`;

  // Include the separator line before the section header
  const lineStart = fullPrompt.lastIndexOf('\n', startIdx);
  const sectionStart = lineStart > 0 ? lineStart + 1 : 0;

  // Find the next "SECTION" keyword that starts a new section
  // Sections use pattern: ━━━\nSECTION N:
  const sectionPattern = /\n━+\nSECTION \d+:/g;
  sectionPattern.lastIndex = startIdx + sectionLabel.length;
  const nextMatch = sectionPattern.exec(fullPrompt);

  if (!nextMatch) {
    // Last section — take everything to the end
    return fullPrompt.slice(sectionStart).trim();
  }

  return fullPrompt.slice(sectionStart, nextMatch.index).trim();
}

export function getAdvisorContext(input: z.infer<typeof advisorContextSchema>) {
  const { topic } = input;

  if (topic === 'full') {
    return {
      topic: 'full',
      description: 'Complete CardGenius advisory playbook — conversation flow, brand mappings, data collection, personas, domain knowledge, and guardrails.',
      sections_included: ALL_TOPICS,
      token_estimate: '~13,000 tokens',
      context: CARD_ADVISOR_PROMPT,
      _llm_instructions: {
        how_to_use: [
          'This is your system-level operating manual for credit card advisory conversations.',
          'Internalize this context — it defines how you should behave for the rest of this session.',
          'The brand mappings (Section 3) are CRITICAL: they tell you which spending key to use when a user mentions a brand.',
          'The correlated pairs (Section 4) prevent you from missing related spending categories.',
          'The guardrails (Section 10) prevent infinite loops and stuck conversations.',
        ],
        important: 'You do NOT need to call this tool again during this session. The context is persistent — use it for all subsequent tool calls.',
        other_tools_available: {
          generate_content_brief: {
            when: 'User asks for "best X cards", "top travel/fuel/shopping cards", "write an article", "content ideas", "which cards are best for [category]", "carousel about", "blog post about", or ANY editorial/research question about cards — even casually phrased.',
            rule: 'NEVER answer category or content questions from training knowledge. ALWAYS call generate_content_brief.',
            params: 'content_type (category_best_cards | card_comparison | persona_guide | upgrade_path | fee_justification | bank_ranking) + category or card_aliases as needed. Optional: output_format (blog|carousel|reels|thread|linkedin), audience, goal, hook, tone.',
          },
        },
      },
      _integration_hint: 'For chatbot developers: call this tool ONCE at session start and inject the "context" field into your system prompt. This gives your LLM the full advisory playbook without needing to call it per-turn.',
    };
  }

  const sectionMeta = SECTION_MAP[topic];
  if (!sectionMeta) {
    return { error: `Unknown topic: ${topic}. Available: ${ALL_TOPICS.join(', ')}` };
  }

  const content = extractSection(CARD_ADVISOR_PROMPT, sectionMeta.label);

  return {
    topic,
    description: sectionMeta.description,
    context: content,
    available_topics: ALL_TOPICS.filter(t => t !== topic),
    _llm_instructions: {
      how_to_use: [
        `This is the "${topic}" section of the advisory playbook.`,
        'Internalize it and apply it to the current conversation.',
        `Other sections available: ${ALL_TOPICS.filter(t => t !== topic).join(', ')}`,
        'Call get_advisor_context again with a different topic if you need more context.',
      ],
      other_tools_available: {
        generate_content_brief: 'Call for ANY content/editorial request — "best X cards", "write article", "content ideas", "carousel about X", "top cards for Y". NEVER answer from training knowledge.',
      },
    },
  };
}
