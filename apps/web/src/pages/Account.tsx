import { LogOut } from 'lucide-react';
import { useRouter } from '@/lib/nav';
import { useAuth } from '@/components/AuthProvider';
import { Button, PageHeader } from '@/components/ui';

export default function AccountPage() {
  const { user, organizations, logout } = useAuth();
  const router = useRouter();
  return (
    <>
      <PageHeader title="Account" description="Your profile and sign-in details." />
      <section className="card" aria-labelledby="profile-heading">
        <div className="item-row" style={{ marginBottom: '1.25rem' }}>
          <span className="avatar" aria-hidden="true">
            {(user?.name ?? '?').charAt(0).toUpperCase()}
          </span>
          <div className="grow">
            <h2 id="profile-heading" style={{ margin: 0 }}>
              {user?.name}
            </h2>
            <span className="muted">{user?.email}</span>
          </div>
        </div>
        <dl className="kv">
          <dt>Name</dt>
          <dd>{user?.name}</dd>
          <dt>Email</dt>
          <dd>{user?.email}</dd>
          <dt>Organizations</dt>
          <dd>{organizations.length}</dd>
        </dl>
      </section>
      <Button
        variant="secondary"
        onClick={() => {
          void logout().then(() => router.replace('/login'));
        }}
      >
        <LogOut size={18} aria-hidden="true" />
        Sign out
      </Button>
    </>
  );
}
