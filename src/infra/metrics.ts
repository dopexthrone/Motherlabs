/**
 * Observability / Metrics
 * =======================
 *
 * Structured metrics collection and logging.
 * Replaces console.log with proper observability.
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Metric type.
 */
export type MetricType = 'counter' | 'gauge' | 'histogram' | 'timer';

/**
 * A metric value.
 */
export interface MetricValue {
  /**
   * Metric name.
   */
  name: string;

  /**
   * Metric type.
   */
  type: MetricType;

  /**
   * Current value.
   */
  value: number;

  /**
   * Labels/tags.
   */
  labels: Record<string, string>;

  /**
   * Timestamp.
   */
  timestamp: number;

  /**
   * Unit (e.g., 'ms', 'bytes', 'requests').
   */
  unit?: string;
}

/**
 * Log level.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Structured log entry.
 */
export interface LogEntry {
  /**
   * Log level.
   */
  level: LogLevel;

  /**
   * Message.
   */
  message: string;

  /**
   * Timestamp.
   */
  timestamp: number;

  /**
   * Component/source.
   */
  component?: string;

  /**
   * Additional context.
   */
  context?: Record<string, unknown>;

  /**
   * Trace ID for correlation.
   */
  trace_id?: string;

  /**
   * Duration (for timed operations).
   */
  duration_ms?: number;
}

/**
 * Span for distributed tracing.
 */
export interface Span {
  /**
   * Trace ID.
   */
  trace_id: string;

  /**
   * Span ID.
   */
  span_id: string;

  /**
   * Parent span ID.
   */
  parent_span_id?: string;

  /**
   * Operation name.
   */
  operation: string;

  /**
   * Start time.
   */
  start_time: number;

  /**
   * End time.
   */
  end_time?: number;

  /**
   * Tags/labels.
   */
  tags: Record<string, string>;

  /**
   * Events within the span.
   */
  events: Array<{ name: string; timestamp: number; attributes?: Record<string, unknown> }>;

  /**
   * Status.
   */
  status: 'ok' | 'error' | 'pending';

  /**
   * Error message if status is error.
   */
  error?: string;
}

/**
 * Metrics exporter interface.
 */
export interface MetricsExporter {
  /**
   * Export metrics.
   */
  exportMetrics(metrics: MetricValue[]): Promise<void>;

  /**
   * Export logs.
   */
  exportLogs(logs: LogEntry[]): Promise<void>;

  /**
   * Export spans.
   */
  exportSpans(spans: Span[]): Promise<void>;
}

// =============================================================================
// Metrics Collector
// =============================================================================

/**
 * Metrics collector.
 */
export class MetricsCollector {
  private counters: Map<string, { value: number; labels: Record<string, string> }> = new Map();
  private gauges: Map<string, { value: number; labels: Record<string, string> }> = new Map();
  private histograms: Map<string, { values: number[]; labels: Record<string, string> }> = new Map();
  private logs: LogEntry[] = [];
  private spans: Map<string, Span> = new Map();
  private exporters: MetricsExporter[] = [];

  private readonly component: string;
  private readonly maxLogs: number;
  private readonly maxSpans: number;

  constructor(component: string, maxLogs: number = 1000, maxSpans: number = 1000) {
    this.component = component;
    this.maxLogs = maxLogs;
    this.maxSpans = maxSpans;
  }

  // ===========================================================================
  // Counters
  // ===========================================================================

  /**
   * Increment a counter.
   */
  increment(name: string, value: number = 1, labels: Record<string, string> = {}): void {
    const key = this.buildKey(name, labels);
    const existing = this.counters.get(key);

    if (existing) {
      existing.value += value;
    } else {
      this.counters.set(key, { value, labels });
    }
  }

  /**
   * Get counter value.
   */
  getCounter(name: string, labels: Record<string, string> = {}): number {
    const key = this.buildKey(name, labels);
    return this.counters.get(key)?.value ?? 0;
  }

  // ===========================================================================
  // Gauges
  // ===========================================================================

  /**
   * Set a gauge value.
   */
  setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.buildKey(name, labels);
    this.gauges.set(key, { value, labels });
  }

  /**
   * Get gauge value.
   */
  getGauge(name: string, labels: Record<string, string> = {}): number {
    const key = this.buildKey(name, labels);
    return this.gauges.get(key)?.value ?? 0;
  }

  // ===========================================================================
  // Histograms
  // ===========================================================================

  /**
   * Record a histogram value.
   */
  recordHistogram(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.buildKey(name, labels);
    const existing = this.histograms.get(key);

    if (existing) {
      existing.values.push(value);
      // Keep only last 1000 values
      if (existing.values.length > 1000) {
        existing.values = existing.values.slice(-1000);
      }
    } else {
      this.histograms.set(key, { values: [value], labels });
    }
  }

  /**
   * Get histogram statistics.
   */
  getHistogramStats(
    name: string,
    labels: Record<string, string> = {}
  ): { count: number; sum: number; avg: number; min: number; max: number; p50: number; p95: number; p99: number } | null {
    const key = this.buildKey(name, labels);
    const histogram = this.histograms.get(key);

    if (!histogram || histogram.values.length === 0) {
      return null;
    }

    const sorted = [...histogram.values].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0);

    return {
      count,
      sum,
      avg: sum / count,
      min: sorted[0]!,
      max: sorted[count - 1]!,
      p50: sorted[Math.floor(count * 0.5)]!,
      p95: sorted[Math.floor(count * 0.95)]!,
      p99: sorted[Math.floor(count * 0.99)]!,
    };
  }

  // ===========================================================================
  // Timers
  // ===========================================================================

  /**
   * Start a timer.
   */
  startTimer(name: string, labels: Record<string, string> = {}): () => number {
    const start = performance.now();
    return () => {
      const duration = performance.now() - start;
      this.recordHistogram(name, duration, labels);
      return duration;
    };
  }

  /**
   * Time an async operation.
   */
  async timeAsync<T>(
    name: string,
    fn: () => Promise<T>,
    labels: Record<string, string> = {}
  ): Promise<T> {
    const endTimer = this.startTimer(name, labels);
    try {
      const result = await fn();
      endTimer();
      return result;
    } catch (error) {
      endTimer();
      throw error;
    }
  }

  // ===========================================================================
  // Logging
  // ===========================================================================

  /**
   * Log a message.
   */
  log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    traceId?: string
  ): void {
    const entry: LogEntry = {
      level,
      message,
      timestamp: Date.now(),
      component: this.component,
    };
    if (context) entry.context = context;
    if (traceId) entry.trace_id = traceId;

    this.logs.push(entry);

    // Trim logs
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    // Also output to console for development
    const prefix = `[${this.component}]`;
    switch (level) {
      case 'debug':
        // Skip debug in production
        break;
      case 'info':
        console.log(prefix, message, context ?? '');
        break;
      case 'warn':
        console.warn(prefix, message, context ?? '');
        break;
      case 'error':
        console.error(prefix, message, context ?? '');
        break;
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context);
  }

  // ===========================================================================
  // Tracing
  // ===========================================================================

  /**
   * Start a span.
   */
  startSpan(
    operation: string,
    parentSpanId?: string,
    tags: Record<string, string> = {}
  ): Span {
    const span: Span = {
      trace_id: parentSpanId ? this.getSpan(parentSpanId)?.trace_id ?? this.generateId() : this.generateId(),
      span_id: this.generateId(),
      operation,
      start_time: Date.now(),
      tags,
      events: [],
      status: 'pending',
    };
    if (parentSpanId) span.parent_span_id = parentSpanId;

    this.spans.set(span.span_id, span);

    // Trim old spans
    if (this.spans.size > this.maxSpans) {
      const toDelete = Array.from(this.spans.keys()).slice(0, this.spans.size - this.maxSpans);
      for (const key of toDelete) {
        this.spans.delete(key);
      }
    }

    return span;
  }

  /**
   * End a span.
   */
  endSpan(spanId: string, status: 'ok' | 'error' = 'ok', error?: string): void {
    const span = this.spans.get(spanId);
    if (span) {
      span.end_time = Date.now();
      span.status = status;
      if (error) span.error = error;
    }
  }

  /**
   * Add event to span.
   */
  addSpanEvent(spanId: string, name: string, attributes?: Record<string, unknown>): void {
    const span = this.spans.get(spanId);
    if (span) {
      const event: { name: string; timestamp: number; attributes?: Record<string, unknown> } = {
        name,
        timestamp: Date.now(),
      };
      if (attributes) event.attributes = attributes;
      span.events.push(event);
    }
  }

  /**
   * Get a span.
   */
  getSpan(spanId: string): Span | undefined {
    return this.spans.get(spanId);
  }

  // ===========================================================================
  // Export
  // ===========================================================================

  /**
   * Add an exporter.
   */
  addExporter(exporter: MetricsExporter): void {
    this.exporters.push(exporter);
  }

  /**
   * Export all metrics.
   */
  async export(): Promise<void> {
    const metrics = this.collectMetrics();
    const logs = [...this.logs];
    const spans = Array.from(this.spans.values()).filter((s) => s.status !== 'pending');

    for (const exporter of this.exporters) {
      await exporter.exportMetrics(metrics);
      await exporter.exportLogs(logs);
      await exporter.exportSpans(spans);
    }
  }

  /**
   * Get all metrics as array.
   */
  collectMetrics(): MetricValue[] {
    const metrics: MetricValue[] = [];
    const now = Date.now();

    // Counters
    for (const [key, data] of this.counters.entries()) {
      const name = key.split('|')[0]!;
      metrics.push({
        name,
        type: 'counter',
        value: data.value,
        labels: data.labels,
        timestamp: now,
      });
    }

    // Gauges
    for (const [key, data] of this.gauges.entries()) {
      const name = key.split('|')[0]!;
      metrics.push({
        name,
        type: 'gauge',
        value: data.value,
        labels: data.labels,
        timestamp: now,
      });
    }

    // Histograms (export avg)
    for (const [key, data] of this.histograms.entries()) {
      const name = key.split('|')[0]!;
      if (data.values.length > 0) {
        const avg = data.values.reduce((a, b) => a + b, 0) / data.values.length;
        metrics.push({
          name,
          type: 'histogram',
          value: avg,
          labels: data.labels,
          timestamp: now,
        });
      }
    }

    return metrics;
  }

  /**
   * Get logs.
   */
  getLogs(level?: LogLevel, limit?: number): LogEntry[] {
    let logs = this.logs;
    if (level) {
      logs = logs.filter((l) => l.level === level);
    }
    if (limit) {
      logs = logs.slice(-limit);
    }
    return logs;
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  private buildKey(name: string, labels: Record<string, string>): string {
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return `${name}|${labelStr}`;
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15);
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a metrics collector.
 */
export function createMetricsCollector(component: string): MetricsCollector {
  return new MetricsCollector(component);
}

/**
 * Console exporter for development.
 */
export class ConsoleExporter implements MetricsExporter {
  async exportMetrics(metrics: MetricValue[]): Promise<void> {
    if (metrics.length > 0) {
      console.log('[Metrics]', JSON.stringify(metrics, null, 2));
    }
  }

  async exportLogs(_logs: LogEntry[]): Promise<void> {
    // Already logged to console
  }

  async exportSpans(spans: Span[]): Promise<void> {
    for (const span of spans) {
      const duration = span.end_time ? span.end_time - span.start_time : 0;
      console.log(
        `[Trace] ${span.operation}: ${span.status} (${duration}ms)`,
        span.tags
      );
    }
  }
}
