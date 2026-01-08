import OpenAI from 'openai';
import { config } from '../config';
import { logger } from '../utils/logger';
import type { RankedResult } from './reranking';

/**
 * Answer Synthesis Service
 * 
 * Purpose: Generate grounded answers from retrieved chunks.
 * 
 * STRICT GROUNDING POLICY:
 * - Answer ONLY from provided context
 * - Refuse to answer if context is insufficient
 * - Return source chunk IDs for verification
 * - No free-form guessing or extrapolation
 * 
 * Why strict:
 * - Correctness > fluency
 * - Explicit failure > silent hallucination
 * - Debuggability (trace answer to source)
 */

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

export interface SynthesisResult {
  answer: string;
  sourceChunkIds: string[];
  refusalReason?: string; // Present if system refused to answer
}

/**
 * Generate answer from reranked chunks.
 * 
 * @param query - User query
 * @param chunks - Top reranked chunks
 * @returns Answer with source attribution
 */
export async function synthesizeAnswer(
  query: string,
  chunks: RankedResult[]
): Promise<SynthesisResult> {
  const startTime = Date.now();

  try {
    // Build context from chunks
    const context = chunks
      .map((chunk, idx) => `[${idx + 1}] ${chunk.content}`)
      .join('\n\n');

    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(query, context);

    const response = await openai.chat.completions.create({
      model: config.openai.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1, // Low temperature for consistency
      max_tokens: 500,
    });

    const answer = response.choices[0]?.message?.content?.trim() || '';

    // Check if system refused to answer
    const isRefusal = checkIfRefusal(answer);

    const result: SynthesisResult = {
      answer,
      sourceChunkIds: chunks.map((c) => c.chunkId),
      ...(isRefusal && { refusalReason: 'Insufficient context' }),
    };

    const latency = Date.now() - startTime;
    logger.info(
      { latency, chunksUsed: chunks.length, refused: isRefusal },
      'Answer synthesis completed'
    );

    return result;
  } catch (error) {
    logger.error({ error }, 'Answer synthesis failed');
    throw error;
  }
}

/**
 * System prompt enforcing strict grounding.
 */
function buildSystemPrompt(): string {
  return `You are a precise question-answering system. Your job is to answer questions using ONLY the provided context.

STRICT RULES:
1. Answer ONLY using information from the provided context
2. If the context does not contain enough information to answer, respond with: "I don't have enough information to answer this question."
3. Do NOT use external knowledge or make assumptions
4. Cite which context sections you used (e.g., "According to [1]...")
5. Be concise but complete

Your goal is CORRECTNESS, not fluency. If unsure, refuse to answer.`;
}

/**
 * User prompt with query and context.
 */
function buildUserPrompt(query: string, context: string): string {
  return `Context:
${context}

Question: ${query}

Answer (using ONLY the context above):`;
}

/**
 * Check if answer is a refusal.
 */
function checkIfRefusal(answer: string): boolean {
  const refusalPhrases = [
    "don't have enough information",
    'insufficient information',
    'cannot answer',
    'not enough context',
    'unable to answer',
  ];

  const lowerAnswer = answer.toLowerCase();
  return refusalPhrases.some((phrase) => lowerAnswer.includes(phrase));
}
