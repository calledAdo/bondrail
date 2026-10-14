/** Bondrail's selected Split B. Keep the six-unit channel open. */
export function LogoMark({ className = 'size-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 96 96" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 10H26V86H12Z" />
      <path d="M32 10H57C70 10 78 17 78 27C78 37 70 44 57 44H32V32H57C62 32 64 30 64 27C64 24 62 22 57 22H32Z" />
      <path d="M32 52H61C74 52 82 59 82 69C82 79 74 86 61 86H32V74H61C66 74 68 72 68 69C68 66 66 64 61 64H32Z" />
    </svg>
  );
}

/** Official outlined wordmark; no font substitution or altered spacing. */
export function Logo() {
  return (
    <span className="inline-flex w-36 shrink-0 items-center" role="img" aria-label="Bondrail">
      {/* Static SVG assets preserve the supplied identity geometry. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/bondrail-lockup-light.svg" width={504} height={122} alt="" className="block h-auto w-full dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/bondrail-lockup-dark.svg" width={504} height={122} alt="" className="hidden h-auto w-full dark:block" />
    </span>
  );
}
