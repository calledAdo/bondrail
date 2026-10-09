import Link from 'next/link';
export default function NotFound() {
  return (
    <div className="empty">
      <h1>Market not found</h1>
      <p>This financing series is not in the configured directory.</p>
      <Link className="button primary" href="/">
        Back to markets
      </Link>
    </div>
  );
}
