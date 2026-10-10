/** The Slice mark: a circle with one wedge cut out (the slice that repays investors). */
export function LogoMark({ className = 'size-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M12 2a10 10 0 1 0 10 10H12z" fill="currentColor" />
      <path d="M14 0v10h10A10 10 0 0 0 14 0z" fill="var(--color-slice, #10b981)" transform="translate(0.5 -0.5)" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2 font-semibold tracking-tight">
      <LogoMark />
      slice
    </span>
  );
}
