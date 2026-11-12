import { Link, useParams, usePathname, useRouter } from '@/lib/nav';
import { useEffect, useRef, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useAuth } from '@/components/AuthProvider';
import { BrandMark, ErrorAlert, Loading, Button } from '@/components/ui';
import {
  Building2,
  Home,
  FolderKanban,
  LayoutDashboard,
  Menu,
  Settings,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';

export function Shell() {
  const { status, user, organizations, error, refresh, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ orgId?: string }>();
  const [open, setOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const orgId = params.orgId;
  const org = organizations.find((o) => o.id === orgId);

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
  }, [status, router]);

  // Close the mobile menu and move focus to the new page on navigation.
  // The first render is skipped so the skip link stays the first Tab stop on a fresh page load.
  const previousPath = useRef(pathname);
  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    setOpen(false);
    mainRef.current?.focus();
  }, [pathname]);

  // Escape closes the mobile menu and returns focus to its toggle.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      document.querySelector<HTMLElement>('.menu-toggle')?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (status === 'loading' || status === 'anonymous') {
    return (
      <div className="main">
        <Loading />
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="main">
        <ErrorAlert error={error} onRetry={() => void refresh()} />
      </div>
    );
  }

  const link = (href: string, label: string, Icon: LucideIcon, exact = false) => {
    const current = exact
      ? pathname === href
      : pathname === href || pathname.startsWith(`${href}/`);
    return (
      <li key={href}>
        <Link href={href} className="nav-link" aria-current={current ? 'page' : undefined}>
          <Icon size={18} aria-hidden="true" />
          {label}
        </Link>
      </li>
    );
  };

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <div className="layout">
        <nav id="site-nav" aria-label="Main" className={`sidebar${open ? ' open' : ''}`}>
          <Link href="/orgs" className="brand">
            <BrandMark />
            AccessAudit
          </Link>
          <ul>
            <li>
              <Link href="/" className="nav-link">
                <Home size={18} aria-hidden="true" />
                Home
              </Link>
            </li>
            {link('/orgs', 'Organizations', Building2, true)}
            {link('/account', 'Account', UserRound)}
          </ul>
          {org ? (
            <div>
              <p className="nav-heading" id="org-nav-heading">
                <span className="org-chip" aria-hidden="true">
                  {org.name.charAt(0).toUpperCase()}
                </span>
                {org.name}
              </p>
              <ul aria-labelledby="org-nav-heading">
                {link(`/orgs/${org.id}`, 'Overview', LayoutDashboard, true)}
                {link(`/orgs/${org.id}/projects`, 'Projects', FolderKanban)}
                {link(`/orgs/${org.id}/members`, 'Members', Users)}
                {link(`/orgs/${org.id}/settings`, 'Settings', Settings)}
              </ul>
            </div>
          ) : null}
        </nav>
        <div
          className={`scrim${open ? ' open' : ''}`}
          aria-hidden="true"
          onClick={() => setOpen(false)}
        />
        <div className="shell-main">
          <header className="topbar">
            <button
              type="button"
              className="btn secondary menu-toggle"
              aria-expanded={open}
              aria-controls="site-nav"
              onClick={() => setOpen((o) => !o)}
            >
              <Menu size={18} aria-hidden="true" />
              {open ? 'Close menu' : 'Menu'}
            </button>
            <Link href="/" className="topbar-home">
              <Home size={16} aria-hidden="true" />
              Home
            </Link>
            <div className="topbar-user">
              <span title={user?.email}>
                Signed in as <strong>{user?.name ?? user?.email}</strong>
              </span>
              <Button
                variant="secondary"
                type="button"
                onClick={() => {
                  void logout().then(() => router.replace('/login'));
                }}
              >
                Sign out
              </Button>
            </div>
          </header>
          <main id="main" ref={mainRef} tabIndex={-1} className="main" style={{ outline: 'none' }}>
            <Outlet />
          </main>
        </div>
      </div>
    </>
  );
}
