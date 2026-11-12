import { Link } from '@/lib/nav';
import { useState } from 'react';
import { AuthForm } from '@/components/AuthForm';
import { Field } from '@/components/ui';
import { api } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  return (
    <AuthForm
      title="Reset your password"
      intro="Enter your email. If an account exists, we send a single-use reset link valid for one hour."
      submitLabel="Send reset link"
      success="If that address has an account, a reset link is on its way."
      onSubmit={async () => {
        await api('POST', '/auth/recovery/request', { email });
      }}
      footer={<Link href="/login">Back to sign in</Link>}
    >
      {(errs) => (
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          {...(errs['email'] ? { error: errs['email'] } : {})}
        />
      )}
    </AuthForm>
  );
}
