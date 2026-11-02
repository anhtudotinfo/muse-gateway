import { redirect } from 'next/navigation';

// Settings was dropped; the license has its own page. Keep old links working.
export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  redirect(tab === 'license' ? '/license' : '/accounts');
}
