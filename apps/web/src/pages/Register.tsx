import { Link } from '@/lib/nav';
import { useRouter } from '@/lib/nav';
import { useState } from 'react';
import { AuthForm } from '@/components/AuthForm';
import { useAuth } from '@/components/AuthProvider';
import { Field } from '@/components/ui';
import { api } from '@/lib/api';

export default function RegisterPage() {
  const router = useRouter();
  const auth = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <AuthForm
      title="Create your account"
      intro="Free to start. After signing up you will set up a workspace for your team and add your first website."
      submitLabel="Create account"
      onSubmit={async () => {
        await api('POST', '/auth/register', { name, email, password });
        await auth.refresh();
        router.replace('/orgs');
      }}
      footer={
        <>
          Already registered? <Link href="/login">Sign in</Link>
        </>
      }
    >
      {(errs) => (
        <>
          <Field
            label="Name"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            {...(errs['name'] ? { error: errs['name'] } : {})}
          />
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
            autoComplete="new-password"
            required
            minLength={12}
            hint={
              password.length >= 12
                ? 'Good: long enough.'
                : password.length === 0
                  ? 'Use 12 or more characters. A short phrase of unrelated words works well.'
                  : `${String(12 - password.length)} more character${password.length === 11 ? '' : 's'} needed.`
            }
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            {...(errs['password'] ? { error: errs['password'] } : {})}
          />
        </>
      )}
    </AuthForm>
  );
}
