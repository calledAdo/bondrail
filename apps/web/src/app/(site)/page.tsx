// The landing page (DESIGN.md: dark framed hero with the split, live numbers, two tiers, trust).
import { SiteFooter, SiteNav } from '@/components/site/chrome';
import { Hero } from '@/components/site/hero';
import { Audiences, HowItWorks, LiveStrip, PaymentMarquee, Stack, Tiers, TrustFAQ } from '@/components/site/sections';

export default function Landing() {
  return (
    <>
      <SiteNav />
      <main id="main">
        <Hero />
        <PaymentMarquee />
        <LiveStrip />
        <HowItWorks />
        <Tiers />
        <Audiences />
        <TrustFAQ />
        <Stack />
      </main>
      <SiteFooter />
    </>
  );
}
