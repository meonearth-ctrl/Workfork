// Signed-in shell: sidebar navigation (manager-only sections hidden from
// employees) and the user menu.

import { requireUser, isManager } from "@/lib/auth/session";
import { signOut } from "../login/actions";
import { NavLinks } from "./nav-links";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const manager = isManager(user);
  const items = [
    { href: "/", label: "Dashboard" },
    { href: "/schedule", label: manager ? "Schedule" : "My schedule" },
    ...(manager ? [{ href: "/forecast", label: "Forecast" }] : []),
    { href: "/time", label: "Time" },
    { href: "/leave", label: "Leave" },
    ...(manager ? [{ href: "/employees", label: "Employees" }, { href: "/settings", label: "Settings" }] : []),
  ];
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-slate-200 bg-white md:w-56 md:shrink-0 md:border-b-0 md:border-r">
        <div className="flex items-center gap-2 px-4 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand font-bold text-white">W</div>
          <span className="font-semibold">Workforce</span>
          {/* Phones: the user block below is hidden, so sign-out lives here. */}
          <form action={signOut} className="ml-auto md:hidden">
            <button className="text-xs text-slate-500 underline">Sign out</button>
          </form>
        </div>
        <NavLinks items={items} />
        <div className="hidden border-t border-slate-200 px-4 py-4 text-sm md:block">
          <div className="font-medium">{user.name}</div>
          <div className="text-xs capitalize text-slate-500">{user.role}</div>
          <form action={signOut} className="mt-2">
            <button className="text-xs text-slate-500 underline hover:text-slate-800">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
