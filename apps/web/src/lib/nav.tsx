import { useMemo, type ComponentProps } from 'react';
import {
  Link as RouterLink,
  useLocation,
  useNavigate,
  useParams as useRouterParams,
  useSearchParams as useRouterSearchParams,
} from 'react-router-dom';

/** Thin wrappers over React Router so pages keep a small, stable navigation API. */

export function Link({
  href,
  ...rest
}: Omit<ComponentProps<typeof RouterLink>, 'to'> & { href: string }) {
  return <RouterLink to={href} {...rest} />;
}

export function useRouter(): { push: (to: string) => void; replace: (to: string) => void } {
  const navigate = useNavigate();
  return useMemo(
    () => ({
      push: (to: string) => void navigate(to),
      replace: (to: string) => void navigate(to, { replace: true }),
    }),
    [navigate],
  );
}

export function usePathname(): string {
  return useLocation().pathname;
}

// The type parameter only narrows the route param shape for callers, like Next's useParams did.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function useParams<T extends Record<string, string | undefined>>(): T {
  return useRouterParams() as T;
}

export function useSearchParams(): URLSearchParams {
  return useRouterSearchParams()[0];
}
