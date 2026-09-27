/**
 * High-Speed In-Memory Cache with LRU Eviction, TTL & In-Flight Request Deduplication
 */

class MemoryCache {
  constructor(maxEntries = 500, defaultTtlMs = 15 * 60 * 1000) {
    this.maxEntries = maxEntries;
    this.defaultTtlMs = defaultTtlMs;
    this.cache = new Map();
    this.inFlight = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return null;
    const item = this.cache.get(key);
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    // Refresh LRU order (delete & re-insert)
    this.cache.delete(key);
    this.cache.set(key, item);
    return item.value;
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    if (this.cache.size >= this.maxEntries) {
      // Remove oldest entry (first item in Map)
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs
    });
  }

  delete(key) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  /**
   * Wrap an async fetcher function with automatic caching & in-flight deduplication.
   * If multiple concurrent requests ask for the same URL, only 1 worker process runs!
   */
  async getOrFetch(key, fetcher, ttlMs = this.defaultTtlMs) {
    const cached = this.get(key);
    if (cached) {
      console.log(`[CACHE HIT] Serving from memory for: ${key.substring(0, 60)}`);
      return cached;
    }

    if (this.inFlight.has(key)) {
      console.log(`[IN-FLIGHT DEDUP] Joining existing pending worker for: ${key.substring(0, 60)}`);
      return this.inFlight.get(key);
    }

    const promise = (async () => {
      try {
        const result = await fetcher();
        this.set(key, result, ttlMs);
        return result;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }
}

export const mediaInfoCache = new MemoryCache(500, 20 * 60 * 1000); // 20 mins TTL
