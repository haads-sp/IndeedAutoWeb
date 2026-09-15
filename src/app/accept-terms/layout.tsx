import { requireVerifiedSession } from '../gates';

/** Gates /accept-terms before its loading state can stream. See ../gates.ts. */
export default async function AcceptTermsLayout({ children }: LayoutProps<'/accept-terms'>) {
  await requireVerifiedSession('/accept-terms');
  return children;
}
