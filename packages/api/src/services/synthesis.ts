import { llm } from '../utils/llm';
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
 * 
 * LLM: Groq (mixtral-8x7b-32768)
 * - Fast inference
 * - Free-tier available
 * - Perfect for MVP answer synthesis
 */

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

    const userPrompt = buildUserPrompt(query, context);

    // Use Groq LLM for fast, cheap inference
    const answer = await llm.generate(userPrompt, {
      temperature: 0,
      maxTokens: 500,
    });

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
 * User prompt with query and context.
 * No system prompt needed with Groq direct instruction.
 */
function buildUserPrompt(query: string, context: string): string {
  return `You are a precise question-answering system. Answer using ONLY the provided context.

RULES:
1. Answer ONLY from the context below
2. If insufficient context, respond: "I don't have enough information to answer this question."
3. Do NOT use external knowledge
4. Be concise but complete

Context:
${context}

Question: ${query}

Answer:`;
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
