// ============================================================
// Secrets Vault — Encrypted Secrets Management (Phase 45)
// ============================================================
// AES-256-GCM encrypted vault for API keys and sensitive config.
// Values are individually encrypted with random IVs. The vault
// file stores only ciphertext — no plaintext values touch disk.
//
// Key derivation: When no explicit masterKey is provided, a key
// is derived from machine identity (hostname + username + platform)
// via SHA-256. This is NOT cryptographically strong but protects
// against casual reading of the vault file. For production use,
// provide a proper 32-byte masterKey.
//
// Factory: createSecretVault(ctx) returns vault API.
// ============================================================

import {
  createHash, randomBytes,
  createCipheriv, createDecipheriv,
} from 'node:crypto';
import { hostname, userInfo, platform } from 'node:os';
import {
  writeFileSync, readFileSync, existsSync,
  mkdirSync, renameSync, unlinkSync,
} from 'node:fs';
import { dirname } from 'node:path';

// ── Constants ───────────────────────────────────────────────

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const MAX_NAME_LENGTH = 64;
const NAME_PATTERN = /^[A-Za-z0-9_]+$/;

// ── Machine-derived key ─────────────────────────────────────

/**
 * Derive a 32-byte encryption key from machine identity.
 * NOTE: This is convenience, not security. It stops casual
 * readers but will not withstand a determined attacker.
 * @returns {Buffer} 32-byte key
 */
export function deriveMachineKey() {
  const material = `${hostname()}:${userInfo().username}:${platform()}`;
  return createHash('sha256').update(material).digest();
}

// ── Factory ─────────────────────────────────────────────────

/**
 * Create an encrypted secrets vault.
 *
 * @param {object} ctx
 * @param {string}   [ctx.persistPath] - Path to vault file on disk
 * @param {Buffer}   [ctx.masterKey]   - 32-byte encryption key (derived from machine if omitted)
 * @param {Function} [ctx.log]         - Logger function
 * @returns {object} Vault API
 */
export function createSecretVault(ctx = {}) {
  const persistPath = ctx.persistPath || null;
  const key = ctx.masterKey || deriveMachineKey();
  const log = ctx.log || (() => {});

  if (key.length !== 32) {
    throw new Error('masterKey must be exactly 32 bytes');
  }

  // ── Internal State ──────────────────────────────────────

  /** @type {Map<string, { iv: string, tag: string, ciphertext: string, label: string|null, createdAt: string, updatedAt: string }>} */
  const entries = new Map();

  // ── Crypto helpers ──────────────────────────────────────

  function _encrypt(plaintext) {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      ciphertext: encrypted.toString('hex'),
    };
  }

  function _decrypt({ iv, tag, ciphertext }) {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  }

  // ── Validation ──────────────────────────────────────────

  function validateName(name) {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('Secret name must be a non-empty string');
    }
    if (name.length > MAX_NAME_LENGTH) {
      throw new Error(`Secret name exceeds max length (${MAX_NAME_LENGTH})`);
    }
    if (!NAME_PATTERN.test(name)) {
      throw new Error('Secret name must be alphanumeric + underscore only');
    }
  }

  // ── CRUD ────────────────────────────────────────────────

  /**
   * Set (create or update) a secret.
   * @param {string} name - Alphanumeric + underscore, max 64 chars
   * @param {string} value - Plaintext value to encrypt
   * @param {string} [label] - Human-readable label
   */
  function set(name, value, label) {
    validateName(name);
    if (typeof value !== 'string') {
      throw new Error('Secret value must be a string');
    }

    const now = new Date().toISOString();
    const existing = entries.get(name);
    const encrypted = _encrypt(value);

    entries.set(name, {
      ...encrypted,
      label: label !== undefined ? label : (existing ? existing.label : null),
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    });

    if (persistPath) save();
    log(`[secrets] Set secret: ${name}`);
  }

  /**
   * Get decrypted value of a secret.
   * @param {string} name
   * @returns {string|null} Decrypted value or null if not found
   */
  function get(name) {
    validateName(name);
    const entry = entries.get(name);
    if (!entry) return null;
    return _decrypt(entry);
  }

  /**
   * Check if a secret exists.
   * @param {string} name
   * @returns {boolean}
   */
  function has(name) {
    validateName(name);
    return entries.has(name);
  }

  /**
   * Remove a secret.
   * @param {string} name
   * @returns {boolean} true if existed and was removed
   */
  function remove(name) {
    validateName(name);
    if (!entries.has(name)) return false;
    entries.delete(name);
    if (persistPath) save();
    log(`[secrets] Removed secret: ${name}`);
    return true;
  }

  /**
   * List all secrets (metadata only, no values).
   * @returns {Array<{ name: string, label: string|null, createdAt: string, updatedAt: string }>}
   */
  function list() {
    const result = [];
    for (const [name, entry] of entries) {
      result.push({
        name,
        label: entry.label,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      });
    }
    return result;
  }

  /**
   * Get all decrypted values as a map.
   * @returns {object} { name: decryptedValue }
   */
  function getAll() {
    const result = {};
    for (const [name, entry] of entries) {
      result[name] = _decrypt(entry);
    }
    return result;
  }

  // ── Persistence ─────────────────────────────────────────

  /**
   * Save vault to disk (atomic write).
   */
  function save() {
    if (!persistPath) return;

    const data = {
      _version: 1,
      entries: {},
    };

    for (const [name, entry] of entries) {
      data.entries[name] = { ...entry };
    }

    const dir = dirname(persistPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const tmpFile = persistPath + '.tmp';
    try {
      writeFileSync(tmpFile, JSON.stringify(data, null, 2));
      renameSync(tmpFile, persistPath);
    } catch (_err) {
      // Fallback: direct write
      writeFileSync(persistPath, JSON.stringify(data, null, 2));
      try { unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  }

  /**
   * Load vault from disk.
   * @returns {{ loaded: boolean, count: number }}
   */
  function load() {
    if (!persistPath) return { loaded: false, count: 0 };

    if (!existsSync(persistPath)) {
      // Try .tmp recovery
      const tmpFile = persistPath + '.tmp';
      if (existsSync(tmpFile)) {
        try {
          const raw = readFileSync(tmpFile, 'utf-8');
          const data = JSON.parse(raw);
          _fromJSON(data);
          try { renameSync(tmpFile, persistPath); } catch { /* ignore */ }
          log('[secrets] Recovered from .tmp file');
          return { loaded: true, count: entries.size, recovered: true };
        } catch {
          return { loaded: false, count: 0 };
        }
      }
      return { loaded: false, count: 0 };
    }

    try {
      const raw = readFileSync(persistPath, 'utf-8');
      const data = JSON.parse(raw);
      _fromJSON(data);
      // Clean up orphaned .tmp
      try { unlinkSync(persistPath + '.tmp'); } catch { /* ignore */ }
      log(`[secrets] Loaded ${entries.size} secrets`);
      return { loaded: true, count: entries.size };
    } catch (err) {
      log(`[secrets] Failed to load vault: ${err.message}`);
      return { loaded: false, count: 0 };
    }
  }

  /**
   * Restore state from parsed JSON data.
   * @param {object} data
   */
  function _fromJSON(data) {
    entries.clear();
    if (data && data.entries && typeof data.entries === 'object') {
      for (const [name, entry] of Object.entries(data.entries)) {
        entries.set(name, entry);
      }
    }
  }

  // ── Public API ──────────────────────────────────────────

  return {
    set,
    get,
    has,
    remove,
    list,
    getAll,
    save,
    load,
    get persistPath() { return persistPath; },
  };
}

export { MAX_NAME_LENGTH, NAME_PATTERN };
