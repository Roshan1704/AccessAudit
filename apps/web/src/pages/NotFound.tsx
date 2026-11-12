import { Link } from '@/lib/nav';
import { EmptyState } from '@/components/ui';

export default function NotFound() {
  return (
    <>
      <h1 className="sr-only">Page not found</h1>
      <EmptyState
        title="Page not found"
        action={
          <Link href="/orgs" className="btn">
            Go to organizations
          </Link>
        }
      >
        That page does not exist or has moved.
      </EmptyState>
    </>
  );
}
