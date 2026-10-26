// Optimistic sign-in check: requests without a session cookie go straight to
// /login. The real check (is the session valid? what may this user do?) runs on
// the server in requireUser()/requireManager() for every page and action.

import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  if (!request.cookies.has("wf_session")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Everything except the login page, Next.js internals (assets, images, the
  // dev hot-reload socket) and static files.
  matcher: ["/((?!login|_next/|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)"],
};
