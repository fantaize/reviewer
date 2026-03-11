const DEFAULT_TTL_MS = 60 * 1000;

const cache = {};

function setCache(req, res) {
  const { key, value, ttl } = req.body;
  const ttlMs =
    typeof ttl === "number" && ttl > 0 ? ttl * 1000 : DEFAULT_TTL_MS;
  cache[key] = { value, expiresAt: Date.now() + ttlMs };
  res.json({ cached: true });
}

function getCache(req, res) {
  const { key } = req.params;
  const entry = cache[key];
  if (!entry || entry.expiresAt < Date.now()) {
    return res.status(404).json({ error: "Not found" });
  }
  res.json({ value: entry.value });
}

function clearCache(req, res) {
  const pattern = req.query.pattern || "*";
  const regex = new RegExp(
    "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$"
  );
  const deleted = [];
  for (const key of Object.keys(cache)) {
    if (regex.test(key)) {
      delete cache[key];
      deleted.push(key);
    }
  }
  res.json({ cleared: deleted.length, keys: deleted });
}

module.exports = { setCache, getCache, clearCache };
