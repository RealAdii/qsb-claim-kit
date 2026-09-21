import { mountClaim, httpClient } from "./claim.js";

await mountClaim({
  entry: document.querySelector("#claim-entry"),
  client: httpClient("/api/yukon/reward-claim", "/auth/github"),
});
