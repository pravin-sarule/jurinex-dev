const REDIS_DISABLED = process.env.REDIS_DISABLED !== 'false'; // Default to disabled

const DEFAULT_URL = process.env.REDIS_URL || null;

const connectionOptions = (() => {
  if (REDIS_DISABLED) {
    console.log('[Redis] ⚠️ Redis is temporarily disabled');
    return null;
  }

  if (DEFAULT_URL) {
    return { url: DEFAULT_URL };
  }

  const host = process.env.REDIS_HOST || '127.0.0.1';
  const port = Number(process.env.REDIS_PORT || 6379);
  const password = process.env.REDIS_PASSWORD || undefined;
  const tls = process.env.REDIS_TLS === 'true' ? {} : undefined;

  return {
    host,
    port,
    password,
    tls,
  };
})();

const redisConnection = connectionOptions;

module.exports = {
  redisConnection,
  REDIS_DISABLED,
};




