import Link from 'next/link';

/** A friendly 404. Reveals nothing about which routes exist. */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-8">
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="text-sm text-neutral-600">That page does not exist.</p>
      <Link href="/" className="text-sm underline underline-offset-2">
        Go to the home page
      </Link>
    </main>
  );
}
