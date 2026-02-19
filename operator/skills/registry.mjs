// ============================================================
// Skill Registry — Load, Index, Search, Get
// ============================================================
// Loads skill manifests from disk, validates against schema,
// indexes by id/tags/category, and provides search/get/list.
//
// Usage:
//   import { SkillRegistry } from './registry.mjs';
//   const registry = new SkillRegistry(manifestsDir);
//   await registry.load();
//   const skill = registry.get('git-status');
//   const results = registry.search({ tags: ['git'], category: 'git' });
// ============================================================

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, basename, resolve } from 'path';
import { fileURLToPath } from 'url';

// ── Schema Validation ───────────────────────────────────────

const VALID_CATEGORIES = new Set([
  'git', 'code', 'research', 'audit', 'testing', 'deployment', 'analysis',
]);

const REQUIRED_FIELDS = ['id', 'name', 'version', 'description', 'category', 'tags'];

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const TAG_PATTERN = /^[a-z][a-z0-9-]*$/;
const VALID_MODELS = new Set(['haiku', 'sonnet', 'opus']);

/**
 * Validate a skill manifest against the schema.
 * @param {object} manifest - Parsed JSON manifest
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateManifest(manifest) {
  const errors = [];

  // Required fields
  for (const field of REQUIRED_FIELDS) {
    if (manifest[field] === undefined || manifest[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (errors.length > 0) return { valid: false, errors };

  // Type checks
  if (typeof manifest.id !== 'string' || !ID_PATTERN.test(manifest.id)) {
    errors.push(`Invalid id: must be kebab-case (got "${manifest.id}")`);
  }
  if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
    errors.push('name must be a non-empty string');
  }
  if (typeof manifest.version !== 'string' || !VERSION_PATTERN.test(manifest.version)) {
    errors.push(`Invalid version: must be semver (got "${manifest.version}")`);
  }
  if (typeof manifest.description !== 'string' || manifest.description.length < 10) {
    errors.push('description must be a string with at least 10 characters');
  }
  if (!VALID_CATEGORIES.has(manifest.category)) {
    errors.push(`Invalid category: ${manifest.category} (valid: ${[...VALID_CATEGORIES].join(', ')})`);
  }

  // Tags
  if (!Array.isArray(manifest.tags) || manifest.tags.length === 0) {
    errors.push('tags must be a non-empty array');
  } else {
    for (const tag of manifest.tags) {
      if (typeof tag !== 'string' || !TAG_PATTERN.test(tag)) {
        errors.push(`Invalid tag: "${tag}" (must be kebab-case lowercase)`);
      }
    }
    if (new Set(manifest.tags).size !== manifest.tags.length) {
      errors.push('tags must be unique');
    }
  }

  // Optional fields
  if (manifest.shortDescription !== undefined) {
    if (typeof manifest.shortDescription !== 'string' || manifest.shortDescription.length > 80) {
      errors.push('shortDescription must be a string of max 80 characters');
    }
  }
  if (manifest.triggerExamples !== undefined) {
    if (!Array.isArray(manifest.triggerExamples) || manifest.triggerExamples.length === 0) {
      errors.push('triggerExamples must be a non-empty array');
    } else if (manifest.triggerExamples.length > 15) {
      errors.push('triggerExamples must have at most 15 entries');
    }
  }
  if (manifest.requires !== undefined && !Array.isArray(manifest.requires)) {
    errors.push('requires must be an array');
  }
  if (manifest.conflicts !== undefined && !Array.isArray(manifest.conflicts)) {
    errors.push('conflicts must be an array');
  }
  if (manifest.enhancedBy !== undefined && !Array.isArray(manifest.enhancedBy)) {
    errors.push('enhancedBy must be an array');
  }
  if (manifest.sideEffects !== undefined && typeof manifest.sideEffects !== 'boolean') {
    errors.push('sideEffects must be a boolean');
  }
  if (manifest.idempotent !== undefined && typeof manifest.idempotent !== 'boolean') {
    errors.push('idempotent must be a boolean');
  }
  if (manifest.requiresConfirmation !== undefined && typeof manifest.requiresConfirmation !== 'boolean') {
    errors.push('requiresConfirmation must be a boolean');
  }
  if (manifest.model !== undefined && !VALID_MODELS.has(manifest.model)) {
    errors.push(`Invalid model: ${manifest.model} (valid: ${[...VALID_MODELS].join(', ')})`);
  }
  if (manifest.estimatedDurationMs !== undefined) {
    if (typeof manifest.estimatedDurationMs !== 'number' || manifest.estimatedDurationMs < 0) {
      errors.push('estimatedDurationMs must be a non-negative number');
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── Skill Registry Class ────────────────────────────────────

export class SkillRegistry {
  constructor(manifestsDir) {
    this.manifestsDir = manifestsDir;
    /** @type {Map<string, object>} id → manifest */
    this.skills = new Map();
    /** @type {Map<string, Set<string>>} tag → Set<skillId> */
    this.tagIndex = new Map();
    /** @type {Map<string, Set<string>>} category → Set<skillId> */
    this.categoryIndex = new Map();
    /** @type {string[]} validation warnings */
    this.warnings = [];
  }

  /**
   * Load all manifests from disk, validate, and build indexes.
   * @returns {SkillRegistry} this (for chaining)
   */
  async load() {
    this.skills.clear();
    this.tagIndex.clear();
    this.categoryIndex.clear();
    this.warnings = [];

    if (!existsSync(this.manifestsDir)) {
      throw new Error(`Manifests directory not found: ${this.manifestsDir}`);
    }

    const subdirs = readdirSync(this.manifestsDir);

    for (const subdir of subdirs) {
      const subdirPath = join(this.manifestsDir, subdir);
      if (!statSync(subdirPath).isDirectory()) continue;

      const files = readdirSync(subdirPath).filter(f => f.endsWith('.skill.json'));

      for (const file of files) {
        const filePath = join(subdirPath, file);
        try {
          const content = readFileSync(filePath, 'utf-8');
          const manifest = JSON.parse(content);
          const { valid, errors } = validateManifest(manifest);

          if (!valid) {
            this.warnings.push(`${file}: ${errors.join('; ')}`);
            continue;
          }

          if (this.skills.has(manifest.id)) {
            this.warnings.push(`Duplicate skill id: ${manifest.id} in ${file} (already loaded)`);
            continue;
          }

          // Store with source metadata
          manifest._source = filePath;
          manifest._category = subdir;
          this.skills.set(manifest.id, manifest);

          // Build tag index
          for (const tag of manifest.tags) {
            if (!this.tagIndex.has(tag)) this.tagIndex.set(tag, new Set());
            this.tagIndex.get(tag).add(manifest.id);
          }

          // Build category index
          const cat = manifest.category;
          if (!this.categoryIndex.has(cat)) this.categoryIndex.set(cat, new Set());
          this.categoryIndex.get(cat).add(manifest.id);
        } catch (err) {
          this.warnings.push(`Failed to load ${file}: ${err.message}`);
        }
      }
    }

    return this;
  }

  /**
   * Get a skill by its ID.
   * @param {string} id
   * @returns {object|null}
   */
  get(id) {
    return this.skills.get(id) || null;
  }

  /**
   * List all loaded skills.
   * @returns {object[]}
   */
  list() {
    return Array.from(this.skills.values());
  }

  /**
   * Get skill count.
   * @returns {number}
   */
  get size() {
    return this.skills.size;
  }

  /**
   * List skills grouped by category.
   * @returns {Object<string, object[]>}
   */
  listByCategory() {
    const result = {};
    for (const [cat, ids] of this.categoryIndex) {
      result[cat] = [...ids].map(id => this.skills.get(id));
    }
    return result;
  }

  /**
   * List all available categories.
   * @returns {string[]}
   */
  listCategories() {
    return [...this.categoryIndex.keys()].sort();
  }

  /**
   * List all available tags.
   * @returns {string[]}
   */
  listTags() {
    return [...this.tagIndex.keys()].sort();
  }

  /**
   * Search skills by multiple criteria (OR within tags, AND across criteria).
   * @param {object} query
   * @param {string[]} [query.tags] - Match any of these tags
   * @param {string} [query.category] - Match this category
   * @param {string} [query.keyword] - Match in name, description, shortDescription, or triggerExamples
   * @param {boolean} [query.sideEffects] - Filter by sideEffects flag
   * @param {boolean} [query.idempotent] - Filter by idempotent flag
   * @returns {object[]} Matching skills
   */
  search(query = {}) {
    let candidates = null;

    // Filter by category (most selective first)
    if (query.category) {
      const catIds = this.categoryIndex.get(query.category);
      if (!catIds) return [];
      candidates = new Set(catIds);
    }

    // Filter by tags (union: any matching tag)
    if (query.tags && query.tags.length > 0) {
      const tagMatches = new Set();
      for (const tag of query.tags) {
        const ids = this.tagIndex.get(tag);
        if (ids) for (const id of ids) tagMatches.add(id);
      }
      if (candidates) {
        // Intersect with existing candidates
        candidates = new Set([...candidates].filter(id => tagMatches.has(id)));
      } else {
        candidates = tagMatches;
      }
    }

    // Start from all skills if no structural filters applied
    if (candidates === null) {
      candidates = new Set(this.skills.keys());
    }

    // Filter by keyword (searches name, description, shortDescription, triggerExamples)
    if (query.keyword) {
      const kw = query.keyword.toLowerCase();
      const kwTokens = kw.split(/\s+/).filter(Boolean);
      const filtered = new Set();
      for (const id of candidates) {
        const skill = this.skills.get(id);
        const haystack = [
          skill.name,
          skill.description,
          skill.shortDescription || '',
          ...(skill.triggerExamples || []),
        ].join(' ').toLowerCase();
        // Match if the full keyword OR any keyword token appears as substring
        if (haystack.includes(kw) || kwTokens.some(t => haystack.includes(t))) {
          filtered.add(id);
        }
      }
      candidates = filtered;
    }

    // Filter by boolean flags
    if (query.sideEffects !== undefined) {
      const filtered = new Set();
      for (const id of candidates) {
        const skill = this.skills.get(id);
        if ((skill.sideEffects || false) === query.sideEffects) {
          filtered.add(id);
        }
      }
      candidates = filtered;
    }

    if (query.idempotent !== undefined) {
      const filtered = new Set();
      for (const id of candidates) {
        const skill = this.skills.get(id);
        if ((skill.idempotent !== false) === query.idempotent) {
          filtered.add(id);
        }
      }
      candidates = filtered;
    }

    return [...candidates].map(id => this.skills.get(id));
  }

  /**
   * Find skills that have side effects (write to filesystem, push, etc.).
   * @returns {object[]}
   */
  getWriteSkills() {
    return this.list().filter(s => s.sideEffects === true);
  }

  /**
   * Find skills that are safe/read-only.
   * @returns {object[]}
   */
  getReadOnlySkills() {
    return this.list().filter(s => !s.sideEffects);
  }

  /**
   * Find skills that require user confirmation.
   * @returns {object[]}
   */
  getConfirmationRequired() {
    return this.list().filter(s => s.requiresConfirmation === true);
  }

  /**
   * Get skills that a given skill depends on (requires).
   * @param {string} skillId
   * @returns {object[]}
   */
  getDependencies(skillId) {
    const skill = this.get(skillId);
    if (!skill || !skill.requires) return [];
    return skill.requires.map(id => this.get(id)).filter(Boolean);
  }

  /**
   * Get skills that conflict with a given skill.
   * @param {string} skillId
   * @returns {object[]}
   */
  getConflicts(skillId) {
    const skill = this.get(skillId);
    if (!skill || !skill.conflicts) return [];
    return skill.conflicts.map(id => this.get(id)).filter(Boolean);
  }

  /**
   * Get skills that enhance a given skill.
   * @param {string} skillId
   * @returns {object[]}
   */
  getEnhancements(skillId) {
    const skill = this.get(skillId);
    if (!skill || !skill.enhancedBy) return [];
    return skill.enhancedBy.map(id => this.get(id)).filter(Boolean);
  }
}

// ── Convenience factory ─────────────────────────────────────

/**
 * Create and load a skill registry from the default manifests directory.
 * @param {string} [manifestsDir] - Path to manifests directory
 * @returns {Promise<SkillRegistry>}
 */
export async function createSkillRegistry(manifestsDir) {
  const dir = manifestsDir || join(
    fileURLToPath(import.meta.url).replace(/[/\\][^/\\]+$/, ''),
    'manifests',
  );
  const registry = new SkillRegistry(dir);
  await registry.load();
  return registry;
}
