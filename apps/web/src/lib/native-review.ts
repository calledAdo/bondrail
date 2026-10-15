export type NativeReview = 'template' | 'individual' | 'template-revoked' | 'unreviewed' | 'unknown';

export function nativeReviewStatus(individual: boolean | undefined, template: string | undefined, approved: boolean | undefined): NativeReview {
  if (template && !/^0x0{64}$/i.test(template) && approved === true) return 'template';
  if (individual === true) return 'individual';
  if (individual === undefined || template === undefined) return 'unknown';
  if (!/^0x0{64}$/i.test(template)) return approved === false ? 'template-revoked' : 'unknown';
  return 'unreviewed';
}

export const nativeReviewLabel: Record<NativeReview, string> = {
  template: 'Deployed from a reviewed template',
  individual: 'Individually reviewed project',
  'template-revoked': 'Template approval revoked',
  unreviewed: 'Unreviewed or approval revoked',
  unknown: 'Review status unavailable',
};
