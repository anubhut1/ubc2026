// ONE demo x402 seller on Arc MAINNET (real USDC). Disclosed as ours, like the testnet sellers.
//   /sportsfeed/injuries   $0.02  honest injury report            (test a: normal payment)
//   /sportsfeed/bulk       $6.00  over the Circle $5/day cap      (test b: firewall allows, Circle must refuse)
//
// Uses @circle-fin/x402-batching 3.5.0 (aliased as x402-batching-mainnet): our pinned 2.0.4 only knows
// testnets. 3.5.0 defaults to the mainnet facilitator https://gateway-api.circle.com, and Arc mainnet is
// CAIP-2 eip155:5042 (read from the installed package; docs/RESEARCH.md Q10).
//
//   NETWORK=mainnet npm run mainnet -w @agent-firewall/sellers   (payee from MAINNET_SELLER_ADDRESS in .env.sellers)
// The payee is an address only: no keys here. Payments land in that address's Gateway balance.
import { createServer } from "node:http";
import { getAddress, isAddress } from "viem";
import { createGatewayMiddleware } from "x402-batching-mainnet/server";

if (process.env.NETWORK !== "mainnet") {
  console.error("Refusing to start: the mainnet seller only runs with NETWORK=mainnet set explicitly.");
  process.exit(1);
}
const PORT = Number(process.env.MAINNET_SELLERS_PORT ?? 4300);
const ARC_MAINNET = "eip155:5042";
const payee = process.env.MAINNET_SELLER_ADDRESS ?? "";
if (!isAddress(payee)) {
  console.error("Set MAINNET_SELLER_ADDRESS to the address that should receive mainnet payments.");
  process.exit(1);
}

const gateway = createGatewayMiddleware({ sellerAddress: getAddress(payee), networks: ARC_MAINNET, description: "sportsfeed demo seller (Arc mainnet)" });

const INJURIES = [
  "Guard listed questionable (ankle), game-time decision.",
  "Forward out 1-2 weeks (hamstring).",
  "Center cleared to play after concussion protocol.",
];
const routes: Record<string, { price: string; body: () => unknown }> = {
  "/sportsfeed/injuries": { price: "$0.02", body: () => ({ source: "sportsfeed", report: INJURIES[Math.floor(Math.random() * INJURIES.length)], at: new Date().toISOString() }) },
  "/sportsfeed/bulk": { price: "$6.00", body: () => ({ source: "sportsfeed", reports: INJURIES, at: new Date().toISOString() }) },
};

createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://x").pathname;
  if (path === "/health") return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, network: ARC_MAINNET, payee, routes: Object.keys(routes) }));
  const route = routes[path];
  if (!route) return res.writeHead(404).end();
  try {
    void gateway.require(route.price)(req as any, res as any, () => {
      console.log(`[sportsfeed/mainnet] paid ${route.price} ${path}`);
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(route.body()));
    });
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: (e as Error).message }));
  }
}).listen(PORT, () => console.log(`Mainnet demo seller on http://localhost:${PORT} (Circle Gateway, Arc mainnet ${ARC_MAINNET}) → ${payee}`));
