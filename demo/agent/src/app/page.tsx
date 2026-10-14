export default function Page() {
  return (
    <main>
      <h1>Bondrail paid research API</h1>
      <p>
        One concise AI answer (an open model on Groq; see /api/config for the exact model) costs 0.01 testnet USDC. Use an x402 client with{' '}
        <code>GET /api/oracle?question=your-question</code>.
      </p>
      <p>
        Payment supports Monad testnet. A payment authorization binds to its first accepted request; reuse the
        same signed request to retrieve its cached answer.
      </p>
      <p>
        <a href="/api/health">Readiness</a> · <a href="/api/config">Current payment configuration</a>
      </p>
    </main>
  );
}
