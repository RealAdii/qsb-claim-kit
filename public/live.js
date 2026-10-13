import { mountClaim, httpClient, startCountdown } from "./claim.js?v=3";

startCountdown(document.querySelector("#yr-countdown"));

await mountClaim({
  entry: document.querySelector("#claim-entry"),
  client: httpClient(),
});
