// STUB (Stage 11): replaced by the landing page.
//
// A route must exist for `next build` to succeed. Registering it as a known stub now is
// what makes prohibition P8 ("never leave a stub you replaced") enforceable later: when
// Stage 11 lands the real landing page, this file is deleted in the same commit.

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-neutral-500">
        Placeholder. The landing page is built last, in Stage 11.
      </p>
    </main>
  );
}
