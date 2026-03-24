import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { AppConfig } from '../config/configuration.js';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  /** Publisher / general-purpose client */
  readonly client: Redis;

  /** Dedicated subscriber client — a client in subscribe mode cannot issue other commands */
  readonly subscriber: Redis;

  constructor(private readonly config: ConfigService<AppConfig>) {
    const url = this.config.get('REDIS_URL', { infer: true })!;
    this.client = new Redis(url, { lazyConnect: true });
    this.subscriber = new Redis(url, { lazyConnect: true });

    this.client.on('error', (err) =>
      this.logger.error('Redis client error', err),
    );
    this.subscriber.on('error', (err) =>
      this.logger.error('Redis subscriber error', err),
    );
  }

  async onModuleInit(): Promise<void> {
    const connectIfNeeded = (c: Redis) =>
      c.status === 'wait' ? c.connect() : Promise.resolve();
    await Promise.all([connectIfNeeded(this.client), connectIfNeeded(this.subscriber)]);
    this.logger.log('Redis connected (client + subscriber)');
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([
      this.client.quit(),
      this.subscriber.quit(),
    ]);
  }

  // ─── Generic helpers ────────────────────────────────────────────────────

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const serialised = JSON.stringify(value);
    if (ttlSeconds) {
      await this.client.setex(key, ttlSeconds, serialised);
    } else {
      await this.client.set(key, serialised);
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length) await this.client.del(keys);
  }

  async publish(channel: string, payload: unknown): Promise<void> {
    await this.client.publish(channel, JSON.stringify(payload));
  }

  // ─── Cache-aside helper ──────────────────────────────────────────────────

  /**
   * Read-through cache helper.
   * Returns cached value if present, otherwise calls `fetcher`, stores the
   * result with the given TTL, and returns it.
   */
  async cachedFetch<T>(
    key: string,
    ttlSeconds: number,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const data = await fetcher();
    await this.set(key, data, ttlSeconds);
    return data;
  }
}
