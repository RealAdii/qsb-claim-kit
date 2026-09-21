import { useEffect, useRef } from "react";
import { mountClaim } from "../public/claim.js";
import "../public/claim-component.css";

/** Render the reward claim trigger only when the verified Yukon session owns an award. */
export default function QsbClaim({ endpoint = "/api/yukon/reward-claim", loginUrl = "/auth/github?returnTo=%2Fqsb%2Frewards%3Fgithub%3Dconnected", sessionVersion }) {
  const entry = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    mountClaim({ entry: entry.current, client: {
      async request(method, data) {
        const response = await fetch(endpoint, { method, credentials: "same-origin", signal: controller.signal, headers: data ? { "Content-Type": "application/json" } : {}, body: data ? JSON.stringify(data) : undefined });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not submit your claim.");
        return result;
      },
      status() { return this.request("GET"); },
      save(data) { return this.request("POST", data); },
      connect() { window.location.assign(loginUrl); },
    } });
    return () => { controller.abort(); entry.current?.replaceChildren(); };
  }, [endpoint, loginUrl, sessionVersion]);
  return <section ref={entry} className="yr-claim-card" aria-live="polite" aria-busy="true" />;
}
