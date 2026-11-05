/**
 * @cloudflare/workers-oauth-provider 0.9.0 added construction-time protected
 * resource metadata validation: an invalid config now makes
 * `new OAuthProvider()` throw synchronously instead of failing later at
 * request time. src/index.ts constructs the provider at *module scope*
 * (`const oauthProvider = new OAuthProvider({...})`, src/index.ts:55), so if
 * the upgrade ever regresses that config, the whole Worker fails to load —
 * every route, not just OAuth.
 *
 * Primary path: import the real entrypoint and assert it doesn't throw and
 * exposes the expected Worker shape. This is the closest thing to the real
 * failure mode — a broken construction breaks the module import itself.
 */
import { describe, it, expect } from "vitest";

describe("OAuthProvider construction (src/index.ts module scope)", () => {
  it("imports src/index.ts without throwing and exposes fetch + scheduled", async () => {
    const mod = await import("../../src/index");

    expect(mod.default).toBeDefined();
    expect(typeof mod.default.fetch).toBe("function");
    expect(mod.default.scheduled).toBeDefined();
  });
});
