import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { source } from '@/lib/source';
import { Logo } from '@/components/logo';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <DocsLayout
      tree={source.getPageTree()}
      nav={{ title: <Logo />, url: '/' }}
      links={[
        { text: 'Markets', url: '/markets' },
        { text: 'GitHub', url: 'https://github.com/calledAdo/bondrail', external: true },
      ]}
    >
      {children}
    </DocsLayout>
  );
}
