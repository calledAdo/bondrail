import { brandMessaging } from '@/lib/brand';
import { CTA } from './sections';
import { Split } from './split';

/** Framed ink hero: monochrome (grain and one soft white light from above), a giant "Bondrail" watermark,
 *  and the split. The only colour is the investors' slice. */
export function Hero() {
  return (
    <section className="px-2 pt-2">
      <div className="grain relative overflow-hidden rounded-xl border border-foreground/10 bg-background">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_60%_45%_at_50%_0%,color-mix(in_oklab,var(--foreground)_9%,transparent),transparent)]"
        />
        <div className="mx-auto flex max-w-5xl flex-col items-center px-6 pb-10 pt-24 text-center sm:pt-32">
          <a
            href="/docs/how-it-works"
            className="mb-8 inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-background/60 py-1 pl-1 pr-3 text-xs text-foreground/70 backdrop-blur-sm transition-colors hover:border-foreground/20"
          >
            <span className="rounded-full bg-primary px-2 py-0.5 font-medium text-primary-foreground">Live</span>
            Revenue bonds on Monad testnet
          </a>
          <h1 className="text-5xl font-semibold leading-[1.02] sm:text-7xl">
            Issue bonds.
            <span className="block bg-gradient-to-r from-foreground/70 to-foreground/30 bg-clip-text text-transparent">
              Raise capital.
            </span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-foreground/60">
            {brandMessaging.description}
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <CTA href="/console">Issue a bond</CTA>
            <CTA href="/markets" outline>
              Explore bonds
            </CTA>
          </div>
          <div className="mt-16 w-full max-w-3xl">
            <Split />
          </div>
        </div>
        <p
          aria-hidden
          className="pointer-events-none -mb-[0.18em] select-none text-center text-[16vw] font-semibold leading-none tracking-tighter text-foreground/[0.04]"
        >
          Bondrail
        </p>
      </div>
    </section>
  );
}
