import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand text-lg font-bold text-white">W</div>
          <h1 className="text-xl font-semibold">Workforce Planner</h1>
          <p className="text-sm text-slate-500">Sign in to plan shifts, clock time and request leave.</p>
        </div>
        <LoginForm />
        {process.env.NODE_ENV !== "production" && (
          <p className="mt-4 text-center text-xs text-slate-500">
            Demo: manager@example.com, admin@example.com or ben.mueller@example.com — password demo1234
          </p>
        )}
      </div>
    </main>
  );
}
