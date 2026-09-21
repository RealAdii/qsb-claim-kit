// One-click GitHub credentials, using GitHub's App Manifest flow.
//
//   node server/setup-github-app.mjs
//
// GitHub has no API for creating an OAuth App, but a GitHub App can be created
// from a posted manifest: the browser opens a confirmation page, and GitHub
// redirects back here with a one-use code that converts into the client ID and
// secret. Those are written into .env. A GitHub App signs users in through the
// same web flow an OAuth App uses, so server/github-auth.mjs is unchanged.
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

const origin = new URL(process.env.APP_ORIGIN || "http://127.0.0.1:4318");
const envPath = new URL("../.env", import.meta.url);
const state = randomBytes(16).toString("hex");
const suffix = randomBytes(3).toString("hex");
const manifest = {
  name: `Yukon QSB rewards ${suffix}`,
  url: "https://www.yukon.org/qsb",
  redirect_url: new URL("/setup/callback", origin).href,
  callback_urls: [new URL("/auth/github/callback", origin).href],
  description: "Signs QSB solvers in so the rewards page can check their GitHub account against the finalized award list.",
  public: false,
  default_permissions: {},
  default_events: [],
};
const page = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px/1.6 -apple-system,system-ui,sans-serif;max-width:34em;margin:14vh auto;padding:0 24px;color:#0d131c"><h1 style="font-size:22px;letter-spacing:-.03em">${title}</h1>${body}</body>`;

async function writeEnv(clientId, clientSecret) {
  let text = "";
  try { text = await readFile(envPath, "utf8"); } catch { text = ""; }
  const set = (key, value) => {
    text = new RegExp(`^${key}=.*$`, "m").test(text) ? text.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`) : `${text}${text.endsWith("\n") || !text ? "" : "\n"}${key}=${value}\n`;
  };
  set("GITHUB_CLIENT_ID", clientId);
  set("GITHUB_CLIENT_SECRET", clientSecret);
  await writeFile(envPath, text, { mode: 0o600 });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", origin);
  if (url.pathname === "/") {
    const form = `<form id="f" method="post" action="https://github.com/settings/apps/new?state=${state}"><input type="hidden" name="manifest" value='${JSON.stringify(manifest).replaceAll("'", "&apos;")}'><button type="submit" style="font:inherit;padding:12px 18px;border:0;border-radius:8px;background:#b3651f;color:#fff;cursor:pointer">Create the GitHub App</button></form><script>document.getElementById("f").submit()</script>`;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    return res.end(page("Sending you to GitHub", `<p>GitHub will ask you to confirm a new app named <strong>${manifest.name}</strong>. Press the green button there and you land back here with the credentials saved.</p>${form}`));
  }
  if (url.pathname === "/setup/callback") {
    if (url.searchParams.get("state") !== state) { res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }); return res.end(page("That request did not come from this setup run", "<p>Start again with <code>node server/setup-github-app.mjs</code>.</p>")); }
    const code = url.searchParams.get("code");
    try {
      if (!code) throw new Error("GitHub did not return a manifest code.");
      const response = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
        method: "POST", headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "Yukon-QSB-Rewards-Setup" }, signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`GitHub rejected the conversion: ${response.status}`);
      const app = await response.json();
      if (!app.client_id || !app.client_secret) throw new Error("GitHub returned no client credentials.");
      await writeEnv(app.client_id, app.client_secret);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(page("GitHub app created", `<p><strong>${app.name}</strong> is ready and its client ID and secret are in <code>.env</code>. Manage it at <a href="${app.html_url}">${app.html_url}</a>.</p><p>Start the rewards page with <code>npm start</code>, then open <a href="${origin.href}qsb/rewards">${origin.href}qsb/rewards</a> and connect GitHub.</p>`));
      console.log(`\nCreated ${app.name}\n  client id: ${app.client_id}\n  settings:  ${app.html_url}\n  written to .env\n`);
      setTimeout(() => { server.close(); process.exit(0); }, 250);
    } catch (error) {
      res.writeHead(502, { "Content-Type": "text/html; charset=utf-8" });
      res.end(page("Could not finish the setup", `<p>${error.message}</p><p>Run <code>node server/setup-github-app.mjs</code> again.</p>`));
      console.error(error.message);
    }
    return;
  }
  res.writeHead(404); res.end("Not found");
});

server.listen(Number(origin.port || 80), origin.hostname, () => {
  console.log(`Open ${origin.href} and confirm the app on GitHub. Waiting for the redirect back.`);
  spawn("open", [origin.href], { stdio: "ignore" }).on("error", () => {});
});
