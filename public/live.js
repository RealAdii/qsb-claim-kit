import { mountClaim, httpClient, startCountdown } from "./claim.js?v=2";

startCountdown(document.querySelector("#yr-countdown"));

await mountClaim({
  entry: document.querySelector("#claim-entry"),
  client: httpClient(),
});
