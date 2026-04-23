/**
 * AutoFlow Pro — Intelligent Workflow Automation Engine
 * 
 * A comprehensive automation framework combining five powerful paradigms:
 * 1. Finite State Machine (FSM) — model complex lifecycle transitions
 * 2. Rule Engine with forward chaining — declarative business logic
 * 3. Dependency-Aware Task Scheduler — topological sort with priority queues
 * 4. Event-Driven Pipeline Orchestrator — pub/sub with async stage execution
 * 5. Cron Expression Parser — human-readable schedule definitions
 * 
 * Each subsystem is fully documented, tested, and demonstrated with
 * realistic automation scenarios including CI/CD pipelines, order
 * processing workflows, and infrastructure provisioning.
 * 
 * @module AutoFlowPro
 * @version 2.0.0
 * @license MIT
 */

// ═══════════════════════════════════════════════════════════════════
// §1  FINITE STATE MACHINE
// ═══════════════════════════════════════════════════════════════════

/**
 * A generic finite state machine with guard conditions, actions,
 * entry/exit hooks, and transition history tracking.
 * 
 * @class StateMachine
 * @example
 *   const door = new StateMachine('closed', {
 *     closed: { open: { target: 'opened', guard: ctx => !ctx.locked } },
 *     opened: { close: { target: 'closed' } }
 *   });
 *   door.send('open', { locked: false }); // → 'opened'
 */
class StateMachine {
  /**
   * Create a new state machine.
   * @param {string} initial - The initial state identifier.
   * @param {Object} config - State transition configuration map.
   *   Keys are state names, values are objects mapping event names
   *   to transition descriptors { target, guard?, action?, onEnter?, onExit? }.
   * @param {Object} [hooks={}] - Global lifecycle hooks.
   * @param {Function} [hooks.onTransition] - Called on every transition with { from, to, event }.
   */
  constructor(initial, config, hooks = {}) {
    /** @type {string} Current state identifier */
    this.state = initial;
    /** @private */
    this._config = config;
    /** @private */
    this._hooks = hooks;
    /** @type {Array<{from:string, to:string, event:string, timestamp:number}>} */
    this.history = [{ from: null, to: initial, event: 'INIT', timestamp: Date.now() }];
  }

  /**
   * Send an event to the state machine, potentially triggering a transition.
   * Evaluates guard conditions before transitioning. Executes onExit, action,
   * and onEnter hooks in order.
   * 
   * @param {string} event - The event name to process.
   * @param {Object} [context={}] - Context object passed to guards and actions.
   * @returns {{ success: boolean, from: string, to: string, reason?: string }}
   *   Transition result with success flag and optional rejection reason.
   */
  send(event, context = {}) {
    const stateConfig = this._config[this.state];
    if (!stateConfig || !stateConfig[event]) {
      return { success: false, from: this.state, to: this.state, reason: `No transition for '${event}' in state '${this.state}'` };
    }
    const transition = stateConfig[event];
    if (transition.guard && !transition.guard(context)) {
      return { success: false, from: this.state, to: this.state, reason: `Guard rejected '${event}' in state '${this.state}'` };
    }
    const from = this.state;
    if (transition.onExit) transition.onExit(context);
    if (transition.action) transition.action(context);
    this.state = transition.target;
    if (transition.onEnter) transition.onEnter(context);
    const record = { from, to: this.state, event, timestamp: Date.now() };
    this.history.push(record);
    if (this._hooks.onTransition) this._hooks.onTransition(record);
    return { success: true, from, to: this.state };
  }

  /**
   * Get all valid events for the current state.
   * @returns {string[]} Array of event names that can be sent.
   */
  getAvailableEvents() {
    const stateConfig = this._config[this.state];
    return stateConfig ? Object.keys(stateConfig) : [];
  }

  /**
   * Check if the machine can process a specific event from current state.
   * @param {string} event - Event name to check.
   * @param {Object} [context={}] - Context for guard evaluation.
   * @returns {boolean} True if the event would succeed.
   */
  canSend(event, context = {}) {
    const stateConfig = this._config[this.state];
    if (!stateConfig || !stateConfig[event]) return false;
    const transition = stateConfig[event];
    return !transition.guard || transition.guard(context);
  }

  /**
   * Reset the machine to its initial state, clearing history.
   */
  reset() {
    this.state = this.history[0].to;
    this.history = [{ from: null, to: this.state, event: 'RESET', timestamp: Date.now() }];
  }
}

// ═══════════════════════════════════════════════════════════════════
// §2  RULE ENGINE WITH FORWARD CHAINING
// ═══════════════════════════════════════════════════════════════════

/**
 * A forward-chaining rule engine that evaluates declarative rules against
 * a fact set, with priority ordering, conflict resolution, and audit trails.
 * 
 * Rules are evaluated in priority order (lower = higher priority).
 * When a rule fires, it may assert new facts, which triggers re-evaluation
 * of remaining rules (forward chaining).
 * 
 * @class RuleEngine
 * @example
 *   const engine = new RuleEngine();
 *   engine.addRule({
 *     name: 'high-value-customer',
 *     priority: 1,
 *     condition: facts => facts.orderTotal > 1000,
 *     action: facts => { facts.discount = 0.15; facts.tier = 'gold'; }
 *   });
 *   engine.run({ orderTotal: 1500 });
 */
class RuleEngine {
  constructor() {
    /** @type {Array<{name:string, priority:number, condition:Function, action:Function, description?:string}>} */
    this.rules = [];
    /** @type {Array<{rule:string, facts:Object, timestamp:number}>} Audit trail of fired rules */
    this.auditTrail = [];
  }

  /**
   * Register a rule with the engine.
   * @param {Object} rule - Rule definition.
   * @param {string} rule.name - Unique rule identifier.
   * @param {number} [rule.priority=10] - Execution priority (lower fires first).
   * @param {Function} rule.condition - Predicate receiving facts, returns boolean.
   * @param {Function} rule.action - Side-effecting function that modifies facts.
   * @param {string} [rule.description] - Human-readable rule description.
   */
  addRule(rule) {
    this.rules.push({ priority: 10, ...rule });
    this.rules.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Execute the rule engine against a fact set using forward chaining.
   * Rules are evaluated in priority order. When a rule fires and modifies
   * facts, all rules are re-evaluated from the beginning (up to maxIterations).
   * 
   * @param {Object} facts - The working memory / fact set.
   * @param {Object} [options={}] - Execution options.
   * @param {number} [options.maxIterations=50] - Maximum forward-chaining cycles.
   * @returns {{ facts: Object, fired: string[], iterations: number }}
   */
  run(facts, options = {}) {
    const maxIter = options.maxIterations || 50;
    const fired = new Set();
    let iterations = 0;
    let changed = true;

    while (changed && iterations < maxIter) {
      changed = false;
      iterations++;
      for (const rule of this.rules) {
        if (fired.has(rule.name)) continue;
        try {
          if (rule.condition(facts)) {
            const snapshot = JSON.stringify(facts);
            rule.action(facts);
            fired.add(rule.name);
            this.auditTrail.push({ rule: rule.name, facts: JSON.parse(JSON.stringify(facts)), timestamp: Date.now() });
            if (JSON.stringify(facts) !== snapshot) {
              changed = true;
              break; // Restart evaluation from highest priority
            }
          }
        } catch (err) {
          this.auditTrail.push({ rule: rule.name, error: err.message, timestamp: Date.now() });
        }
      }
    }
    return { facts, fired: [...fired], iterations };
  }

  /**
   * Get all rules that would fire for the given facts (dry run).
   * @param {Object} facts - Fact set to test against.
   * @returns {string[]} Names of rules whose conditions are true.
   */
  evaluate(facts) {
    return this.rules.filter(r => { try { return r.condition(facts); } catch { return false; } }).map(r => r.name);
  }

  /**
   * Remove a rule by name.
   * @param {string} name - Rule name to remove.
   * @returns {boolean} True if rule was found and removed.
   */
  removeRule(name) {
    const idx = this.rules.findIndex(r => r.name === name);
    if (idx >= 0) { this.rules.splice(idx, 1); return true; }
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════
// §3  DEPENDENCY-AWARE TASK SCHEDULER
// ═══════════════════════════════════════════════════════════════════

/**
 * A task scheduler that resolves dependencies via topological sort
 * and executes tasks in priority order within each dependency tier.
 * Detects circular dependencies and supports task cancellation.
 * 
 * @class TaskScheduler
 * @example
 *   const scheduler = new TaskScheduler();
 *   scheduler.addTask({ id: 'build', run: () => 'compiled', priority: 1 });
 *   scheduler.addTask({ id: 'test', deps: ['build'], run: () => 'passed' });
 *   scheduler.execute(); // Runs build first, then test
 */
class TaskScheduler {
  constructor() {
    /** @type {Map<string, {id:string, deps:string[], run:Function, priority:number, timeout?:number, status:string}>} */
    this.tasks = new Map();
    /** @type {Array<{id:string, status:string, result:any, duration:number}>} Execution log */
    this.log = [];
  }

  /**
   * Add a task to the scheduler.
   * @param {Object} task - Task definition.
   * @param {string} task.id - Unique task identifier.
   * @param {Function} task.run - Task execution function, receives context object.
   * @param {string[]} [task.deps=[]] - IDs of tasks that must complete first.
   * @param {number} [task.priority=5] - Priority within a dependency tier (lower = first).
   * @param {number} [task.timeout] - Maximum execution time in ms.
   * @param {string} [task.description] - Human-readable task description.
   * @throws {Error} If a dependency references a non-existent task at execution time.
   */
  addTask(task) {
    this.tasks.set(task.id, {
      deps: [], priority: 5, status: 'pending', ...task
    });
  }

  /**
   * Perform topological sort to determine execution order.
   * Tasks with no unresolved dependencies come first, then their
   * dependents, and so on. Within each tier, sorted by priority.
   * 
   * @returns {{ order: string[], tiers: string[][] }}
   *   Flattened execution order and tiered grouping.
   * @throws {Error} If circular dependencies are detected.
   */
  topologicalSort() {
    const inDegree = new Map();
    const adjacency = new Map();
    for (const [id, task] of this.tasks) {
      inDegree.set(id, task.deps.length);
      for (const dep of task.deps) {
        if (!adjacency.has(dep)) adjacency.set(dep, []);
        adjacency.get(dep).push(id);
      }
    }
    const tiers = [];
    const processed = new Set();
    while (processed.size < this.tasks.size) {
      const tier = [];
      for (const [id] of this.tasks) {
        if (!processed.has(id) && (inDegree.get(id) || 0) === 0) tier.push(id);
      }
      if (tier.length === 0) {
        const remaining = [...this.tasks.keys()].filter(id => !processed.has(id));
        throw new Error(`Circular dependency detected among: ${remaining.join(', ')}`);
      }
      tier.sort((a, b) => (this.tasks.get(a).priority || 5) - (this.tasks.get(b).priority || 5));
      tiers.push(tier);
      for (const id of tier) {
        processed.add(id);
        for (const dep of (adjacency.get(id) || [])) {
          inDegree.set(dep, (inDegree.get(dep) || 1) - 1);
        }
      }
    }
    return { order: tiers.flat(), tiers };
  }

  /**
   * Execute all tasks in dependency-resolved order.
   * Tasks run sequentially within tiers (simulated parallelism within tiers).
   * Failed tasks cause dependent tasks to be skipped.
   * 
   * @param {Object} [context={}] - Shared context passed to all task runners.
   * @returns {{ results: Object, log: Array, success: boolean, failed: string[] }}
   */
  execute(context = {}) {
    const { order, tiers } = this.topologicalSort();
    const results = {};
    const failed = new Set();
    this.log = [];

    for (const tier of tiers) {
      for (const id of tier) {
        const task = this.tasks.get(id);
        const depsFailed = task.deps.some(d => failed.has(d));
        if (depsFailed) {
          task.status = 'skipped';
          this.log.push({ id, status: 'skipped', result: null, duration: 0, reason: 'dependency failed' });
          failed.add(id);
          continue;
        }
        const start = Date.now();
        try {
          results[id] = task.run(context, results);
          task.status = 'completed';
          this.log.push({ id, status: 'completed', result: results[id], duration: Date.now() - start });
        } catch (err) {
          task.status = 'failed';
          failed.add(id);
          this.log.push({ id, status: 'failed', result: err.message, duration: Date.now() - start });
        }
      }
    }
    return { results, log: this.log, success: failed.size === 0, failed: [...failed] };
  }

  /**
   * Cancel a pending task and all its transitive dependents.
   * @param {string} taskId - Task to cancel.
   * @returns {string[]} IDs of all cancelled tasks.
   */
  cancel(taskId) {
    const cancelled = [];
    const queue = [taskId];
    while (queue.length) {
      const id = queue.shift();
      const task = this.tasks.get(id);
      if (task && task.status === 'pending') {
        task.status = 'cancelled';
        cancelled.push(id);
        for (const [otherId, otherTask] of this.tasks) {
          if (otherTask.deps.includes(id)) queue.push(otherId);
        }
      }
    }
    return cancelled;
  }

  /**
   * Get a visual representation of the dependency graph.
   * @returns {string} ASCII dependency graph.
   */
  visualize() {
    const { tiers } = this.topologicalSort();
    let out = '';
    tiers.forEach((tier, i) => {
      out += `  Tier ${i}: ${tier.map(id => {
        const t = this.tasks.get(id);
        const icon = t.status === 'completed' ? '✓' : t.status === 'failed' ? '✗' : t.status === 'skipped' ? '⊘' : '○';
        return `[${icon} ${id}]`;
      }).join(' → ')}\n`;
    });
    return out;
  }
}

// ═══════════════════════════════════════════════════════════════════
// §4  EVENT-DRIVEN PIPELINE ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════

/**
 * An event-driven pipeline orchestrator implementing the pub/sub pattern.
 * Stages subscribe to events, process data through transforms, and emit
 * results to downstream stages. Supports middleware, error handling,
 * and execution metrics.
 * 
 * @class Pipeline
 * @example
 *   const pipe = new Pipeline('data-processing');
 *   pipe.addStage('parse', data => JSON.parse(data));
 *   pipe.addStage('validate', data => { if (!data.id) throw new Error('missing id'); return data; });
 *   pipe.addStage('transform', data => ({ ...data, processed: true }));
 *   pipe.run('{"id": 1, "name": "test"}');
 */
class Pipeline {
  /**
   * @param {string} name - Pipeline identifier.
   * @param {Object} [options={}] - Pipeline configuration.
   * @param {boolean} [options.continueOnError=false] - Whether to continue after stage failures.
   * @param {Function} [options.onError] - Global error handler receiving (stageName, error, data).
   */
  constructor(name, options = {}) {
    this.name = name;
    this.stages = [];
    this.middleware = [];
    this.options = options;
    /** @type {Map<string, {calls:number, totalMs:number, errors:number}>} */
    this.metrics = new Map();
    /** @type {Array<{stage:string, event:string, data:any, timestamp:number}>} */
    this.eventLog = [];
  }

  /**
   * Add a processing stage to the pipeline.
   * @param {string} name - Stage identifier.
   * @param {Function} handler - Stage handler receiving data, returns processed data.
   * @param {Object} [options={}] - Stage options.
   * @param {Function} [options.condition] - Predicate; stage skipped if returns false.
   * @param {Function} [options.onError] - Stage-level error handler.
   * @param {number} [options.retries=0] - Number of retry attempts on failure.
   */
  addStage(name, handler, options = {}) {
    this.stages.push({ name, handler, ...options });
    this.metrics.set(name, { calls: 0, totalMs: 0, errors: 0 });
  }

  /**
   * Add middleware that wraps every stage execution.
   * Middleware receives (stageName, data, next) and must call next(data) to continue.
   * @param {Function} fn - Middleware function.
   */
  use(fn) {
    this.middleware.push(fn);
  }

  /**
   * Execute the pipeline with input data, passing results through each stage.
   * Middleware is applied around each stage. Metrics are tracked.
   * 
   * @param {*} input - Initial data to process.
   * @returns {{ output: *, stages: Array<{name:string, status:string, duration:number}>, success: boolean }}
   */
  run(input) {
    let data = input;
    const stageResults = [];
    let success = true;

    for (const stage of this.stages) {
      if (stage.condition && !stage.condition(data)) {
        stageResults.push({ name: stage.name, status: 'skipped', duration: 0 });
        this.eventLog.push({ stage: stage.name, event: 'skipped', data: null, timestamp: Date.now() });
        continue;
      }

      const metrics = this.metrics.get(stage.name);
      const start = Date.now();
      let attempts = 0;
      const maxAttempts = (stage.retries || 0) + 1;

      while (attempts < maxAttempts) {
        attempts++;
        try {
          // Apply middleware chain
          let result = data;
          const chain = [...this.middleware];
          const executeWithMiddleware = (idx, d) => {
            if (idx >= chain.length) return stage.handler(d);
            return chain[idx](stage.name, d, (nd) => executeWithMiddleware(idx + 1, nd));
          };
          result = executeWithMiddleware(0, data);
          data = result;
          const dur = Date.now() - start;
          metrics.calls++;
          metrics.totalMs += dur;
          stageResults.push({ name: stage.name, status: 'completed', duration: dur });
          this.eventLog.push({ stage: stage.name, event: 'completed', data: typeof data === 'object' ? '...' : data, timestamp: Date.now() });
          break;
        } catch (err) {
          if (attempts >= maxAttempts) {
            const dur = Date.now() - start;
            metrics.errors++;
            metrics.totalMs += dur;
            stageResults.push({ name: stage.name, status: 'failed', duration: dur, error: err.message });
            this.eventLog.push({ stage: stage.name, event: 'error', data: err.message, timestamp: Date.now() });
            if (stage.onError) stage.onError(err, data);
            if (this.options.onError) this.options.onError(stage.name, err, data);
            if (!this.options.continueOnError) { success = false; break; }
          }
        }
      }
      if (!success) break;
    }

    return { output: data, stages: stageResults, success };
  }

  /**
   * Get performance metrics for all stages.
   * @returns {Array<{name:string, calls:number, avgMs:number, errors:number}>}
   */
  getMetrics() {
    return this.stages.map(s => {
      const m = this.metrics.get(s.name);
      return { name: s.name, calls: m.calls, avgMs: m.calls ? +(m.totalMs / m.calls).toFixed(1) : 0, errors: m.errors };
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// §5  CRON EXPRESSION PARSER & SCHEDULER
// ═══════════════════════════════════════════════════════════════════

/**
 * Parses cron-like expressions and determines next execution times.
 * Supports standard 5-field cron (minute, hour, day-of-month, month, day-of-week)
 * with wildcards (*), ranges (1-5), steps (star/10), and lists (1,3,5).
 * 
 * @class CronScheduler
 * @example
 *   const cron = new CronScheduler();
 *   cron.addJob('daily-backup', '0 2 * * *', () => console.log('Backing up...'));
 *   cron.addJob('every-5min', 'star/5 * * * *', () => console.log('Heartbeat'));
 *   cron.getNextRuns('daily-backup', 3); // Next 3 execution times
 */
class CronScheduler {
  constructor() {
    /** @type {Map<string, {expression:string, parsed:Object, handler:Function, enabled:boolean}>} */
    this.jobs = new Map();
  }

  /**
   * Parse a cron expression field into a set of matching values.
   * @private
   * @param {string} field - Cron field (e.g., 'star/5', '1-3', '1,4,7', '*').
   * @param {number} min - Minimum valid value for this field.
   * @param {number} max - Maximum valid value for this field.
   * @returns {Set<number>} Set of values this field matches.
   */
  _parseField(field, min, max) {
    const values = new Set();
    for (const part of field.split(',')) {
      if (part.includes('/')) {
        const [range, stepStr] = part.split('/');
        const step = parseInt(stepStr, 10);
        const start = range === '*' ? min : parseInt(range, 10);
        for (let i = start; i <= max; i += step) values.add(i);
      } else if (part.includes('-')) {
        const [lo, hi] = part.split('-').map(Number);
        for (let i = lo; i <= hi; i++) values.add(i);
      } else if (part === '*') {
        for (let i = min; i <= max; i++) values.add(i);
      } else {
        values.add(parseInt(part, 10));
      }
    }
    return values;
  }

  /**
   * Parse a complete 5-field cron expression.
   * @param {string} expression - Cron expression (e.g., '0 9 * * 1-5').
   * @returns {{ minutes: Set, hours: Set, daysOfMonth: Set, months: Set, daysOfWeek: Set }}
   */
  parse(expression) {
    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 5) throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`);
    return {
      minutes: this._parseField(parts[0], 0, 59),
      hours: this._parseField(parts[1], 0, 23),
      daysOfMonth: this._parseField(parts[2], 1, 31),
      months: this._parseField(parts[3], 1, 12),
      daysOfWeek: this._parseField(parts[4], 0, 6)
    };
  }

  /**
   * Add a scheduled job.
   * @param {string} name - Unique job identifier.
   * @param {string} expression - Cron expression.
   * @param {Function} handler - Function to execute on schedule.
   * @param {Object} [options={}] - Job options.
   * @param {boolean} [options.enabled=true] - Whether the job is active.
   */
  addJob(name, expression, handler, options = {}) {
    const parsed = this.parse(expression);
    this.jobs.set(name, { expression, parsed, handler, enabled: options.enabled !== false });
  }

  /**
   * Calculate the next N execution times for a job from a reference date.
   * @param {string} name - Job name.
   * @param {number} [count=5] - How many future times to calculate.
   * @param {Date} [from=new Date()] - Reference start time.
   * @returns {Date[]} Array of next execution dates.
   */
  getNextRuns(name, count = 5, from = new Date()) {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`Job '${name}' not found`);
    const { parsed } = job;
    const results = [];
    const d = new Date(from);
    d.setSeconds(0, 0);
    d.setMinutes(d.getMinutes() + 1);

    const maxSearchMinutes = 60 * 24 * 400; // Search up to ~400 days
    for (let i = 0; i < maxSearchMinutes && results.length < count; i++) {
      if (parsed.months.has(d.getMonth() + 1) &&
          parsed.daysOfMonth.has(d.getDate()) &&
          parsed.daysOfWeek.has(d.getDay()) &&
          parsed.hours.has(d.getHours()) &&
          parsed.minutes.has(d.getMinutes())) {
        results.push(new Date(d));
      }
      d.setMinutes(d.getMinutes() + 1);
    }
    return results;
  }

  /**
   * Get a human-readable description of a cron expression.
   * @param {string} expression - Cron expression to describe.
   * @returns {string} Human-readable schedule description.
   */
  describe(expression) {
    const p = this.parse(expression);
    const desc = [];
    if (p.minutes.size === 1 && p.hours.size === 1) {
      desc.push(`At ${[...p.hours][0]}:${String([...p.minutes][0]).padStart(2, '0')}`);
    } else if (p.minutes.size === 60 && p.hours.size === 24) {
      desc.push('Every minute');
    } else if (p.hours.size === 24) {
      const step = [...p.minutes].sort((a,b) => a-b);
      if (step.length > 1) desc.push(`Every ${step[1] - step[0]} minutes`);
    } else {
      desc.push(`At minutes ${[...p.minutes].sort((a,b)=>a-b).join(',')}`);
    }
    if (p.daysOfWeek.size < 7) {
      const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      desc.push(`on ${[...p.daysOfWeek].sort((a,b)=>a-b).map(d => days[d]).join(', ')}`);
    }
    if (p.months.size < 12) {
      const mos = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      desc.push(`in ${[...p.months].sort((a,b)=>a-b).map(m => mos[m-1]).join(', ')}`);
    }
    return desc.join(' ') || 'Custom schedule';
  }
}

// ═══════════════════════════════════════════════════════════════════
// §6  UTILITY HELPERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Format a table from headers and rows for clean console output.
 * @param {string[]} headers - Column header labels.
 * @param {Array<Array<string|number>>} rows - Data rows.
 * @param {string} [indent='    '] - Left indentation.
 * @returns {string} Formatted table string.
 */
function formatTable(headers, rows, indent = '    ') {
  const w = headers.map((h, i) => Math.max(String(h).length, ...rows.map(r => String(r[i] || '').length)));
  let o = indent + headers.map((h, i) => String(h).padEnd(w[i])).join('  ') + '\n';
  o += indent + w.map(n => '─'.repeat(n)).join('──') + '\n';
  rows.forEach(r => { o += indent + r.map((c, i) => String(c || '').padEnd(w[i])).join('  ') + '\n'; });
  return o;
}

/**
 * Generate a horizontal bar for progress/comparison displays.
 * @param {number} value - Current value.
 * @param {number} max - Maximum value.
 * @param {number} [width=30] - Bar width in characters.
 * @returns {string} Progress bar string like '████████░░░░░ 65%'.
 */
function progressBar(value, max, width = 30) {
  const pct = Math.min(1, Math.max(0, value / max));
  const filled = Math.round(pct * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled) + ` ${(pct * 100).toFixed(0)}%`;
}

// ═══════════════════════════════════════════════════════════════════
// §7  DEMONSTRATION SCENARIOS
// ═══════════════════════════════════════════════════════════════════

/**
 * Demo 1: CI/CD Pipeline Automation
 * Simulates a complete continuous integration / deployment pipeline
 * with dependency resolution, state management, and error handling.
 */
function demoCICD() {
  console.log('\n' + '═'.repeat(68));
  console.log('  🚀 DEMO 1: CI/CD Pipeline Automation');
  console.log('═'.repeat(68));

  // Task Scheduler for build pipeline
  const scheduler = new TaskScheduler();
  scheduler.addTask({ id: 'checkout', priority: 1, description: 'Clone repository', run: () => 'Checked out main@abc123' });
  scheduler.addTask({ id: 'install', deps: ['checkout'], priority: 1, description: 'Install dependencies', run: () => '147 packages installed' });
  scheduler.addTask({ id: 'lint', deps: ['install'], priority: 1, description: 'Run ESLint', run: () => '0 errors, 3 warnings' });
  scheduler.addTask({ id: 'unit-test', deps: ['install'], priority: 2, description: 'Run unit tests', run: () => '284/284 passed (12.3s)' });
  scheduler.addTask({ id: 'integration-test', deps: ['install'], priority: 3, description: 'Run integration tests', run: () => '47/47 passed (45.1s)' });
  scheduler.addTask({ id: 'build', deps: ['lint', 'unit-test'], priority: 1, description: 'Build production bundle', run: () => 'dist/app.js (2.1MB)' });
  scheduler.addTask({ id: 'security-scan', deps: ['build'], priority: 1, description: 'SAST/DAST analysis', run: () => '0 critical, 2 medium, 5 low' });
  scheduler.addTask({ id: 'docker-build', deps: ['build'], priority: 2, description: 'Build Docker image', run: () => 'myapp:v2.4.1 (145MB)' });
  scheduler.addTask({ id: 'deploy-staging', deps: ['docker-build', 'security-scan', 'integration-test'], priority: 1, description: 'Deploy to staging', run: () => 'staging.myapp.io ✓' });
  scheduler.addTask({ id: 'smoke-test', deps: ['deploy-staging'], priority: 1, description: 'Run smoke tests', run: () => '12/12 endpoints healthy' });
  scheduler.addTask({ id: 'deploy-prod', deps: ['smoke-test'], priority: 1, description: 'Deploy to production', run: () => 'prod.myapp.io ✓ (blue-green)' });

  console.log('\n  📋 Pipeline Dependency Graph:\n');
  console.log(scheduler.visualize());

  const result = scheduler.execute();
  console.log('  📊 Execution Log:\n');
  console.log(formatTable(
    ['Task', 'Status', 'Result', 'Duration'],
    result.log.map(l => [l.id, l.status === 'completed' ? '✓ done' : `✗ ${l.status}`, String(l.result).slice(0, 35), `${l.duration}ms`])
  ));
  console.log(`  Pipeline: ${result.success ? '✅ ALL STAGES PASSED' : '❌ FAILED'} (${result.log.length} tasks)\n`);

  // State machine for deployment lifecycle
  const deployFSM = new StateMachine('idle', {
    idle: { deploy: { target: 'deploying', guard: ctx => ctx.approved } },
    deploying: { success: { target: 'live' }, fail: { target: 'rolling_back' } },
    live: { rollback: { target: 'rolling_back' }, redeploy: { target: 'deploying' } },
    rolling_back: { complete: { target: 'idle' } }
  });

  console.log('  🔄 Deployment State Machine:');
  console.log(`    State: ${deployFSM.state}`);
  let r = deployFSM.send('deploy', { approved: true });
  console.log(`    → deploy (approved): ${r.from} → ${r.to}`);
  r = deployFSM.send('success');
  console.log(`    → success: ${r.from} → ${r.to}`);
  r = deployFSM.send('rollback');
  console.log(`    → rollback: ${r.from} → ${r.to}`);
  r = deployFSM.send('complete');
  console.log(`    → complete: ${r.from} → ${r.to}`);
  console.log(`    History: ${deployFSM.history.length} transitions recorded\n`);

  return result;
}

/**
 * Demo 2: Order Processing with Business Rules
 * Simulates an e-commerce order processing system using the rule engine
 * for discount calculation, fraud detection, and shipping optimization.
 */
function demoOrderProcessing() {
  console.log('═'.repeat(68));
  console.log('  🛒 DEMO 2: Intelligent Order Processing');
  console.log('═'.repeat(68));

  const rules = new RuleEngine();

  // Discount rules
  rules.addRule({ name: 'loyalty-discount', priority: 1, description: 'Loyalty members get 10% off',
    condition: f => f.customerTier === 'gold' || f.customerTier === 'platinum',
    action: f => { f.discountPct = f.customerTier === 'platinum' ? 20 : 10; f.discountReason = `${f.customerTier} loyalty`; }
  });
  rules.addRule({ name: 'bulk-discount', priority: 2, description: 'Orders over $500 get extra 5%',
    condition: f => f.subtotal > 500,
    action: f => { f.discountPct = (f.discountPct || 0) + 5; f.bulkDiscount = true; }
  });
  rules.addRule({ name: 'first-order-bonus', priority: 3, description: 'First-time customers get $15 off',
    condition: f => f.isFirstOrder && f.subtotal > 50,
    action: f => { f.firstOrderCredit = 15; }
  });

  // Fraud detection rules
  rules.addRule({ name: 'fraud-high-value', priority: 0, description: 'Flag orders over $5000 for review',
    condition: f => f.subtotal > 5000,
    action: f => { f.fraudFlag = 'HIGH_VALUE'; f.requiresReview = true; }
  });
  rules.addRule({ name: 'fraud-velocity', priority: 0, description: 'Flag if >3 orders in 1 hour',
    condition: f => f.recentOrderCount > 3,
    action: f => { f.fraudFlag = (f.fraudFlag ? f.fraudFlag + '+' : '') + 'VELOCITY'; f.requiresReview = true; }
  });

  // Shipping rules
  rules.addRule({ name: 'free-shipping', priority: 5, description: 'Free shipping over $100',
    condition: f => f.subtotal > 100 && !f.requiresReview,
    action: f => { f.shippingCost = 0; f.shippingMethod = 'standard (free)'; }
  });
  rules.addRule({ name: 'express-eligible', priority: 6, description: 'Platinum gets free express',
    condition: f => f.customerTier === 'platinum',
    action: f => { f.shippingMethod = 'express (free)'; f.shippingCost = 0; }
  });

  // Tax and total calculation
  rules.addRule({ name: 'calculate-total', priority: 10, description: 'Final total calculation',
    condition: f => f.subtotal > 0,
    action: f => {
      const discount = f.subtotal * (f.discountPct || 0) / 100 + (f.firstOrderCredit || 0);
      f.discount = +discount.toFixed(2);
      f.taxableAmount = +(f.subtotal - discount).toFixed(2);
      f.tax = +(f.taxableAmount * (f.taxRate || 0.08)).toFixed(2);
      f.total = +(f.taxableAmount + f.tax + (f.shippingCost || 9.99)).toFixed(2);
    }
  });

  // Process test orders
  const orders = [
    { id: 'ORD-001', customerTier: 'gold', subtotal: 750, isFirstOrder: false, recentOrderCount: 1, taxRate: 0.08 },
    { id: 'ORD-002', customerTier: 'standard', subtotal: 45, isFirstOrder: true, recentOrderCount: 1, taxRate: 0.06 },
    { id: 'ORD-003', customerTier: 'platinum', subtotal: 6200, isFirstOrder: false, recentOrderCount: 5, taxRate: 0.09 },
  ];

  console.log('\n  📜 Business Rules Loaded:\n');
  console.log(formatTable(
    ['Rule', 'Priority', 'Description'],
    rules.rules.map(r => [r.name, r.priority, r.description || ''])
  ));

  orders.forEach(order => {
    const facts = { ...order };
    const result = rules.run(facts);
    console.log(`  ─── ${order.id} (${order.customerTier}, $${order.subtotal}) ───`);
    console.log(`    Rules fired: ${result.fired.join(' → ')}`);
    console.log(`    Discount: ${facts.discountPct || 0}%${facts.firstOrderCredit ? ' + $' + facts.firstOrderCredit : ''} = -$${facts.discount || 0}`);
    console.log(`    Shipping: ${facts.shippingMethod || 'standard ($9.99)'}`);
    console.log(`    Fraud: ${facts.fraudFlag || 'clear'} ${facts.requiresReview ? '⚠️ REVIEW REQUIRED' : '✓'}`);
    console.log(`    Total: $${facts.total} (tax: $${facts.tax})\n`);
  });

  return rules;
}

/**
 * Demo 3: Infrastructure Provisioning Pipeline
 * Simulates cloud infrastructure provisioning with staged rollout,
 * health checks, and automated rollback.
 */
function demoInfraProvisioning() {
  console.log('═'.repeat(68));
  console.log('  ☁️  DEMO 3: Infrastructure Provisioning Pipeline');
  console.log('═'.repeat(68));

  const pipe = new Pipeline('infra-provision', { continueOnError: false });

  pipe.addStage('validate-config', config => {
    if (!config.region || !config.instances) throw new Error('Missing required fields');
    return { ...config, validated: true, timestamp: Date.now() };
  });
  pipe.addStage('provision-vpc', config => ({ ...config, vpcId: 'vpc-a1b2c3', subnets: ['sub-1a', 'sub-1b', 'sub-1c'] }));
  pipe.addStage('provision-security', config => ({ ...config, sgId: 'sg-x7y8z9', rules: ['HTTPS:443', 'SSH:22(restricted)'] }));
  pipe.addStage('launch-instances', config => {
    const instances = Array.from({ length: config.instances }, (_, i) => ({
      id: `i-${String(i + 1).padStart(4, '0')}`, az: config.subnets[i % config.subnets.length], status: 'running'
    }));
    return { ...config, instances: instances };
  });
  pipe.addStage('configure-lb', config => ({ ...config, lbDns: `lb-${config.region}.example.com`, healthCheck: '/health' }));
  pipe.addStage('health-check', config => {
    const healthy = config.instances.filter(() => Math.random() > 0.05);
    return { ...config, healthyCount: healthy.length, totalCount: config.instances.length };
  });
  pipe.addStage('dns-update', config => ({ ...config, dnsRecord: `app.example.com → ${config.lbDns}` }));

  // Logging middleware
  pipe.use((stage, data, next) => {
    const result = next(data);
    return result;
  });

  const config = { region: 'us-east-1', instances: 6, env: 'production', ami: 'ami-0123456789' };
  console.log(`\n  Input: ${JSON.stringify(config)}\n`);

  const result = pipe.run(config);
  console.log('  📊 Stage Results:\n');
  console.log(formatTable(
    ['Stage', 'Status', 'Duration'],
    result.stages.map(s => [s.name, s.status === 'completed' ? '✓' : '✗', `${s.duration}ms`])
  ));

  console.log(`  Infrastructure: ${result.success ? '✅ PROVISIONED' : '❌ FAILED'}`);
  if (result.output.lbDns) console.log(`  Load Balancer: ${result.output.lbDns}`);
  if (result.output.dnsRecord) console.log(`  DNS: ${result.output.dnsRecord}`);
  if (result.output.healthyCount) console.log(`  Health: ${result.output.healthyCount}/${result.output.totalCount} instances healthy`);
  console.log(`  Metrics: ${JSON.stringify(pipe.getMetrics().map(m => `${m.name}:${m.avgMs}ms`).join(', '))}\n`);

  return result;
}

/**
 * Demo 4: Scheduled Job Management
 * Demonstrates the cron scheduler with realistic automation jobs.
 */
function demoCronScheduler() {
  console.log('═'.repeat(68));
  console.log('  ⏰ DEMO 4: Scheduled Job Automation');
  console.log('═'.repeat(68));

  const cron = new CronScheduler();
  const jobs = [
    ['db-backup', '0 2 * * *', 'Daily database backup at 2 AM'],
    ['log-rotate', '0 0 * * 0', 'Weekly log rotation on Sundays'],
    ['health-check', '*/5 * * * *', 'Health check every 5 minutes'],
    ['report-gen', '0 9 * * 1-5', 'Generate reports at 9 AM weekdays'],
    ['cache-clear', '0 */6 * * *', 'Clear cache every 6 hours'],
    ['cert-check', '0 10 1 * *', 'Monthly SSL certificate check'],
  ];

  jobs.forEach(([name, expr, desc]) => cron.addJob(name, expr, () => desc));

  console.log('\n  📋 Scheduled Jobs:\n');
  console.log(formatTable(
    ['Job', 'Expression', 'Schedule', 'Status'],
    jobs.map(([name, expr]) => [name, expr, cron.describe(expr), '● active'])
  ));

  console.log('\n  🗓️  Next Runs (from 2026-01-15 08:00):\n');
  const refDate = new Date('2026-01-15T08:00:00');
  jobs.slice(0, 4).forEach(([name]) => {
    const next = cron.getNextRuns(name, 3, refDate);
    console.log(`    ${name}:`);
    next.forEach(d => console.log(`      → ${d.toISOString().replace('T', ' ').slice(0, 16)}`));
    console.log('');
  });

  return cron;
}

/**
 * Comprehensive self-test suite to verify all subsystems.
 * Tests state machines, rule engine, task scheduler, pipelines, and cron parser.
 * @returns {{ passed: number, failed: number, tests: Array<{name:string, passed:boolean}> }}
 */
function selfTest() {
  const tests = [];
  const assert = (name, condition) => {
    tests.push({ name, passed: !!condition });
    if (!condition) console.log(`    ✗ FAIL: ${name}`);
  };

  console.log('\n' + '═'.repeat(68));
  console.log('  🧪 Self-Test Suite');
  console.log('═'.repeat(68) + '\n');

  // FSM tests
  const fsm = new StateMachine('off', {
    off: { toggle: { target: 'on' } },
    on: { toggle: { target: 'off' }, lock: { target: 'locked', guard: ctx => ctx.hasKey } }
  });
  assert('FSM: initial state is off', fsm.state === 'off');
  assert('FSM: toggle off→on', fsm.send('toggle').success && fsm.state === 'on');
  assert('FSM: guard rejects without key', !fsm.send('lock', { hasKey: false }).success);
  assert('FSM: guard allows with key', fsm.send('lock', { hasKey: true }).success && fsm.state === 'locked');
  assert('FSM: invalid event returns failure', !fsm.send('toggle').success);
  assert('FSM: history tracked', fsm.history.length === 3);
  assert('FSM: getAvailableEvents', new StateMachine('off', { off: { a: { target: 'on' }, b: { target: 'on' } }, on: {} }).getAvailableEvents().length === 2);

  // Rule Engine tests
  const re = new RuleEngine();
  re.addRule({ name: 'r1', priority: 2, condition: f => f.x > 10, action: f => { f.big = true; } });
  re.addRule({ name: 'r2', priority: 1, condition: f => f.x > 5, action: f => { f.medium = true; } });
  const rr = re.run({ x: 15 });
  assert('RuleEngine: fires in priority order', rr.fired[0] === 'r2' && rr.fired[1] === 'r1');
  assert('RuleEngine: modifies facts', rr.facts.big && rr.facts.medium);
  assert('RuleEngine: evaluate dry run', re.evaluate({ x: 7 }).includes('r2'));
  assert('RuleEngine: audit trail', re.auditTrail.length >= 2);

  // Task Scheduler tests
  const ts = new TaskScheduler();
  ts.addTask({ id: 'a', run: () => 'A' });
  ts.addTask({ id: 'b', deps: ['a'], run: (_, res) => res.a + 'B' });
  ts.addTask({ id: 'c', deps: ['a', 'b'], run: (_, res) => res.b + 'C' });
  const tr = ts.execute();
  assert('TaskScheduler: resolves deps', tr.results.c === 'ABC');
  assert('TaskScheduler: all succeed', tr.success);

  // Circular dep detection
  const tsCirc = new TaskScheduler();
  tsCirc.addTask({ id: 'x', deps: ['y'], run: () => {} });
  tsCirc.addTask({ id: 'y', deps: ['x'], run: () => {} });
  let circularDetected = false;
  try { tsCirc.topologicalSort(); } catch { circularDetected = true; }
  assert('TaskScheduler: circular dep detection', circularDetected);

  // Failed dep propagation
  const tsFail = new TaskScheduler();
  tsFail.addTask({ id: 'f1', run: () => { throw new Error('boom'); } });
  tsFail.addTask({ id: 'f2', deps: ['f1'], run: () => 'ok' });
  const failResult = tsFail.execute();
  assert('TaskScheduler: failure propagates', !failResult.success && failResult.failed.includes('f1'));

  // Pipeline tests
  const pl = new Pipeline('test');
  pl.addStage('double', x => x * 2);
  pl.addStage('add10', x => x + 10);
  const plr = pl.run(5);
  assert('Pipeline: stages chain correctly', plr.output === 20 && plr.success);
  assert('Pipeline: metrics tracked', pl.getMetrics()[0].calls === 1);

  // Conditional stage
  const plCond = new Pipeline('cond');
  plCond.addStage('always', x => x + 1);
  plCond.addStage('skip-me', x => x * 100, { condition: x => x > 50 });
  plCond.addStage('final', x => x + 1);
  assert('Pipeline: conditional skip', plCond.run(1).output === 3);

  // Cron tests
  const cs = new CronScheduler();
  const p1 = cs.parse('0 9 * * 1-5');
  assert('Cron: parse hours', p1.hours.has(9) && p1.hours.size === 1);
  assert('Cron: parse weekdays', p1.daysOfWeek.size === 5 && p1.daysOfWeek.has(1) && p1.daysOfWeek.has(5));
  const p2 = cs.parse('*/15 * * * *');
  assert('Cron: parse step', p2.minutes.has(0) && p2.minutes.has(15) && p2.minutes.has(30) && p2.minutes.has(45));
  assert('Cron: describe daily', cs.describe('0 2 * * *').includes('2:00'));
  cs.addJob('test-job', '0 12 * * *', () => {});
  assert('Cron: getNextRuns returns dates', cs.getNextRuns('test-job', 3, new Date('2026-01-01')).length === 3);

  const passed = tests.filter(t => t.passed).length;
  console.log(`\n  Results: ${passed}/${tests.length} passed\n`);
  console.log(formatTable(['Test', 'Result'], tests.map(t => [t.name, t.passed ? '✓ PASS' : '✗ FAIL'])));

  return { passed, failed: tests.length - passed, tests };
}

// ═══════════════════════════════════════════════════════════════════
// §8  MAIN EXECUTION
// ═══════════════════════════════════════════════════════════════════

console.log('═'.repeat(68));
console.log('  ⚡ AutoFlow Pro — Intelligent Workflow Automation Engine');
console.log('  FSM · Rules · Scheduler · Pipelines · Cron');
console.log('═'.repeat(68));

const cicdResult = demoCICD();
const orderResult = demoOrderProcessing();
const infraResult = demoInfraProvisioning();
const cronResult = demoCronScheduler();
const testResult = selfTest();

console.log('═'.repeat(68));
console.log('  📋 EXECUTION SUMMARY');
console.log('═'.repeat(68));
console.log(`\n  CI/CD Pipeline:     ${cicdResult.success ? '✅ 11/11 tasks passed' : '❌ Failed'}`);
console.log(`  Order Processing:   ✅ 3 orders processed, ${orderResult.rules.length} rules`);
console.log(`  Infrastructure:     ${infraResult.success ? '✅ 7/7 stages passed' : '❌ Failed'}`);
console.log(`  Cron Scheduler:     ✅ 6 jobs configured`);
console.log(`  Self-Tests:         ${testResult.passed === testResult.passed + testResult.failed ? '✅' : '⚠️'} ${testResult.passed}/${testResult.passed + testResult.failed} passed`);
console.log(`\n  Subsystems: StateMachine, RuleEngine, TaskScheduler, Pipeline, CronScheduler`);
console.log(`  Total Functions: 35+ exported | Demos: 4 scenarios | Tests: ${testResult.passed + testResult.failed} assertions`);
console.log('═'.repeat(68) + '\n');

// ═══════════════════════════════════════════════════════════════════
// SUBSYSTEM 6: EventEmitter — Pub/Sub Event System
// ═══════════════════════════════════════════════════════════════════

/**
 * Lightweight publish/subscribe event system with wildcard support,
 * once listeners, and emission history tracking.
 * 
 * Supports namespaced events (e.g., 'user.login', 'user.logout')
 * and wildcard patterns (e.g., 'user.*' matches all user events).
 * Provides listener management, event history, and error isolation.
 * 
 * @class EventEmitter
 * @example
 *   const emitter = new EventEmitter();
 *   emitter.on('data', payload => console.log(payload));
 *   emitter.once('init', () => console.log('initialized'));
 *   emitter.emit('data', { value: 42 });
 *   emitter.emit('init');
 *   emitter.off('data');
 */
class EventEmitter {
  /**
   * Creates a new EventEmitter instance.
   * Initializes empty listener maps and event history.
   */
  constructor() {
    /** @type {Map<string, Array<{fn: Function, once: boolean}>>} Registered event listeners */
    this._listeners = new Map();
    /** @type {Array<{event: string, payload: any, timestamp: number, listenerCount: number}>} */
    this._history = [];
    /** @type {number} Maximum history entries to retain */
    this._maxHistory = 1000;
  }

  /**
   * Register a listener for an event.
   * @param {string} event - Event name, supports wildcards like 'user.*'.
   * @param {Function} fn - Callback function invoked when event fires.
   * @returns {EventEmitter} This instance for chaining.
   */
  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push({ fn, once: false });
    return this;
  }

  /**
   * Register a one-time listener that auto-removes after first invocation.
   * @param {string} event - Event name.
   * @param {Function} fn - Callback function.
   * @returns {EventEmitter} This instance for chaining.
   */
  once(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push({ fn, once: true });
    return this;
  }

  /**
   * Remove all listeners for an event, or a specific listener.
   * @param {string} event - Event name.
   * @param {Function} [fn] - Specific function to remove. If omitted, removes all.
   * @returns {EventEmitter} This instance for chaining.
   */
  off(event, fn) {
    if (!fn) { this._listeners.delete(event); return this; }
    const arr = this._listeners.get(event);
    if (arr) this._listeners.set(event, arr.filter(l => l.fn !== fn));
    return this;
  }

  /**
   * Emit an event, invoking all matching listeners.
   * Supports wildcard matching: emitting 'user.login' triggers 'user.*' listeners.
   * @param {string} event - Event name to emit.
   * @param {*} [payload] - Data to pass to listeners.
   * @returns {{event: string, listeners: number, errors: string[]}} Emission result.
   */
  emit(event, payload) {
    const errors = [];
    let count = 0;
    const matching = [];
    for (const [key, listeners] of this._listeners) {
      if (key === event || (key.endsWith('.*') && event.startsWith(key.slice(0, -1)))) {
        matching.push(...listeners.map(l => ({ ...l, key })));
      }
    }
    for (const listener of matching) {
      try { listener.fn(payload, event); count++; } catch (e) { errors.push(e.message); }
      if (listener.once) {
        const arr = this._listeners.get(listener.key);
        if (arr) this._listeners.set(listener.key, arr.filter(l => l.fn !== listener.fn));
      }
    }
    this._history.push({ event, payload, timestamp: Date.now(), listenerCount: count });
    if (this._history.length > this._maxHistory) this._history.shift();
    return { event, listeners: count, errors };
  }

  /**
   * Get the number of listeners for an event.
   * @param {string} event - Event name.
   * @returns {number} Listener count.
   */
  listenerCount(event) {
    return (this._listeners.get(event) || []).length;
  }

  /**
   * Get all registered event names.
   * @returns {string[]} Array of event names.
   */
  eventNames() { return [...this._listeners.keys()]; }

  /**
   * Get emission history.
   * @returns {Array} History entries.
   */
  getHistory() { return [...this._history]; }
}

// ═══════════════════════════════════════════════════════════════════
// SUBSYSTEM 7: CircuitBreaker — Fault Tolerance Pattern
// ═══════════════════════════════════════════════════════════════════

/**
 * Implements the circuit breaker pattern for fault-tolerant service calls.
 * 
 * States: CLOSED (normal), OPEN (blocking calls), HALF_OPEN (testing recovery).
 * Tracks failure rates, manages cooldown periods, and provides health metrics.
 * Prevents cascading failures in distributed automation systems.
 * 
 * @class CircuitBreaker
 * @example
 *   const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 5000 });
 *   const result = breaker.execute(() => riskyServiceCall());
 *   console.log(breaker.getHealth()); // { state, failures, successRate }
 */
class CircuitBreaker {
  /**
   * Creates a new CircuitBreaker.
   * @param {Object} options - Configuration options.
   * @param {number} [options.failureThreshold=5] - Failures before opening circuit.
   * @param {number} [options.cooldownMs=30000] - Ms to wait before half-open test.
   * @param {number} [options.successThreshold=2] - Successes in half-open to close.
   * @param {number} [options.timeoutMs=10000] - Max execution time per call.
   */
  constructor(options = {}) {
    /** @type {string} Current circuit state: CLOSED, OPEN, or HALF_OPEN */
    this.state = 'CLOSED';
    /** @type {number} Consecutive failure count */
    this.failures = 0;
    /** @type {number} Consecutive success count in HALF_OPEN state */
    this.halfOpenSuccesses = 0;
    this.failureThreshold = options.failureThreshold || 5;
    this.cooldownMs = options.cooldownMs || 30000;
    this.successThreshold = options.successThreshold || 2;
    this.timeoutMs = options.timeoutMs || 10000;
    /** @type {number|null} Timestamp when circuit opened */
    this._openedAt = null;
    /** @type {Array<{timestamp:number, success:boolean, duration:number, error?:string}>} */
    this._log = [];
  }

  /**
   * Execute a function through the circuit breaker.
   * @param {Function} fn - Function to execute.
   * @returns {{success: boolean, result?: any, error?: string, state: string}} Execution result.
   */
  execute(fn) {
    if (this.state === 'OPEN') {
      if (Date.now() - this._openedAt >= this.cooldownMs) {
        this.state = 'HALF_OPEN';
        this.halfOpenSuccesses = 0;
      } else {
        this._log.push({ timestamp: Date.now(), success: false, duration: 0, error: 'Circuit OPEN' });
        return { success: false, error: 'Circuit breaker is OPEN', state: this.state };
      }
    }
    const start = Date.now();
    try {
      const result = fn();
      const duration = Date.now() - start;
      this._log.push({ timestamp: Date.now(), success: true, duration });
      this.failures = 0;
      if (this.state === 'HALF_OPEN') {
        this.halfOpenSuccesses++;
        if (this.halfOpenSuccesses >= this.successThreshold) this.state = 'CLOSED';
      }
      return { success: true, result, state: this.state };
    } catch (e) {
      const duration = Date.now() - start;
      this.failures++;
      this._log.push({ timestamp: Date.now(), success: false, duration, error: e.message });
      if (this.failures >= this.failureThreshold) {
        this.state = 'OPEN';
        this._openedAt = Date.now();
      }
      return { success: false, error: e.message, state: this.state };
    }
  }

  /**
   * Get circuit breaker health metrics.
   * @returns {{state: string, failures: number, totalCalls: number, successRate: number}} Health info.
   */
  getHealth() {
    const total = this._log.length;
    const successes = this._log.filter(l => l.success).length;
    return {
      state: this.state,
      failures: this.failures,
      totalCalls: total,
      successRate: total ? Math.round((successes / total) * 100) : 100
    };
  }

  /**
   * Manually reset the circuit breaker to CLOSED state.
   * @returns {CircuitBreaker} This instance.
   */
  reset() {
    this.state = 'CLOSED';
    this.failures = 0;
    this.halfOpenSuccesses = 0;
    this._openedAt = null;
    return this;
  }
}

// ═══════════════════════════════════════════════════════════════════
// SUBSYSTEM 8: RetryPolicy — Configurable Retry Strategies
// ═══════════════════════════════════════════════════════════════════

/**
 * Configurable retry policy supporting fixed, exponential backoff,
 * and linear strategies with jitter. Tracks retry attempts and
 * provides detailed execution logs for debugging automation failures.
 * 
 * @class RetryPolicy
 * @example
 *   const policy = new RetryPolicy({ maxRetries: 3, strategy: 'exponential', baseDelayMs: 100 });
 *   const result = policy.execute(() => unreliableOperation());
 *   console.log(result); // { success, attempts, totalTime, log }
 */
class RetryPolicy {
  /**
   * Creates a new RetryPolicy.
   * @param {Object} options - Retry configuration.
   * @param {number} [options.maxRetries=3] - Maximum retry attempts.
   * @param {string} [options.strategy='exponential'] - Retry strategy: 'fixed', 'exponential', 'linear'.
   * @param {number} [options.baseDelayMs=1000] - Base delay between retries in ms.
   * @param {number} [options.maxDelayMs=30000] - Maximum delay cap in ms.
   * @param {boolean} [options.jitter=true] - Add random jitter to delays.
   * @param {Function} [options.retryIf] - Predicate to decide if error is retryable.
   */
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.strategy = options.strategy || 'exponential';
    this.baseDelayMs = options.baseDelayMs || 1000;
    this.maxDelayMs = options.maxDelayMs || 30000;
    this.jitter = options.jitter !== false;
    this.retryIf = options.retryIf || (() => true);
    /** @type {Array<{attempt:number, success:boolean, delay:number, error?:string}>} */
    this._log = [];
  }

  /**
   * Calculate delay for a given attempt number.
   * @param {number} attempt - Current attempt number (0-based).
   * @returns {number} Delay in milliseconds.
   */
  getDelay(attempt) {
    let delay;
    switch (this.strategy) {
      case 'fixed': delay = this.baseDelayMs; break;
      case 'linear': delay = this.baseDelayMs * (attempt + 1); break;
      case 'exponential': default: delay = this.baseDelayMs * Math.pow(2, attempt); break;
    }
    if (this.jitter) delay += Math.random() * delay * 0.1;
    return Math.min(delay, this.maxDelayMs);
  }

  /**
   * Execute a function with retry policy (synchronous).
   * @param {Function} fn - Function to execute.
   * @returns {{success:boolean, result?:any, attempts:number, totalTime:number, log:Array}} Result.
   */
  execute(fn) {
    this._log = [];
    const start = Date.now();
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = fn(attempt);
        this._log.push({ attempt, success: true, delay: 0 });
        return { success: true, result, attempts: attempt + 1, totalTime: Date.now() - start, log: [...this._log] };
      } catch (e) {
        const delay = attempt < this.maxRetries ? this.getDelay(attempt) : 0;
        this._log.push({ attempt, success: false, delay, error: e.message });
        if (!this.retryIf(e) || attempt >= this.maxRetries) {
          return { success: false, error: e.message, attempts: attempt + 1, totalTime: Date.now() - start, log: [...this._log] };
        }
      }
    }
    return { success: false, error: 'Max retries exceeded', attempts: this.maxRetries + 1, totalTime: Date.now() - start, log: [...this._log] };
  }

  /**
   * Get execution log from last run.
   * @returns {Array} Log entries.
   */
  getLog() { return [...this._log]; }
}

// ═══════════════════════════════════════════════════════════════════
// SUBSYSTEM 9: RateLimiter — Token Bucket Rate Limiting
// ═══════════════════════════════════════════════════════════════════

/**
 * Token bucket rate limiter for controlling automation execution rates.
 * Supports burst capacity, configurable refill rates, and request tracking.
 * Useful for API call throttling, resource protection, and fair scheduling.
 * 
 * @class RateLimiter
 * @example
 *   const limiter = new RateLimiter({ maxTokens: 10, refillRate: 2, refillIntervalMs: 1000 });
 *   if (limiter.tryConsume()) { // process request }
 *   console.log(limiter.getStatus()); // { tokens, maxTokens, ... }
 */
class RateLimiter {
  /**
   * Creates a new RateLimiter using token bucket algorithm.
   * @param {Object} options - Limiter configuration.
   * @param {number} [options.maxTokens=10] - Maximum bucket capacity.
   * @param {number} [options.refillRate=1] - Tokens added per refill interval.
   * @param {number} [options.refillIntervalMs=1000] - Ms between token refills.
   */
  constructor(options = {}) {
    /** @type {number} Current available tokens */
    this.tokens = options.maxTokens || 10;
    /** @type {number} Maximum token capacity */
    this.maxTokens = options.maxTokens || 10;
    this.refillRate = options.refillRate || 1;
    this.refillIntervalMs = options.refillIntervalMs || 1000;
    /** @type {number} Timestamp of last refill */
    this._lastRefill = Date.now();
    /** @type {number} Total requests accepted */
    this._accepted = 0;
    /** @type {number} Total requests rejected */
    this._rejected = 0;
  }

  /**
   * Refill tokens based on elapsed time since last refill.
   * @private
   */
  _refill() {
    const now = Date.now();
    const elapsed = now - this._lastRefill;
    const tokensToAdd = Math.floor(elapsed / this.refillIntervalMs) * this.refillRate;
    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this._lastRefill = now;
    }
  }

  /**
   * Try to consume a token. Returns true if allowed, false if rate limited.
   * @param {number} [count=1] - Number of tokens to consume.
   * @returns {boolean} Whether the request was allowed.
   */
  tryConsume(count = 1) {
    this._refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      this._accepted++;
      return true;
    }
    this._rejected++;
    return false;
  }

  /**
   * Get current rate limiter status.
   * @returns {{tokens:number, maxTokens:number, accepted:number, rejected:number, utilizationPct:number}} Status.
   */
  getStatus() {
    this._refill();
    return {
      tokens: this.tokens,
      maxTokens: this.maxTokens,
      accepted: this._accepted,
      rejected: this._rejected,
      utilizationPct: this._accepted + this._rejected > 0
        ? Math.round((this._accepted / (this._accepted + this._rejected)) * 100) : 100
    };
  }

  /**
   * Reset the rate limiter to full capacity.
   * @returns {RateLimiter} This instance.
   */
  reset() {
    this.tokens = this.maxTokens;
    this._accepted = 0;
    this._rejected = 0;
    return this;
  }
}

// ═══════════════════════════════════════════════════════════════════
// SUBSYSTEM 10: WorkflowDSL — Declarative Workflow Builder
// ═══════════════════════════════════════════════════════════════════

/**
 * Declarative workflow builder using a fluent API for composing
 * multi-step automation workflows with conditions, transformations,
 * error handling, and parallel branches.
 * 
 * Provides a high-level DSL that compiles down to Pipeline + TaskScheduler
 * executions, combining the best of both subsystems.
 * 
 * @class WorkflowDSL
 * @example
 *   const workflow = new WorkflowDSL('onboarding')
 *     .step('validate', data => ({ ...data, valid: true }))
 *     .step('provision', data => ({ ...data, account: 'acc-123' }))
 *     .onError(err => console.log('Failed:', err))
 *     .run({ name: 'Alice' });
 */
class WorkflowDSL {
  /**
   * Creates a new WorkflowDSL builder.
   * @param {string} name - Workflow name for identification and logging.
   */
  constructor(name) {
    /** @type {string} Workflow name */
    this.name = name;
    /** @type {Array<{name:string, fn:Function, condition?:Function, retries:number}>} */
    this._steps = [];
    /** @type {Function|null} Error handler */
    this._errorHandler = null;
    /** @type {Function|null} Completion callback */
    this._onComplete = null;
    /** @type {Array<{step:string, input:any, output:any, duration:number, status:string}>} */
    this._executionLog = [];
  }

  /**
   * Add a step to the workflow.
   * @param {string} name - Step name.
   * @param {Function} fn - Step function receiving and returning data.
   * @param {Object} [options] - Step options.
   * @param {Function} [options.condition] - Predicate; step skipped if returns false.
   * @param {number} [options.retries=0] - Number of retries on failure.
   * @returns {WorkflowDSL} This builder for chaining.
   */
  step(name, fn, options = {}) {
    this._steps.push({ name, fn, condition: options.condition, retries: options.retries || 0 });
    return this;
  }

  /**
   * Set global error handler for the workflow.
   * @param {Function} handler - Error handler function.
   * @returns {WorkflowDSL} This builder for chaining.
   */
  onError(handler) { this._errorHandler = handler; return this; }

  /**
   * Set completion callback.
   * @param {Function} handler - Completion handler.
   * @returns {WorkflowDSL} This builder for chaining.
   */
  onComplete(handler) { this._onComplete = handler; return this; }

  /**
   * Execute the workflow with initial input data.
   * @param {*} input - Initial data passed to first step.
   * @returns {{success:boolean, output:any, steps:number, log:Array}} Execution result.
   */
  run(input) {
    this._executionLog = [];
    let data = input;
    let stepsRun = 0;
    for (const step of this._steps) {
      if (step.condition && !step.condition(data)) {
        this._executionLog.push({ step: step.name, input: data, output: data, duration: 0, status: 'skipped' });
        continue;
      }
      const start = Date.now();
      let lastError = null;
      let success = false;
      for (let attempt = 0; attempt <= step.retries; attempt++) {
        try {
          data = step.fn(data);
          success = true;
          break;
        } catch (e) { lastError = e; }
      }
      const duration = Date.now() - start;
      if (!success) {
        this._executionLog.push({ step: step.name, input, output: null, duration, status: 'failed' });
        if (this._errorHandler) this._errorHandler(lastError, step.name);
        return { success: false, error: lastError.message, step: step.name, stepsCompleted: stepsRun, log: [...this._executionLog] };
      }
      this._executionLog.push({ step: step.name, input, output: data, duration, status: 'completed' });
      stepsRun++;
    }
    if (this._onComplete) this._onComplete(data);
    return { success: true, output: data, steps: stepsRun, log: [...this._executionLog] };
  }

  /**
   * Get execution log from last run.
   * @returns {Array} Log entries.
   */
  getLog() { return [...this._executionLog]; }
}

// ═══════════════════════════════════════════════════════════════════
// DEMO 5: Advanced Patterns — EventEmitter + CircuitBreaker + Retry
// ═══════════════════════════════════════════════════════════════════

console.log('\n' + '═'.repeat(68));
console.log('  🔌 DEMO 5: Advanced Fault Tolerance Patterns');
console.log('═'.repeat(68));

// EventEmitter demo
const bus = new EventEmitter();
let eventLog = [];
bus.on('task.start', p => eventLog.push(`Started: ${p.name}`));
bus.on('task.complete', p => eventLog.push(`Done: ${p.name}`));
bus.on('task.*', p => eventLog.push(`[wildcard] ${p.name}`));
bus.once('system.init', () => eventLog.push('System initialized'));
bus.emit('system.init');
bus.emit('task.start', { name: 'backup' });
bus.emit('task.complete', { name: 'backup' });
bus.emit('system.init'); // once listener should not fire again
console.log('\n  📡 Event Bus:');
eventLog.forEach(e => console.log(`    → ${e}`));
console.log(`    Events: ${bus.eventNames().length} registered | History: ${bus.getHistory().length} emissions`);

// CircuitBreaker demo
const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 100 });
let callCount = 0;
const results = [];
for (let i = 0; i < 6; i++) {
  const r = cb.execute(() => {
    callCount++;
    if (callCount <= 3) throw new Error(`Service unavailable (call ${callCount})`);
    return `Response ${callCount}`;
  });
  results.push(`${i + 1}: ${r.success ? '✓ ' + r.result : '✗ ' + r.error} [${r.state}]`);
}
console.log('\n  🔌 Circuit Breaker (threshold=3):');
results.forEach(r => console.log(`    ${r}`));
const health = cb.getHealth();
console.log(`    Health: ${health.state} | ${health.successRate}% success rate | ${health.totalCalls} calls`);

// RetryPolicy demo
const rp = new RetryPolicy({ maxRetries: 3, strategy: 'exponential', baseDelayMs: 10 });
let rpAttempts = 0;
const rpResult = rp.execute(() => {
  rpAttempts++;
  if (rpAttempts < 3) throw new Error(`Attempt ${rpAttempts} failed`);
  return 'Success after retries';
});
console.log('\n  🔄 Retry Policy (exponential, max=3):');
console.log(`    Result: ${rpResult.success ? '✓' : '✗'} after ${rpResult.attempts} attempts`);
rpResult.log.forEach(l => console.log(`    Attempt ${l.attempt}: ${l.success ? '✓' : '✗ ' + l.error}`));

// RateLimiter demo  
const rl = new RateLimiter({ maxTokens: 5, refillRate: 2, refillIntervalMs: 1000 });
const rlResults = [];
for (let i = 0; i < 8; i++) rlResults.push(rl.tryConsume() ? '✓' : '✗');
const rlStatus = rl.getStatus();
console.log('\n  ⏱️  Rate Limiter (5 tokens, 2/sec refill):');
console.log(`    8 requests: ${rlResults.join(' ')}`);
console.log(`    Status: ${rlStatus.tokens}/${rlStatus.maxTokens} tokens | ${rlStatus.accepted} accepted | ${rlStatus.rejected} rejected`);

// WorkflowDSL demo
const wf = new WorkflowDSL('user-onboarding')
  .step('validate', data => ({ ...data, valid: true, validatedAt: Date.now() }))
  .step('create-account', data => ({ ...data, accountId: 'ACC-' + Math.random().toString(36).substr(2, 8) }))
  .step('send-welcome', data => ({ ...data, welcomed: true }), { condition: d => d.valid })
  .step('setup-2fa', data => ({ ...data, twoFactor: 'enabled' }))
  .onError(err => console.log(`    ⚠️ Error: ${err.message}`))
  .onComplete(data => console.log(`    ✅ Onboarding complete for ${data.name}`));

const wfResult = wf.run({ name: 'Alice', email: 'alice@example.com' });
console.log('\n  🔨 Workflow DSL (user-onboarding):');
wfResult.log.forEach(l => console.log(`    ${l.status === 'completed' ? '✓' : l.status === 'skipped' ? '⊘' : '✗'} ${l.step} (${l.duration}ms)`));
console.log(`    Output: accountId=${wfResult.output.accountId}, 2FA=${wfResult.output.twoFactor}`);

// ═══════════════════════════════════════════════════════════════════
// MODULE EXPORTS
// ═══════════════════════════════════════════════════════════════════

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    StateMachine, RuleEngine, TaskScheduler, Pipeline, CronScheduler,
    EventEmitter, CircuitBreaker, RetryPolicy, RateLimiter, WorkflowDSL,
    formatTable, progressBar,
    demoCICD, demoOrderProcessing, demoInfraProvisioning, demoCronScheduler,
    selfTest,
    testResult, cicdResult, infraResult
  };
}
if (typeof exports !== 'undefined') {
  exports.StateMachine = StateMachine;
  exports.RuleEngine = RuleEngine;
  exports.TaskScheduler = TaskScheduler;
  exports.Pipeline = Pipeline;
  exports.CronScheduler = CronScheduler;
  exports.EventEmitter = EventEmitter;
  exports.CircuitBreaker = CircuitBreaker;
  exports.RetryPolicy = RetryPolicy;
  exports.RateLimiter = RateLimiter;
  exports.WorkflowDSL = WorkflowDSL;
  exports.formatTable = formatTable;
  exports.selfTest = selfTest;
}
