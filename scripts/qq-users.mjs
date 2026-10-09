import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  chmodSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_USERS_FILE = fileURLToPath(new URL("../.cache/qq-bot/users.json", import.meta.url));
const MAX_RECORDS = 1000;

export function maskOpenid(id) {
  if (!id || typeof id !== "string") return "****";
  const str = id.trim();
  if (str.length <= 8) return str.slice(0, 2) + "****" + str.slice(-2);
  return str.slice(0, 4) + "****" + str.slice(-4);
}

export function createUserManager(options = {}) {
  const filePath = options.filePath || DEFAULT_USERS_FILE;
  const root = options.root || join(filePath, "..");

  function ensureDir() {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    try {
      chmodSync(root, 0o700);
    } catch {}
  }

  function load() {
    let result = { users: {}, groups: {}, latest_user_openid: null, latest_group_openid: null };
    if (existsSync(filePath)) {
      try {
        const data = JSON.parse(readFileSync(filePath, "utf8"));
        if (typeof data === "object" && data !== null) {
          result.users = typeof data.users === "object" && data.users !== null ? data.users : {};
          result.groups =
            typeof data.groups === "object" && data.groups !== null ? data.groups : {};
          result.latest_user_openid = data.latest_user_openid || null;
          result.latest_group_openid = data.latest_group_openid || null;
        }
      } catch {}
    }
    // Auto-seed groups from env if empty
    if (Object.keys(result.groups).length === 0) {
      const envGroups = [
        ...(process.env.QQ_NOTIFY_GROUP_OPENIDS
          ? process.env.QQ_NOTIFY_GROUP_OPENIDS.split(",")
          : []),
        ...(process.env.QQ_NOTIFY_GROUP_OPENID ? [process.env.QQ_NOTIFY_GROUP_OPENID] : []),
      ]
        .map((s) => s.trim())
        .filter(Boolean);
      for (const g of envGroups) {
        result.groups[g] = {
          group_openid: g,
          first_seen: Date.now(),
          last_seen: Date.now(),
          interaction_count: 0,
          subscribed: true,
        };
        result.latest_group_openid = g;
      }
    }
    return result;
  }

  function save(data) {
    ensureDir();
    const temp = filePath + "." + randomUUID() + ".tmp";
    try {
      writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600, flag: "wx" });
      renameSync(temp, filePath);
    } finally {
      try {
        unlinkSync(temp);
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }
  }

  return {
    recordUser(userOpenid, meta = {}, now = Date.now()) {
      if (!userOpenid || typeof userOpenid !== "string") return null;
      const cleanId = userOpenid.trim();
      if (!cleanId || cleanId.length > 128) return null;

      const store = load();
      const existing = store.users[cleanId] || {
        user_openid: cleanId,
        first_seen: now,
        interaction_count: 0,
      };

      const keys = Object.keys(store.users);
      if (!store.users[cleanId] && keys.length >= MAX_RECORDS) {
        let oldestKey = keys[0];
        let oldestTime = store.users[oldestKey]?.last_seen || Infinity;
        for (const k of keys) {
          if ((store.users[k]?.last_seen || 0) < oldestTime) {
            oldestKey = k;
            oldestTime = store.users[k]?.last_seen || 0;
          }
        }
        delete store.users[oldestKey];
      }

      existing.last_seen = now;
      existing.interaction_count = (existing.interaction_count || 0) + 1;
      if (meta.last_query) {
        existing.last_query = String(meta.last_query).slice(0, 200);
      }

      store.users[cleanId] = existing;
      store.latest_user_openid = cleanId;

      save(store);
      return existing;
    },

    recordGroup(groupOpenid, meta = {}, now = Date.now()) {
      if (!groupOpenid || typeof groupOpenid !== "string") return null;
      const cleanId = groupOpenid.trim();
      if (!cleanId || cleanId.length > 128) return null;

      const store = load();
      const existing = store.groups[cleanId] || {
        group_openid: cleanId,
        first_seen: now,
        interaction_count: 0,
      };

      const keys = Object.keys(store.groups);
      if (!store.groups[cleanId] && keys.length >= MAX_RECORDS) {
        let oldestKey = keys[0];
        let oldestTime = store.groups[oldestKey]?.last_seen || Infinity;
        for (const k of keys) {
          if ((store.groups[k]?.last_seen || 0) < oldestTime) {
            oldestKey = k;
            oldestTime = store.groups[k]?.last_seen || 0;
          }
        }
        delete store.groups[oldestKey];
      }

      existing.last_seen = now;
      existing.interaction_count = (existing.interaction_count || 0) + 1;
      if (meta.last_query) {
        existing.last_query = String(meta.last_query).slice(0, 200);
      }

      store.groups[cleanId] = existing;
      store.latest_group_openid = cleanId;

      save(store);
      return existing;
    },

    getUsers() {
      return load().users || {};
    },

    getGroups() {
      return load().groups || {};
    },

    getLatestUserOpenid() {
      const store = load();
      return store.latest_user_openid || Object.keys(store.users).pop() || null;
    },

    getLatestGroupOpenid() {
      const store = load();
      return store.latest_group_openid || Object.keys(store.groups).pop() || null;
    },

    getNotificationGroupOpenids() {
      const store = load();
      const groups = store.groups || {};
      const envGroups = [
        ...(process.env.QQ_NOTIFY_GROUP_OPENIDS
          ? process.env.QQ_NOTIFY_GROUP_OPENIDS.split(",")
          : []),
        ...(process.env.QQ_NOTIFY_GROUP_OPENID ? [process.env.QQ_NOTIFY_GROUP_OPENID] : []),
      ]
        .map((s) => s.trim())
        .filter(Boolean);
      const set = new Set(envGroups);
      for (const [id, g] of Object.entries(groups)) {
        if (g.subscribed !== false) set.add(id);
      }
      return Array.from(set);
    },

    subscribeGroup(groupOpenid, meta = {}, now = Date.now()) {
      if (!groupOpenid || typeof groupOpenid !== "string") return false;
      const cleanId = groupOpenid.trim();
      if (!cleanId || cleanId.length > 128) return false;
      const store = load();
      const existing = store.groups[cleanId] || {
        group_openid: cleanId,
        first_seen: now,
        interaction_count: 0,
      };
      existing.subscribed = true;
      existing.last_seen = now;
      if (meta.name) existing.name = String(meta.name).slice(0, 100);
      store.groups[cleanId] = existing;
      store.latest_group_openid = cleanId;
      save(store);
      return true;
    },

    unsubscribeGroup(groupOpenid) {
      if (!groupOpenid || typeof groupOpenid !== "string") return false;
      const cleanId = groupOpenid.trim();
      const store = load();
      if (store.groups[cleanId]) {
        store.groups[cleanId].subscribed = false;
        save(store);
        return true;
      }
      return false;
    },
  };
}

export const defaultUserManager = createUserManager();
