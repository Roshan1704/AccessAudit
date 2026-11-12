import { useParams } from '@/lib/nav';
import { useAuth } from '@/components/AuthProvider';
import type { OrgSummary } from '@/lib/api';

/** Current org from the route, resolved against the user's memberships (undefined if not a member). */
export function useOrg(): { orgId: string; org: OrgSummary | undefined } {
  const { orgId } = useParams<{ orgId: string }>();
  const { organizations } = useAuth();
  return { orgId, org: organizations.find((o) => o.id === orgId) };
}
