import { AccountsHub } from '@/components/hubs/AccountsHub';

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  return <AccountsHub initialTab={tab} />;
}
