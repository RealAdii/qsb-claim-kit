import "../public/claim-component.css";

/**
 * Dark video hero for the QSB rewards page. Colors follow the .challenge-qsb
 * theme on the challenge page. Copy the two files in public/media to whatever
 * path the app serves static assets from and pass it as mediaBase; the server
 * must answer byte range requests for the video, or Safari will not play it.
 */
export default function QsbHero({ mediaBase = "/media", leaderboardUrl = "https://www.yukon.org/qsb" }) {
  return (
    <section className="yr-hero">
      <video className="yr-hero-video" autoPlay muted loop playsInline preload="auto" poster={`${mediaBase}/hero-poster.jpg`} aria-hidden="true" tabIndex={-1}>
        <source src={`${mediaBase}/hero.mp4`} type="video/mp4" />
      </video>
      <div className="yr-hero-inner">
        <header className="yr-top">
          <div className="yr-lockup">
            <a className="yr-brand" href="https://www.yukon.org">Yukon</a>
            <span className="yr-lockup-rule" aria-hidden="true" />
            <a className="yr-brand-qsb" href={leaderboardUrl}>Quantum Safe Bitcoin</a>
            <span className="yr-lockup-with">with</span>
            <a className="yr-starkware" href="https://starkware.co/" target="_blank" rel="noreferrer" aria-label="StarkWare">
              <img src={`${mediaBase}/starkware-logo-white.svg`} alt="" width={201} height={33} />
            </a>
          </div>
          <div className="yr-top-right">
            <a className="yr-navlink" href={leaderboardUrl}>Leaderboard</a>
            {/* QsbClaim renders the connect control here. */}
            <span id="claim-connect" className="yr-header-cta" />
          </div>
        </header>
        <div className="yr-hero-copy">
          <div className="yr-eyebrow">Quantum Safe Bitcoin Challenge · Solver rewards</div>
          <h1>Claim your QSB rewards</h1>
          <p>Week 1 has $2,000 in rewards, and Weeks 2 and 3 have $18,000 in rewards. Connect the GitHub account you used on the leaderboard to check yours.</p>
          <section className="yr-periods" aria-label="Reward totals">
            <article className="yr-period"><span>WEEK 1</span><strong>$2,000</strong><small>in rewards</small></article>
            <article className="yr-period"><span>WEEKS 2 AND 3</span><strong>$18,000</strong><small>in rewards</small></article>
          </section>
        </div>
      </div>
    </section>
  );
}
