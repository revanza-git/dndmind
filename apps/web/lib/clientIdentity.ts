const CLIENT_ID_KEY = "dndmind_client_id";

function fallbackRandomUuid() {
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join("")
  ].join("-");
}

function createClientId() {
  if (typeof window === "undefined") {
    throw new Error("Local device profile is only available in the browser.");
  }

  return window.crypto.randomUUID ? window.crypto.randomUUID() : fallbackRandomUuid();
}

export function getClientId() {
  if (typeof window === "undefined") {
    throw new Error("Local device profile is only available in the browser.");
  }

  const existing = window.localStorage.getItem(CLIENT_ID_KEY);
  if (existing) {
    return existing;
  }

  const clientId = createClientId();
  window.localStorage.setItem(CLIENT_ID_KEY, clientId);
  return clientId;
}

export function resetClientId() {
  const clientId = createClientId();
  window.localStorage.setItem(CLIENT_ID_KEY, clientId);
  return clientId;
}

export function getClientLabel(clientId = getClientId()) {
  const compact = clientId.replaceAll("-", "").toUpperCase();
  return `Local DM ${compact.slice(-4)}`;
}
