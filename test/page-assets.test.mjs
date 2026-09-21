// Every asset the page references must resolve from every route the page is
// served at. Relative paths silently 404 under /qsb/rewards, which strips the
// stylesheet, the module and the hero video without any error in the server.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";

const server = spawn(process.execPath, ["server/preview.mjs"], { env: { ...process.env, AUTH_MODE: "demo", PORT: "0", HOST: "127.0.0.1", STORE: "", DATABASE_URL: "" }, stdio: ["ignore", "pipe", "inherit"] });
let base = "";
for await (const chunk of server.stdout) {
  const match = /(http:\/\/127\.0\.0\.1:\d+)/.exec(String(chunk));
  if (match) { base = match[1]; break; }
}
test.after(async () => { server.kill(); await once(server, "exit"); });

const pageRoutes = ["/", "/qsb/rewards", "/qsb/rewards/leaderboard"];
for (const route of pageRoutes) {
  test(`assets referenced by ${route} all resolve`, async () => {
    const page = await fetch(new URL(route, base));
    assert.equal(page.status, 200);
    const html = await page.text();
    const refs = [...html.matchAll(/(?:href|src|poster)="([^"]+)"/g)].map((match) => match[1]).filter((value) => !value.startsWith("http"));
    assert.ok(refs.length >= 4, "expected the page to reference its stylesheet, module and hero media");
    for (const ref of refs) {
      const target = new URL(ref, new URL(route, base));
      const response = await fetch(target, { headers: { Range: "bytes=0-1" } });
      assert.ok(response.ok, `${ref} from ${route} returned ${response.status}`);
      await response.arrayBuffer();
    }
  });
}

test("the hero video is served with byte ranges", async () => {
  const response = await fetch(new URL("/media/hero.mp4", base), { headers: { Range: "bytes=0-1" } });
  assert.equal(response.status, 206);
  assert.match(response.headers.get("content-range") || "", /^bytes 0-1\/\d+$/);
  assert.equal(response.headers.get("content-type"), "video/mp4");
  await response.arrayBuffer();
});
