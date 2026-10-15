import { storeFromEnv } from '@bondrail/observer/store';
import { environment, getConfig } from '../../../lib/config';
import { handlePaidRequest, realBackend } from '../../../lib/payment';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const url = new URL(request.url),
    question = url.searchParams.get('question');
  if (
    question === '' ||
    (question !== null && question.length > 1200) ||
    url.searchParams.getAll('question').length > 1 ||
    [...url.searchParams.keys()].some((k) => k !== 'question')
  )
    return Response.json({ error: 'Provide at most one nonempty question, at most 1200 characters' }, { status: 400 });
  try {
    const env = environment(),
      store = storeFromEnv(),
      config = await getConfig(store);
    return await handlePaidRequest(
      question,
      request.headers.get('PAYMENT-SIGNATURE'),
      env,
      config,
      store,
      realBackend(env),
    );
  } catch {
    return Response.json(
      { error: 'service_unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
