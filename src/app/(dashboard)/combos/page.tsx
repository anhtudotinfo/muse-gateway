import { redirect } from 'next/navigation';

// Merged into Accounts — keep the old link working.
export default function Page() {
  redirect('/accounts?tab=combos');
}
