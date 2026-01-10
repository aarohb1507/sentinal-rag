import Groq from 'groq-sdk';
import { config } from '../config';
import { logger } from './logger';

/**
 * LLMClient Interface
 * 
 * Vendor-agnostic abstraction for LLM operations.
 * Allows swapping implementations without touching pipeline logic.
 * 
 * MVP Implementation: GroqClient
 */

export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export interface LLMClient {
  generate(prompt: string, options?: LLMOptions): Promise<string>;
  generateBatch(prompts: string[], options?: LLMOptions): Promise<string[]>;
}

/**
 * GroqClient Implementation
 * 
 * Uses Groq inference API (fast, cheap/free-tier).
 * Model: mixtral-8x7b-32768 (fast, efficient)
 * 
 * Why Groq:
 * - Free-tier available
 * - 1M tokens/day on free tier
 * - Fast inference (perfect for MVP)
 * - Suitable for answer synthesis and reranking
 */

export class GroqClient implements LLMClient {
  private client: Groq;
  private model: string = 'mixtral-8x7b-32768';

  constructor() {
    const apiKey = config.groq.apiKey;
    
    // Validate API key is present
    if (!apiKey || apiKey.trim() === '') {
      throw new Error(
        'GROQ_API_KEY is not configured. ' +
        'Set GROQ_API_KEY in .env file or as environment variable. ' +
        'Get free tier at: https://console.groq.com'
      );
    }

    this.client = new Groq({
      apiKey,
    });
    
    this.model = config.groq.model;
    
    logger.info({ model: this.model }, 'GroqClient initialized');
  }

  /**
   * Generate a single completion.
   */
  async generate(prompt: string, options: LLMOptions = {}): Promise<string> {
    const startTime = Date.now();

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: options.temperature ?? 0,
        max_tokens: options.maxTokens ?? 500,
      });

      const result = response.choices[0]?.message?.content?.trim() || '';
      const latency = Date.now() - startTime;

      logger.info({ latency, model: this.model }, 'LLM generation completed');

      return result;
    } catch (error) {
      logger.error({ error }, 'LLM generation failed');
      throw error;
    }
  }

  /**
   * Generate multiple completions in parallel (batch mode).
   * 
   * This is where we reduce API calls:
   * - Instead of 1 call per chunk for reranking,
   * - We batch 3-5 chunks per call
   */
  async generateBatch(prompts: string[], options: LLMOptions = {}): Promise<string[]> {
    const startTime = Date.now();

    try {
      const completions = await Promise.all(
        prompts.map((prompt) => this.generate(prompt, options))
      );

      const latency = Date.now() - startTime;

      logger.info(
        { latency, batchSize: prompts.length, model: this.model },
        'LLM batch generation completed'
      );

      return completions;
    } catch (error) {
      logger.error({ error }, 'LLM batch generation failed');
      throw error;
    }
  }

  /**
   * Set model (for future flexibility).
   */
  setModel(model: string): void {
    this.model = model;
  }
}

// Export singleton instance
export const llm = new GroqClient();
