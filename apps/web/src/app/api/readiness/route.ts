import { NextResponse } from 'next/server';
import { isAddress } from 'viem';
export const dynamic = 'force-dynamic';
export async function GET() {
  const configured = (x: string | undefined) => !!x && isAddress(x) && !/^0x0{40}$/.test(x);
  return NextResponse.json(
    {
      network: Number(process.env.NEXT_PUBLIC_CHAIN_ID || 10143),
      checks: [
        {
          name: 'Settlement token',
          configured: configured(process.env.NEXT_PUBLIC_USDC_ADDRESS),
          detail: 'Address configuration only; token behavior is not verified here.',
        },
        {
          name: 'Factory',
          configured: configured(process.env.NEXT_PUBLIC_FACTORY_ADDRESS),
          detail: 'A configured address is not proof of deployment.',
        },
        {
          name: 'PumpLab bond',
          configured: configured(process.env.NEXT_PUBLIC_PUMPLAB_BOND_ADDRESS),
          detail: 'Actual values are read in the contract workspace.',
        },
        {
          name: 'Oracle Agent bond',
          configured: configured(process.env.NEXT_PUBLIC_AGENT_BOND_ADDRESS),
          detail: 'Independent deployment; no fallback to a different market.',
        },
        {
          name: 'Demo access',
          configured: !!process.env.DEMO_ACCESS_CODE,
          detail: 'Server-side access code and signed, expiring session.',
        },
      ],
      demoActionsConfigured:
        !!process.env.AGENT_BASE_URL &&
        !!process.env.AGENT_ADMIN_TOKEN &&
        !!process.env.DEMO_DIVERT_PAY_TO &&
        !!(process.env.DEMO_COMPLIANT_PAY_TO || process.env.NEXT_PUBLIC_AGENT_ROUTER_ADDRESS),
      nansen: 'Unavailable on testnet',
      mode: 'synthetic-preview',
      at: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
