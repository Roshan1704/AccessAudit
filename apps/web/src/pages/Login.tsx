import { Link } from '@/lib/nav';
import { useRouter } from '@/lib/nav';
import { useEffect, useState } from 'react';
import { AuthForm } from '@/components/AuthForm';
import { useAuth } from '@/components/AuthProvider';
import { Field } from '@/components/ui';
import { api } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (auth.status === 'authenticated') router.replace('/orgs');
  }, [auth.status, router]);

  return (
    <AuthForm
      title="Welcome back"
      intro="Sign in to manage your websites and accessibility audits."
      submitLabel="Sign in"
      onSubmit={async () => {
        await api('POST', '/auth/login', { email, password });
        await auth.refresh();
        router.replace('/orgs');
      }}
      footer={
        <>
          <Link href="/forgot-password">Forgot your password?</Link>
          <span>
            New to AccessAudit? <Link href="/register">Create an account</Link>
          </span>
        </>
      }
    >
      {(errs) => (
        <>
          <Field
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            {...(errs['email'] ? { error: errs['email'] } : {})}
          />
          <Field
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </>
      )}
    </AuthForm>
  );
}
