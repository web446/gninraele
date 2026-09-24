// Storage for the three models: users, subscriptions, chats.
// MongoDB when MONGODB_URI is set, otherwise JSON files in ./data (development only).
import fs from "fs/promises";
import path from "path";

const CHAT_META = ["id", "userId", "courseId", "title", "model", "createdAt", "updatedAt", "messageCount", "preview"];
export const chatMeta = (c) => Object.fromEntries(CHAT_META.map((k) => [k, c[k]]));

/* ---------------- file store (development fallback) ---------------- */
function fileCollection(dir) {
  const file = (id) => path.join(dir, `${encodeURIComponent(id)}.json`);
  const all = async () => {
    await fs.mkdir(dir, { recursive: true });
    const names = (await fs.readdir(dir)).filter((n) => n.endsWith(".json"));
    const rows = await Promise.all(names.map((n) => fs.readFile(path.join(dir, n), "utf8").then(JSON.parse).catch(() => null)));
    return rows.filter(Boolean);
  };
  const match = (row, where) => Object.entries(where || {}).every(([k, v]) => row[k] === v);
  return {
    async find(where = {}, { sort, limit, project } = {}) {
      let rows = (await all()).filter((r) => match(r, where));
      if (sort) {
        const [key, dir] = Object.entries(sort)[0];
        rows.sort((a, b) => String(a[key] ?? "").localeCompare(String(b[key] ?? "")) * (dir < 0 ? -1 : 1));
      }
      if (limit) rows = rows.slice(0, limit);
      return project ? rows.map(project) : rows;
    },
    async findOne(where) {
      return (await this.find(where))[0] || null;
    },
    async insert(doc) {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(file(doc.id), JSON.stringify(doc));
      return doc;
    },
    async update(id, fields, where = {}) {
      const doc = await this.findOne({ id, ...where });
      if (!doc) return null;
      const next = { ...doc, ...fields };
      await this.insert(next);
      return next;
    },
    async replace(doc, where = {}) {
      const existing = await this.findOne({ id: doc.id });
      if (existing && !match(existing, where)) return null;
      return this.insert(doc);
    },
    async remove(id, where = {}) {
      const doc = await this.findOne({ id, ...where });
      if (!doc) return false;
      await fs.rm(file(id), { force: true });
      return true;
    },
    async count(where = {}) {
      return (await this.find(where)).length;
    },
    async groupCount(field, where = {}) {
      const out = {};
      for (const r of await this.find(where)) out[r[field]] = (out[r[field]] || 0) + 1;
      return out;
    },
  };
}

/* ---------------- mongo store ---------------- */
function mongoCollection(col) {
  const out = (d) => {
    if (!d) return null;
    const { _id, ...rest } = d;
    return { id: _id, ...rest };
  };
  const clean = (d) => { const { id, ...rest } = d; return { _id: id, ...rest }; };
  return {
    async find(where = {}, { sort, limit, project } = {}) {
      let q = col.find(where, project ? { projection: project } : {});
      if (sort) q = q.sort(sort);
      if (limit) q = q.limit(limit);
      return (await q.toArray()).map(out);
    },
    async findOne(where) {
      return out(await col.findOne(where));
    },
    async insert(doc) {
      await col.insertOne(clean(doc));
      return doc;
    },
    async update(id, fields, where = {}) {
      const r = await col.findOneAndUpdate({ _id: id, ...where }, { $set: fields }, { returnDocument: "after" });
      return out(r?.value ?? r);
    },
    async replace(doc, where = {}) {
      const r = await col.replaceOne({ _id: doc.id, ...where }, clean(doc), { upsert: false });
      if (r.matchedCount) return doc;
      const exists = await col.findOne({ _id: doc.id });
      if (exists) return null; // belongs to someone else
      await col.insertOne(clean(doc));
      return doc;
    },
    async remove(id, where = {}) {
      return (await col.deleteOne({ _id: id, ...where })).deletedCount > 0;
    },
    count: (where = {}) => col.countDocuments(where),
    async groupCount(field, where = {}) {
      const rows = await col.aggregate([{ $match: where }, { $group: { _id: `$${field}`, n: { $sum: 1 } } }]).toArray();
      return Object.fromEntries(rows.map((r) => [r._id, r.n]));
    },
  };
}

export async function createStore(rootDir) {
  const uri = (process.env.MONGODB_URI || "").trim();
  if (uri) {
    try {
      const { MongoClient } = await import("mongodb");
      const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
      await client.connect();
      const db = client.db(process.env.MONGODB_DB || "elearning_chat");
      await db.collection("users").createIndex({ username: 1 }, { unique: true });
      await db.collection("subscriptions").createIndex({ userId: 1, endDate: -1 });
      await db.collection("chats").createIndex({ userId: 1, updatedAt: -1 });
      console.log("Storage: MongoDB");
      return {
        kind: "mongodb",
        users: mongoCollection(db.collection("users")),
        subs: mongoCollection(db.collection("subscriptions")),
        chats: mongoCollection(db.collection("chats")),
      };
    } catch (err) {
      console.error(`MongoDB connection failed (${err.message}). Falling back to local files.`);
    }
  }
  console.log("Storage: local files in ./data (temporary, for development only)");
  const dir = (name) => path.join(rootDir, "data", name);
  return {
    kind: "file",
    users: fileCollection(dir("users")),
    subs: fileCollection(dir("subscriptions")),
    chats: fileCollection(dir("chats")),
  };
}
