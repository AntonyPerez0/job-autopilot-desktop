// The API key and mailbox password, encrypted with Electron's safeStorage
// (macOS Keychain, Windows DPAPI). Only the encrypted bytes touch the disk;
// the decrypted values are kept in memory while the app runs.
import { safeStorage } from "electron";
import fs from "node:fs";

export async function makeSecretStore(file) {
  const read = () => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; } };
  const write = (o) => { fs.writeFileSync(file + ".tmp", JSON.stringify(o)); fs.renameSync(file + ".tmp", file); };
  const available = await safeStorage.isAsyncEncryptionAvailable().catch(() => false);
  const cache = {};
  for (const [k, v] of Object.entries(read())) {
    try {
      if (v.enc) cache[k] = (await safeStorage.decryptStringAsync(Buffer.from(v.enc, "base64"))).result;
      else if (v.plain) cache[k] = v.plain;
    } catch { /* unreadable (another machine or user): the user enters it again */ }
  }
  return {
    get: (key) => cache[key] || "",
    async set(key, value) {
      const all = read();
      if (!value) { delete all[key]; delete cache[key]; }
      else {
        cache[key] = String(value);
        // Linux without a keyring is the only place encryption may be missing; there it is stored as is.
        all[key] = available ? { enc: (await safeStorage.encryptStringAsync(String(value))).toString("base64") } : { plain: String(value) };
      }
      write(all);
    },
  };
}
