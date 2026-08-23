type AccessPageProps = {
  searchParams?: Promise<{ error?: string; next?: string }>;
};

export default async function AccessPage({ searchParams }: AccessPageProps) {
  const params = (await searchParams) ?? {};
  const hasError = params.error === "1";
  const misconfigured = params.error === "misconfigured";
  const nextPath =
    typeof params.next === "string" && params.next.startsWith("/")
      ? params.next
      : "/";

  return (
    <main className="min-h-screen bg-[#f4f1e8] px-5 py-10 text-[#17211d] md:px-10">
      <div className="mx-auto mt-10 max-w-md border border-[#17211d]/20 bg-[#fffdf8] p-6 md:p-8">
        <p className="font-mono text-xs font-semibold tracking-[0.16em] text-[#b8452f] uppercase">
          Private beta access
        </p>
        <h1 className="mt-3 font-serif text-4xl leading-tight">Enter access code</h1>
        <p className="mt-3 text-sm leading-6 text-[#516159]">
          This app is restricted while testing. Enter your invite code to continue.
        </p>

        {misconfigured ? (
          <p className="mt-4 rounded border border-[#b8452f]/25 bg-[#b8452f]/5 p-3 text-sm text-[#b8452f]">
            Access control is not configured yet. Set ACCESS_CODE in your deployment
            environment and redeploy.
          </p>
        ) : null}

        {hasError ? (
          <p className="mt-4 rounded border border-[#b8452f]/25 bg-[#b8452f]/5 p-3 text-sm text-[#b8452f]">
            Invalid code. Please try again.
          </p>
        ) : null}

        <form action="/api/access" className="mt-6 space-y-3" method="post">
          <input name="next" type="hidden" value={nextPath} />
          <label className="sr-only" htmlFor="access-code">
            Access code
          </label>
          <input
            autoComplete="one-time-code"
            className="w-full border border-[#17211d]/25 bg-[#f4f1e8] px-4 py-3 text-sm outline-none placeholder:text-[#516159] focus:border-[#b8452f]"
            id="access-code"
            name="code"
            placeholder="Enter access code"
            required
            type="password"
          />
          <button
            className="w-full bg-[#17211d] px-4 py-3 text-sm font-semibold text-[#f4f1e8] transition-colors hover:bg-[#b8452f]"
            type="submit"
          >
            Continue
          </button>
        </form>
      </div>
    </main>
  );
}
