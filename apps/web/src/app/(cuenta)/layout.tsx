export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-12">
      <div className="rounded-[var(--radius-card)] border border-line bg-white p-6 sm:p-8">
        {children}
      </div>
    </div>
  );
}
