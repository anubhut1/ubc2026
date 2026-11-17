// Which Arc network the firewall pays on. Testnet is the default; mainnet only when NETWORK=mainnet is set
// explicitly (in the shell, not in a file), and then .env.firewall.mainnet overrides .env.firewall.
// Imported first by every module that reads payment settings, so the overrides are in place before they do.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type Network = "testnet" | "mainnet";
export const network: Network = process.env.NETWORK === "mainnet" ? "mainnet" : "testnet";

if (network === "mainnet") {
  const file = fileURLToPath(new URL("../../../.env.firewall.mainnet", import.meta.url));
  if (!existsSync(file)) throw new Error("NETWORK=mainnet but .env.firewall.mainnet is missing.");
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trimStart().startsWith("#")) continue;
    if (m[1] === "NETWORK") continue; // the switch itself only comes from the shell
    process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}
