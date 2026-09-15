import { requireAcceptedPolicies, requireVerifiedSession } from '../gates';

/** Gates /portal before its loading state can stream, so a refusal is a real redirect. See ../gates.ts. */
export default async function PortalLayout({ children }: LayoutProps<'/portal'>) {
  const session = await requireVerifiedSession('/portal');
  await requireAcceptedPolicies(session, '/portal');
  return children;
}
