/**
 * Cache Service for AutoGradeX
 * In-memory caching with TTL support
 * 
 * Note: For production, consider upgrading to Redis:
 *   npm install ioredis
 *   Replace this with Redis-based implementation
 */

const logger = require('./logger');

/**
 * Simple in-memory cache with TTL
 * Thread-safe for Node.js single-thread model
 */
class CacheService {
  constructor() {
    this.cache = new Map();
    this.timers = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0
    };
    
    // Default TTLs (in seconds)
    this.TTL = {
      RUBRICS: 3600,           // 1 hour - rubrics rarely change
      COURSES: 1800,           // 30 minutes
      COURSE_LIST: 300,        // 5 minutes
      GRADES: 300,             // 5 minutes - may change frequently
      ASSIGNMENTS: 600,        // 10 minutes
      USER_PROFILE: 900,       // 15 minutes
      STATS: 180               // 3 minutes - dashboard stats
    };
  }

  /**
   * Generate cache key with namespace
   * @param {string} namespace - Cache namespace (e.g., 'rubrics', 'courses')
   * @param {string|object} identifier - Unique identifier
   * @returns {string} Cache key
   */
  key(namespace, identifier) {
    if (typeof identifier === 'object') {
      return `${namespace}:${JSON.stringify(identifier)}`;
    }
    return `${namespace}:${identifier}`;
  }

  /**
   * Get value from cache
   * @param {string} key - Cache key
   * @returns {any|null} Cached value or null
   */
  get(key) {
    const item = this.cache.get(key);
    
    if (!item) {
      this.stats.misses++;
      return null;
    }

    // Check if expired
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.delete(key);
      this.stats.misses++;
      return null;
    }

    this.stats.hits++;
    logger.debug('Cache hit', { key });
    return item.value;
  }

  /**
   * Set value in cache with TTL
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} ttlSeconds - Time to live in seconds (default: 300)
   */
  set(key, value, ttlSeconds = 300) {
    // Clear existing timer if any
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
    }

    const expiresAt = Date.now() + (ttlSeconds * 1000);
    
    this.cache.set(key, {
      value,
      expiresAt,
      createdAt: Date.now()
    });

    // Set auto-delete timer
    const timer = setTimeout(() => {
      this.delete(key);
    }, ttlSeconds * 1000);

    this.timers.set(key, timer);
    this.stats.sets++;
    
    logger.debug('Cache set', { key, ttlSeconds });
  }

  /**
   * Delete value from cache
   * @param {string} key - Cache key
   */
  delete(key) {
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }
    
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.stats.deletes++;
      logger.debug('Cache delete', { key });
    }
    return deleted;
  }

  /**
   * Delete all keys matching a pattern (namespace)
   * @param {string} pattern - Pattern to match (e.g., 'rubrics:*')
   */
  deletePattern(pattern) {
    const prefix = pattern.replace('*', '');
    let deletedCount = 0;

    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.delete(key);
        deletedCount++;
      }
    }

    logger.info('Cache pattern delete', { pattern, deletedCount });
    return deletedCount;
  }

  /**
   * Clear entire cache
   */
  clear() {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.cache.clear();
    logger.info('Cache cleared');
  }

  /**
   * Get cache statistics
   * @returns {object} Cache stats
   */
  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0
      ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2)
      : 0;

    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
      size: this.cache.size,
      memoryUsage: this.estimateMemoryUsage()
    };
  }

  /**
   * Estimate memory usage (rough approximation)
   * @returns {string} Memory usage in human-readable format
   */
  estimateMemoryUsage() {
    let bytes = 0;
    for (const [key, item] of this.cache.entries()) {
      bytes += key.length * 2; // UTF-16
      bytes += JSON.stringify(item.value).length * 2;
    }
    
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  // ============================================
  // Convenience Methods for Common Use Cases
  // ============================================

  /**
   * Get or set pattern - fetch from cache or execute function and cache result
   * @param {string} key - Cache key
   * @param {function} fn - Async function to execute if cache miss
   * @param {number} ttl - TTL in seconds
   * @returns {Promise<any>} Cached or fresh value
   */
  async getOrSet(key, fn, ttl = 300) {
    const cached = this.get(key);
    if (cached !== null) {
      return cached;
    }

    const value = await fn();
    this.set(key, value, ttl);
    return value;
  }

  // Rubrics
  cacheRubric(rubricId, data) {
    this.set(this.key('rubric', rubricId), data, this.TTL.RUBRICS);
  }

  getRubric(rubricId) {
    return this.get(this.key('rubric', rubricId));
  }

  invalidateRubric(rubricId) {
    this.delete(this.key('rubric', rubricId));
    this.deletePattern('rubrics:list:');
  }

  // Courses
  cacheCourseList(instructorId, data) {
    this.set(this.key('courses:list', instructorId), data, this.TTL.COURSE_LIST);
  }

  getCourseList(instructorId) {
    return this.get(this.key('courses:list', instructorId));
  }

  invalidateCourseList(instructorId) {
    this.delete(this.key('courses:list', instructorId));
  }

  cacheCourse(courseId, data) {
    this.set(this.key('course', courseId), data, this.TTL.COURSES);
  }

  getCourse(courseId) {
    return this.get(this.key('course', courseId));
  }

  invalidateCourse(courseId) {
    this.delete(this.key('course', courseId));
  }

  // Grades
  cacheGrades(submissionId, data) {
    this.set(this.key('grades', submissionId), data, this.TTL.GRADES);
  }

  getGrades(submissionId) {
    return this.get(this.key('grades', submissionId));
  }

  invalidateGrades(submissionId) {
    this.delete(this.key('grades', submissionId));
  }

  // Stats/Dashboard
  cacheStats(userId, statsType, data) {
    this.set(this.key(`stats:${statsType}`, userId), data, this.TTL.STATS);
  }

  getStats(userId, statsType) {
    return this.get(this.key(`stats:${statsType}`, userId));
  }

  invalidateStats(userId) {
    this.deletePattern(`stats:*:${userId}`);
  }
}

// Singleton instance
const cacheService = new CacheService();

module.exports = cacheService;
