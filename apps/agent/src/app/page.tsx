export default function Page() {
  return (
    <main>
      <h1>Slice paid research API</h1>
      <p>
        One concise Kimi answer costs 0.01 testnet USDC. Use an x402 client with{" "}
        <code>GET /api/oracle?question=your-question</code>.
      </p>
      <p>
        Payment supports Monad testnet. A payment authorization binds to its
        first accepted request; reuse the same signed request to retrieve its
        cached answer.
      </p>
      <p>
        <a href="/api/health">Readiness</a> ·{" "}
        <a href="/api/config">Current payment configuration</a>
      </p>
    </main>
  );
}
