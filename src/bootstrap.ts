/**
 * Side-effecting bootstrap that MUST be imported before `@notesnook/core`.
 *
 * Two things have to happen before core's module code evaluates:
 *  1. NODE_ENV=production — core resolves its API host at load time; without this
 *     it silently targets http://localhost:* and every request "fetch failed".
 *  2. IPv4-first + happy-eyeballs with a slow-link-tolerant connect window —
 *     api.notesnook.com (Cloudflare) resolves IPv6-first, and on links where IPv6
 *     doesn't route, undici's fetch times out instead of falling back to IPv4.
 *
 * Import this as the very first statement in every entry point (server.ts, login.ts).
 */
import net from "node:net";
import dns from "node:dns";

if (!process.env.NODE_ENV) process.env.NODE_ENV = "production";

dns.setDefaultResultOrder("ipv4first");
net.setDefaultAutoSelectFamily(true);
net.setDefaultAutoSelectFamilyAttemptTimeout(20000);
