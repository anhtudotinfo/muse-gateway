import { redirect } from 'next/navigation';

// Legacy route — the Pool tab was merged into Quota (per-account controls)
// and Overview (global strategy). Redirect old links instead of 404ing.
export default function PoolRedirect() {
  redirect('/quota');
}
