// ============================================================
// Plugin System (v22 — Phase 4: Ecosystem)
// ============================================================
// Extensible plugin architecture for the orchestrator.
// Plugins are discovered from a directory, loaded via JSON manifests,
// and provide typed extension points for tools, gates, roles,
// workflows, hooks, and transforms.
//
// Plugin structure (on disk):
//   plugins/
//     my-plugin/
//       plugin.json       — manifest (type, name, version, entry, config)
//       index.mjs         — plugin entry point (exports activate/deactivate)
//
// Manifest format (plugin.json):
//   {
//     "name": "my-plugin",
//     "version": "1.0.0",
//     "type": "hook",          // tool | gate | role | workflow | hook | transform
//     "description": "...",
//     "entry": "index.mjs",    // relative to plugin directory
//     "config": { ... }        // optional plugin-specific config
//   }
//
// Plugin entry module must export:
//   activate(context)   — called on load, receives plugin context
//   deactivate()        — called on unload (optional)
//
// Usage:
//   import { PluginManager } from './plugin-system.mjs';
//   const pm = new PluginManager({ pluginDir: 'orchestrator/plugins' });
//   await pm.discover();
//   await pm.loadAll();
//   await pm.executeHook('pre-round', { round: 1 });
//   const gates = pm.getGates();
// ============================================================

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

// ── Plugin Types ────────────────────────────────────────────

const PLUGIN_TYPES = new Set(['tool', 'gate', 'role', 'workflow', 'hook', 'transform']);

// ── Plugin Instance ─────────────────────────────────────────

class Plugin {
  /**
   * @param {Object} manifest — parsed plugin.json
   * @param {string} dir — absolute path to plugin directory
   */
  constructor(manifest, dir) {
    this.name = manifest.name;
    this.version = manifest.version || '0.0.0';
    this.type = manifest.type;
    this.description = manifest.description || '';
    this.entry = manifest.entry || 'index.mjs';
    this.config = manifest.config || {};
    this.dir = dir;
    this.loaded = false;
    this.module = null;
    this.instance = null; // return value from activate()
    this.error = null;
  }

  get entryPath() {
    return join(this.dir, this.entry);
  }

  toJSON() {
    return {
      name: this.name, version: this.version, type: this.type,
      description: this.description, loaded: this.loaded,
      dir: this.dir, error: this.error,
    };
  }
}

// ── Plugin Context ──────────────────────────────────────────

/**
 * Context object passed to plugin activate() functions.
 * Provides controlled access to orchestrator capabilities.
 */
class PluginContext {
  /**
   * @param {Plugin} plugin
   * @param {PluginManager} manager
   * @param {Object} [orchestratorCtx={}] — references to orchestrator internals
   */
  constructor(plugin, manager, orchestratorCtx = {}) {
    this.pluginName = plugin.name;
    this.pluginType = plugin.type;
    this.pluginConfig = { ...plugin.config };
    this.pluginDir = plugin.dir;

    // Read-only access to orchestrator state (provided at integration time)
    this.log = orchestratorCtx.log || console.log;
    this.events = orchestratorCtx.events || null;
    this.config = orchestratorCtx.config || {};
  }
}

// ── PluginManager ───────────────────────────────────────────

class PluginManager {
  /**
   * @param {Object} [options]
   * @param {string} [options.pluginDir='orchestrator/plugins'] — path to plugins directory
   * @param {Object} [options.orchestratorCtx={}] — orchestrator context for plugin activation
   * @param {Function} [options.log=console.log] — logging function
   */
  constructor(options = {}) {
    this.pluginDir = resolve(options.pluginDir || join('orchestrator', 'plugins'));
    this.orchestratorCtx = options.orchestratorCtx || {};
    this.log = options.log || console.log;

    /** @type {Map<string, Plugin>} */
    this.plugins = new Map();

    /** @type {Map<string, Plugin[]>} — index by type for fast lookup */
    this._byType = new Map();
    for (const type of PLUGIN_TYPES) this._byType.set(type, []);
  }

  /**
   * Discover plugins by scanning the plugin directory for plugin.json manifests.
   * Does NOT load (import) plugins — call loadAll() or load(name) after.
   * @returns {Plugin[]} — discovered plugins
   */
  discover() {
    const discovered = [];
    if (!existsSync(this.pluginDir)) return discovered;

    let entries;
    try { entries = readdirSync(this.pluginDir); }
    catch (_) { return discovered; }

    for (const entry of entries) {
      const pluginPath = join(this.pluginDir, entry);
      try {
        if (!statSync(pluginPath).isDirectory()) continue;
      } catch (_) { continue; }

      const manifestPath = join(pluginPath, 'plugin.json');
      if (!existsSync(manifestPath)) continue;

      try {
        const raw = readFileSync(manifestPath, 'utf-8');
        const manifest = JSON.parse(raw);

        // Validate manifest
        if (!manifest.name || typeof manifest.name !== 'string') {
          this.log(`[plugin] Skipping ${entry}: missing or invalid "name" in plugin.json`);
          continue;
        }
        if (!manifest.type || !PLUGIN_TYPES.has(manifest.type)) {
          this.log(`[plugin] Skipping ${entry}: invalid type "${manifest.type}". Must be one of: ${[...PLUGIN_TYPES].join(', ')}`);
          continue;
        }
        if (this.plugins.has(manifest.name)) {
          this.log(`[plugin] Skipping ${entry}: duplicate plugin name "${manifest.name}"`);
          continue;
        }

        const plugin = new Plugin(manifest, pluginPath);
        this.plugins.set(plugin.name, plugin);
        this._byType.get(plugin.type).push(plugin);
        discovered.push(plugin);
      } catch (err) {
        this.log(`[plugin] Error reading manifest for ${entry}: ${err.message}`);
      }
    }

    return discovered;
  }

  /**
   * Load a specific plugin by name (import + activate).
   * @param {string} name
   * @returns {Promise<boolean>} — true if loaded successfully
   */
  async load(name) {
    const plugin = this.plugins.get(name);
    if (!plugin) throw new Error(`Plugin "${name}" not found. Run discover() first.`);
    if (plugin.loaded) return true;

    const entryPath = plugin.entryPath;
    if (!existsSync(entryPath)) {
      plugin.error = `Entry file not found: ${plugin.entry}`;
      this.log(`[plugin] ${plugin.name}: ${plugin.error}`);
      return false;
    }

    try {
      // Use file:// URL for dynamic import (required on Windows)
      const fileUrl = pathToFileURL(entryPath).href;
      const mod = await import(fileUrl);
      plugin.module = mod;

      if (typeof mod.activate === 'function') {
        const ctx = new PluginContext(plugin, this, this.orchestratorCtx);
        plugin.instance = await mod.activate(ctx);
      }

      plugin.loaded = true;
      plugin.error = null;
      this.log(`[plugin] Loaded: ${plugin.name} v${plugin.version} (${plugin.type})`);
      return true;
    } catch (err) {
      plugin.error = err.message;
      this.log(`[plugin] Failed to load ${plugin.name}: ${err.message}`);
      return false;
    }
  }

  /**
   * Load all discovered plugins.
   * @returns {Promise<{ loaded: number, failed: number, errors: string[] }>}
   */
  async loadAll() {
    let loaded = 0;
    let failed = 0;
    const errors = [];

    for (const [name] of this.plugins) {
      const ok = await this.load(name);
      if (ok) loaded++;
      else {
        failed++;
        const plugin = this.plugins.get(name);
        errors.push(`${name}: ${plugin.error}`);
      }
    }

    return { loaded, failed, errors };
  }

  /**
   * Unload a plugin (call deactivate, remove module reference).
   * @param {string} name
   */
  async unload(name) {
    const plugin = this.plugins.get(name);
    if (!plugin || !plugin.loaded) return;

    try {
      if (plugin.module && typeof plugin.module.deactivate === 'function') {
        await plugin.module.deactivate();
      }
    } catch (err) {
      this.log(`[plugin] Error deactivating ${name}: ${err.message}`);
    }

    plugin.loaded = false;
    plugin.module = null;
    plugin.instance = null;
  }

  /**
   * Unload all plugins.
   */
  async unloadAll() {
    for (const [name] of this.plugins) {
      await this.unload(name);
    }
  }

  // ── Type-Specific Accessors ─────────────────────────────

  /**
   * Get all loaded plugins of a given type.
   * @param {string} type
   * @returns {Plugin[]}
   */
  getByType(type) {
    return (this._byType.get(type) || []).filter(p => p.loaded);
  }

  /**
   * Execute all loaded hook plugins for a given hook name.
   * Hook plugins must export a function matching the hook name,
   * or have an instance with the hook name as a method.
   *
   * @param {string} hookName — e.g. 'pre-round', 'post-round', 'pre-agent', 'post-agent'
   * @param {Object} [data={}] — data passed to hook functions
   * @returns {Promise<Array<{plugin: string, result: any, error: string|null}>>}
   */
  async executeHook(hookName, data = {}) {
    const results = [];
    const hookPlugins = this.getByType('hook');

    for (const plugin of hookPlugins) {
      try {
        let result = null;
        // Check instance first (return value from activate)
        if (plugin.instance && typeof plugin.instance[hookName] === 'function') {
          result = await plugin.instance[hookName](data);
        }
        // Fall back to module export
        else if (plugin.module && typeof plugin.module[hookName] === 'function') {
          result = await plugin.module[hookName](data);
        }
        // Skip if hook not implemented by this plugin
        else continue;

        results.push({ plugin: plugin.name, result, error: null });
      } catch (err) {
        results.push({ plugin: plugin.name, result: null, error: err.message });
      }
    }

    return results;
  }

  /**
   * Execute all loaded gate plugins. Returns combined pass/fail.
   * Gate plugins must export a `check(context)` function returning { passed, message }.
   *
   * @param {Object} [context={}]
   * @returns {Promise<{ passed: boolean, results: Array<{plugin: string, passed: boolean, message: string}> }>}
   */
  async executeGate(context = {}) {
    const gatePlugins = this.getByType('gate');
    const results = [];
    let allPassed = true;

    for (const plugin of gatePlugins) {
      try {
        let gateResult = { passed: true, message: 'ok' };

        if (plugin.instance && typeof plugin.instance.check === 'function') {
          gateResult = await plugin.instance.check(context);
        } else if (plugin.module && typeof plugin.module.check === 'function') {
          gateResult = await plugin.module.check(context);
        }

        if (!gateResult.passed) allPassed = false;
        results.push({ plugin: plugin.name, passed: gateResult.passed, message: gateResult.message || '' });
      } catch (err) {
        allPassed = false;
        results.push({ plugin: plugin.name, passed: false, message: err.message });
      }
    }

    return { passed: allPassed, results };
  }

  /**
   * Get workflow definitions from loaded workflow plugins.
   * @returns {Array<{plugin: string, workflow: Object}>}
   */
  getWorkflows() {
    return this.getByType('workflow').map(p => {
      let workflow = null;
      if (p.instance && p.instance.workflow) workflow = p.instance.workflow;
      else if (p.module && p.module.workflow) workflow = p.module.workflow;
      return { plugin: p.name, workflow };
    }).filter(w => w.workflow);
  }

  /**
   * Get a specific workflow by plugin name.
   * @param {string} name
   * @returns {Object|null}
   */
  getWorkflow(name) {
    const entry = this.getWorkflows().find(w => w.plugin === name);
    return entry?.workflow || null;
  }

  /**
   * Get role definitions from loaded role plugins.
   * @returns {Array<{plugin: string, role: Object}>}
   */
  getRoles() {
    return this.getByType('role').map(p => {
      let role = null;
      if (p.instance && p.instance.role) role = p.instance.role;
      else if (p.module && p.module.role) role = p.module.role;
      return { plugin: p.name, role };
    }).filter(r => r.role);
  }

  /**
   * Get a specific role by plugin name.
   * @param {string} name
   * @returns {Object|null}
   */
  getRole(name) {
    const entry = this.getRoles().find(r => r.plugin === name);
    return entry?.role || null;
  }

  /**
   * Get transform functions from loaded transform plugins.
   * Transform plugins export transform(input) → output for prompt/output transformations.
   * @returns {Array<{plugin: string, transform: Function}>}
   */
  getTransforms() {
    return this.getByType('transform').map(p => {
      let transform = null;
      if (p.instance && typeof p.instance.transform === 'function') transform = p.instance.transform;
      else if (p.module && typeof p.module.transform === 'function') transform = p.module.transform;
      return { plugin: p.name, transform };
    }).filter(t => t.transform);
  }

  /**
   * Get a specific transform by plugin name.
   * @param {string} name
   * @returns {Function|null}
   */
  getTransform(name) {
    const entry = this.getTransforms().find(t => t.plugin === name);
    return entry?.transform || null;
  }

  /**
   * Get tool definitions from loaded tool plugins.
   * Tool plugins provide custom tools that agents can use.
   * @returns {Array<{plugin: string, tools: Object[]}>}
   */
  getTools() {
    return this.getByType('tool').map(p => {
      let tools = [];
      if (p.instance && Array.isArray(p.instance.tools)) tools = p.instance.tools;
      else if (p.module && Array.isArray(p.module.tools)) tools = p.module.tools;
      else if (p.instance && p.instance.tool) tools = [p.instance.tool];
      else if (p.module && p.module.tool) tools = [p.module.tool];
      return { plugin: p.name, tools };
    }).filter(t => t.tools.length > 0);
  }

  // ── Introspection ───────────────────────────────────────

  /**
   * List all discovered plugins with their status.
   * @returns {Array<Object>}
   */
  list() {
    return [...this.plugins.values()].map(p => p.toJSON());
  }

  /**
   * Get summary statistics.
   * @returns {{ total: number, loaded: number, failed: number, byType: Object }}
   */
  getSummary() {
    const total = this.plugins.size;
    let loaded = 0;
    let failed = 0;
    const byType = {};
    for (const type of PLUGIN_TYPES) byType[type] = 0;

    for (const [, p] of this.plugins) {
      if (p.loaded) loaded++;
      else if (p.error) failed++;
      byType[p.type] = (byType[p.type] || 0) + 1;
    }

    return { total, loaded, failed, byType };
  }
}

// ── Exports ─────────────────────────────────────────────────

export { PluginManager, Plugin, PluginContext, PLUGIN_TYPES };

export const __test__ = { PluginManager, Plugin, PluginContext, PLUGIN_TYPES };
