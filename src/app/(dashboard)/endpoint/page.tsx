import { redirect } from 'next/navigation';

// Legacy route — the Endpoint & Key tab was merged into Overview.
// Redirect old links instead of 404ing.
export default function EndpointRedirect() {
  redirect('/');
}
