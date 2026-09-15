import { requireFreshRecovery } from '../gates';

/** Gates /reset-password before its loading state can stream. See ../gates.ts. */
export default async function ResetPasswordLayout({ children }: LayoutProps<'/reset-password'>) {
  await requireFreshRecovery();
  return children;
}
