import fs from "fs/promises";
import path from "path";

const META_FIELDS = ["id", "course", "title", "model", "createdAt", "updatedAt", "messageCount", "preview"];
const meta = (c) => Object.fromEntries(META_FIELDS.map((k) => [k, c[k]]));

function fileStore(dir) {
  const file = (id) => path.join(dir, `${id}.json`);
  const readAll = async () => {
    await fs.mkdir(dir, { recursive: true });
    const names = (await fs.readdir(dir)).filter((n) => n.endsWith(".json"));
    const chats = await Promise.all(
      names.map((n) => fs.readFile(path.join(dir, n), "utf8").then(JSON.parse).catch(() => null))
    );
    return chats.filter(Boolean);
  };
  return {
    kind: "file",
    async list(course) {
      const all = await readAll();
      return all.filter((c) => !course || c.course === course).map(meta).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async counts() {
      const out = {};
      for (const c of await readAll()) out[c.course] = (out[c.course] || 0) + 1;
      return out;
    },
    async get(id) {
      try { return JSON.parse(await fs.readFile(file(id), "utf8")); } catch { return null; }
    },
    async put(chat) {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(file(chat.id), JSON.stringify(chat));
    },
    async patch(id, fields) {
      const chat = await this.get(id);
      if (!chat) return false;
      await this.put({ ...chat, ...fields });
      return true;
    },
    async remove(id) {
      await fs.rm(file(id), { force: true });
    },
  };
}

async function mongoStore(uri, dbName) {
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const col = client.db(dbName).collection("chats");
  await col.createIndex({ course: 1, updatedAt: -1 });
  const fromDoc = (d) => (d ? { id: d._id, ...Object.fromEntries(Object.entries(d).filter(([k]) => k !== "_id")) } : null);
  return {
    kind: "mongodb",
    async list(course) {
      const docs = await col.find(course ? { course } : {}, { projection: { messages: 0 } }).sort({ updatedAt: -1 }).limit(1000).toArray();
      return docs.map(fromDoc).map(meta);
    },
    async counts() {
      const rows = await col.aggregate([{ $group: { _id: "$course", n: { $sum: 1 } } }]).toArray();
      return Object.fromEntries(rows.map((r) => [r._id, r.n]));
    },
    async get(id) {
      return fromDoc(await col.findOne({ _id: id }));
    },
    async put(chat) {
      const { id, ...rest } = chat;
      await col.replaceOne({ _id: id }, rest, { upsert: true });
    },
    async patch(id, fields) {
      const r = await col.updateOne({ _id: id }, { $set: fields });
      return r.matchedCount > 0;
    },
    async remove(id) {
      await col.deleteOne({ _id: id });
    },
  };
}

export async function createStore(rootDir) {
  const uri = (process.env.MONGODB_URI || "").trim();
  if (uri) {
    try {
      const store = await mongoStore(uri, process.env.MONGODB_DB || "elearning_chat");
      console.log("Chats are stored in MongoDB.");
      return store;
    } catch (err) {
      console.error(`MongoDB connection failed (${err.message}). Falling back to local files.`);
    }
  }
  console.log("Chats are stored in ./data (temporary on Render). Set MONGODB_URI to keep them.");
  return fileStore(path.join(rootDir, "data", "chats"));
}
