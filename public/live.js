import { mountClaim, httpClient } from "./claim.js?v=2";

await mountClaim({
  entry: document.querySelector("#claim-entry"),
  client: httpClient(),
});
