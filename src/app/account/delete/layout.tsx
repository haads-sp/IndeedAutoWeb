import { requireVerifiedSession } from '../../gates';

/**
 * Gates /account/delete before its loading state can stream. See ../../gates.ts.
 *
 * Deliberately NOT gated on accepted policies: someone who refuses new terms must still be able
 * to leave (src/app/accept-terms/page.tsx).
 */
export default async function DeleteAccountLayout({ children }: LayoutProps<'/account/delete'>) {
  await requireVerifiedSession('/account/delete');
  return children;
}
