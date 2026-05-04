/**
 * Vitest setup: refuse any `globalThis.fetch` call during the test run.
 *
 * Vault canon: requirements §"egress" — orchestrator only talks to TF_BASE_URL,
 * and even that goes through `TfClient` w/ a `fetchImpl` injection seam in
 * tests. So *no* test should hit the real `globalThis.fetch`. If something
 * does, we want to know immediately rather than during a real-TF run.
 *
 * Tests that genuinely need to exercise the wrapper pass `fetchImpl` directly
 * to `TfClient`; those don't trip this guard.
 *
 * Override w/ `ALLOW_TEST_EGRESS=1` (currently unused — placeholder for a
 * future real-TF live-probe smoke test).
 */

const allowEgress = process.env.ALLOW_TEST_EGRESS === "1";

if (!allowEgress) {
  const refuse: typeof globalThis.fetch = (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    return Promise.reject(
      new Error(
        `egress refused in test run: ${url} — tests must inject fetchImpl into TfClient`,
      ),
    );
  };
  globalThis.fetch = refuse;
}
