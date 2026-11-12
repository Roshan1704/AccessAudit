import { useRouter, useSearchParams } from '@/lib/nav';
import { Suspense, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { Button, ErrorAlert, Loading } from '@/components/ui';
import { api } from '@/lib/api';

function Accept() {
  const token = useSearchParams().get('token') ?? '';
  const { refresh } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (!token) return <ErrorAlert error={new Error('This invitation link is missing its token.')} />;

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/invitations/accept', { token });
      await refresh();
      router.replace('/orgs');
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Accept invitation</h1>
      <p>
        You have been invited to join an organization. The invitation must match the email you are
        signed in with.
      </p>
      <ErrorAlert error={error} />
      <Button busy={busy} onClick={() => void accept()}>
        Accept invitation
      </Button>
    </>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<Loading />}>
      <Accept />
    </Suspense>
  );
}
