const { v4: uuidv4 } = require("uuid");

const sessions = new Map();

function createSession(payload) {
  const id = uuidv4();
  const session = {
    id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [],
    ...payload,
  };
  sessions.set(id, session);
  return session;
}

function getSession(id) {
  return sessions.get(id) || null;
}

function updateSession(id, patch) {
  const current = sessions.get(id);
  if (!current) return null;
  const updated = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  sessions.set(id, updated);
  return updated;
}

module.exports = {
  createSession,
  getSession,
  updateSession,
};
