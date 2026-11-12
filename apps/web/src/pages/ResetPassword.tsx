import { Link } from '@/lib/nav';
import { useSearchParams } from '@/lib/nav';
import { Suspense, useState } from 'react';
import { AuthForm } from '@/components/AuthForm';
import { Field, Loading } from '@/components/ui';
import { api } from '@/lib/api';

function Form() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  return (
    <AuthForm
      title="Choose a new password"
      submitLabel="Set password"
      success="Password updated. All other sessions were signed out. You can sign in now."
      onSubmit={async () => {
        await api('POST', '/auth/recovery/confirm', { token, password });
      }}
      footer={<Link href="/login">Go to sign in</Link>}
    >
      {(errs) => (
        <Field
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          hint="At least 12 characters."
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          {...(errs['password'] ? { error: errs['password'] } : {})}
        />
      )}
    </AuthForm>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Form />
    </Suspense>
  );
}
