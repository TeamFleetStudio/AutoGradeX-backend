/**
 * Metrics & Monitoring Service for AutoGradeX
 * Tracks API performance, errors, and usage analytics
 */

const logger = require('./logger');

/**
 * Metrics collector for performance monitoring
 */
class MetricsService {
  constructor() {
    // API metrics
    this.apiMetrics = {
      requests: new Map(),       // Route -> request count
      latencies: new Map(),      // Route -> latency array
      errors: new Map(),         // Route -> error count
      statusCodes: new Map()     // Status code -> count
    };

    // User action metrics
    this.userActions = {
      grading: 0,
      submissions: 0,
      aiGrading: 0,
      logins: 0,
      signups: 0
    };

    // Error tracking
    this.errors = [];
    this.maxErrorsStored = 1000;

    // Start time for uptime calculation
    this.startTime = Date.now();

    // Alert thresholds
    this.thresholds = {
      errorRatePercent: 1,      // Alert if error rate > 1%
      latencyMs: 5000,          // Alert if p95 latency > 5s
      errorCount: 100           // Alert if errors > 100 in window
    };

    // Reset metrics every hour (rolling window)
    this.lastReset = Date.now();
    this.resetIntervalMs = 3600000; // 1 hour
  }

  /**
   * Record API request metrics
   * @param {string} route - API route (e.g., 'POST /api/v1/submissions')
   * @param {number} statusCode - HTTP status code
   * @param {number} latencyMs - Request latency in milliseconds
   * @param {object} metadata - Additional metadata
   */
  recordRequest(route, statusCode, latencyMs, metadata = {}) {
    // Increment request count
    this.apiMetrics.requests.set(
      route,
      (this.apiMetrics.requests.get(route) || 0) + 1
    );

    // Record latency (keep last 1000 per route)
    if (!this.apiMetrics.latencies.has(route)) {
      this.apiMetrics.latencies.set(route, []);
    }
    const latencies = this.apiMetrics.latencies.get(route);
    latencies.push(latencyMs);
    if (latencies.length > 1000) {
      latencies.shift();
    }

    // Record status code
    this.apiMetrics.statusCodes.set(
      statusCode,
      (this.apiMetrics.statusCodes.get(statusCode) || 0) + 1
    );

    // Record errors (4xx and 5xx)
    if (statusCode >= 400) {
      this.apiMetrics.errors.set(
        route,
        (this.apiMetrics.errors.get(route) || 0) + 1
      );
    }

    // Check for alerts
    this.checkAlerts(route, statusCode, latencyMs, metadata);
  }

  /**
   * Record user action for analytics
   * @param {string} action - Action type
   * @param {object} metadata - Action metadata
   */
  recordUserAction(action, metadata = {}) {
    if (action in this.userActions) {
      this.userActions[action]++;
    }

    logger.info('User action', { action, ...metadata });
  }

  /**
   * Record error for tracking
   * @param {Error} error - Error object
   * @param {object} context - Error context
   */
  recordError(error, context = {}) {
    const errorRecord = {
      timestamp: new Date().toISOString(),
      message: error.message,
      stack: error.stack,
      code: error.code || 'UNKNOWN',
      context: {
        route: context.route,
        userId: context.userId,
        method: context.method,
        userAgent: context.userAgent
      }
    };

    this.errors.push(errorRecord);

    // Trim old errors
    if (this.errors.length > this.maxErrorsStored) {
      this.errors = this.errors.slice(-this.maxErrorsStored);
    }

    // Log error
    logger.error('Error recorded', errorRecord);

    // Check if we need to alert
    const recentErrors = this.errors.filter(
      e => Date.now() - new Date(e.timestamp).getTime() < 60000
    );
    
    if (recentErrors.length >= this.thresholds.errorCount) {
      this.triggerAlert('HIGH_ERROR_RATE', {
        errorCount: recentErrors.length,
        window: '1 minute'
      });
    }
  }

  /**
   * Check and trigger alerts based on thresholds
   */
  checkAlerts(route, statusCode, latencyMs, metadata) {
    // High latency alert
    if (latencyMs > this.thresholds.latencyMs) {
      this.triggerAlert('HIGH_LATENCY', {
        route,
        latencyMs,
        threshold: this.thresholds.latencyMs
      });
    }

    // Calculate error rate
    const totalRequests = Array.from(this.apiMetrics.requests.values())
      .reduce((sum, count) => sum + count, 0);
    const totalErrors = Array.from(this.apiMetrics.errors.values())
      .reduce((sum, count) => sum + count, 0);
    
    const errorRate = totalRequests > 0 
      ? (totalErrors / totalRequests) * 100 
      : 0;

    if (errorRate > this.thresholds.errorRatePercent) {
      this.triggerAlert('ERROR_RATE_EXCEEDED', {
        errorRate: `${errorRate.toFixed(2)}%`,
        threshold: `${this.thresholds.errorRatePercent}%`
      });
    }
  }

  /**
   * Trigger an alert (log + potential external notification)
   * @param {string} alertType - Type of alert
   * @param {object} data - Alert data
   */
  triggerAlert(alertType, data) {
    const alert = {
      type: alertType,
      timestamp: new Date().toISOString(),
      data
    };

    // Log the alert
    logger.warn('ALERT', alert);

    // TODO: Send to external monitoring service (Sentry, PagerDuty, Slack)
    // await notificationService.sendAlert(alert);
  }

  /**
   * Calculate percentile from array of values
   * @param {number[]} arr - Array of values
   * @param {number} p - Percentile (0-100)
   * @returns {number} Percentile value
   */
  percentile(arr, p) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Get comprehensive metrics summary
   * @returns {object} Metrics summary
   */
  getSummary() {
    const totalRequests = Array.from(this.apiMetrics.requests.values())
      .reduce((sum, count) => sum + count, 0);
    const totalErrors = Array.from(this.apiMetrics.errors.values())
      .reduce((sum, count) => sum + count, 0);

    // Calculate overall latency stats
    const allLatencies = Array.from(this.apiMetrics.latencies.values()).flat();
    
    return {
      uptime: this.formatUptime(Date.now() - this.startTime),
      requests: {
        total: totalRequests,
        byRoute: Object.fromEntries(this.apiMetrics.requests),
        byStatusCode: Object.fromEntries(this.apiMetrics.statusCodes)
      },
      errors: {
        total: totalErrors,
        rate: totalRequests > 0 ? `${((totalErrors / totalRequests) * 100).toFixed(2)}%` : '0%',
        byRoute: Object.fromEntries(this.apiMetrics.errors),
        recent: this.errors.slice(-10)
      },
      latency: {
        p50: this.percentile(allLatencies, 50).toFixed(2) + 'ms',
        p95: this.percentile(allLatencies, 95).toFixed(2) + 'ms',
        p99: this.percentile(allLatencies, 99).toFixed(2) + 'ms',
        avg: allLatencies.length > 0 
          ? (allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length).toFixed(2) + 'ms'
          : '0ms'
      },
      userActions: { ...this.userActions },
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Format uptime as human-readable string
   * @param {number} ms - Milliseconds
   * @returns {string} Formatted uptime
   */
  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  /**
   * Reset metrics (called periodically)
   */
  reset() {
    this.apiMetrics.requests.clear();
    this.apiMetrics.latencies.clear();
    this.apiMetrics.errors.clear();
    this.apiMetrics.statusCodes.clear();
    
    // Keep user actions as cumulative
    this.lastReset = Date.now();
    
    logger.info('Metrics reset');
  }
}

// Singleton instance
const metricsService = new MetricsService();

module.exports = metricsService;
