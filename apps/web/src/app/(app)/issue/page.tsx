// Raise: the existing issuance wizard in its pre-redesign styles until the console rebuild (step 5).
import { IssueWizard } from '@/components/issue-wizard';
import '@/styles/legacy.css';

export const metadata = { title: 'Raise' };
export default function Page() {
  return (
    <div className="legacy rounded-xl">
      <IssueWizard />
    </div>
  );
}
