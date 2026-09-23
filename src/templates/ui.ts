import type { Auth, Frontend } from "../stack.ts";
import type { ThemeInfo } from "../theme.ts";

/** What the starter UI templates need to know about the project. */
export interface UiContext {
  scope: string;
  title: string;
  frontend: Frontend;
  auth: Auth;
  theme: ThemeInfo;
}

const FRONTEND_LABELS: Record<Frontend, string> = {
  "tanstack-start": "TanStack Start",
  next: "Next.js",
  "react-router": "React Router",
};

const CLERK_PACKAGES: Record<Frontend, string> = {
  "tanstack-start": "@clerk/tanstack-react-start",
  next: "@clerk/nextjs",
  "react-router": "@clerk/react-router",
};

/**
 * Returns the starter UI as a map of paths relative to apps/web/src. The pages are
 * built from shadcn components and blocks (login-03, sidebar-07), so the chosen
 * theme styles all of them.
 */
export function starterUiFiles(ctx: UiContext): Record<string, string> {
  const files: Record<string, string> = {
    "lib/site.ts": site(ctx),
    "components/app-link.tsx": appLink(ctx),
    "components/brand.tsx": brand(),
    "components/mode-toggle.tsx": modeToggle(ctx),
    "components/site-header.tsx": siteHeader(ctx),
    "components/home-page.tsx": homePage(ctx),
    "components/page-spinner.tsx": pageSpinner(ctx),
  };

  if (ctx.auth !== "none") {
    Object.assign(files, {
      "components/auth-layout.tsx": authLayout(),
      "components/dashboard/user-avatar.tsx": userAvatar(ctx),
      "components/dashboard/nav-user.tsx": navUser(ctx),
      "components/dashboard/app-sidebar.tsx": appSidebar(ctx),
      "components/dashboard/dashboard-shell.tsx": dashboardShell(ctx),
      "components/dashboard/overview.tsx": overview(ctx),
      "components/dashboard/dashboard.tsx": ctx.auth === "clerk" ? clerkDashboard(ctx) : betterAuthDashboard(ctx),
    });
  }
  if (ctx.auth === "better-auth") {
    Object.assign(files, {
      "components/login-page.tsx": loginPage(ctx),
      "components/sign-in-form.tsx": signInForm(ctx),
      "components/sign-up-form.tsx": signUpForm(ctx),
      "components/user-menu.tsx": userMenu(ctx),
    });
  }
  if (ctx.auth === "clerk") files["components/sign-in-gate.tsx"] = signInGate(ctx);

  return { ...files, ...routeFiles(ctx) };
}

// Next needs the directive on anything with hooks or handlers.
function client(ctx: UiContext) {
  return ctx.frontend === "next" ? `"use client";\n\n` : "";
}

function ui(ctx: UiContext, component: string) {
  return `${ctx.scope}/ui/components/${component}`;
}

function paths(auth: Auth) {
  if (auth === "better-auth") return `"/" | "/login" | "/dashboard"`;
  if (auth === "clerk") return `"/" | "/dashboard"`;
  return `"/"`;
}

function site(ctx: UiContext) {
  const env =
    ctx.frontend === "next"
      ? `const serverUrl = (process.env.NEXT_PUBLIC_SERVER_URL ?? "").replace(/\\/$/, "");`
      : `import { ENV } from "@/env.public";\n\nconst serverUrl = ENV.VITE_SERVER_URL.replace(/\\/$/, "");`;
  return `${env}

export const site = {
  name: ${JSON.stringify(ctx.title)},
  serverUrl,
  apiReferenceUrl: \`\${serverUrl}/api-reference\`,
  theme: {
    label: ${JSON.stringify(ctx.theme.label)},
    url: ${JSON.stringify(ctx.theme.url)},
  },
};
`;
}

function appLink(ctx: UiContext) {
  const header = `// Every in-app route. Add a path here when you add a route.
export type AppPath = ${paths(ctx.auth)};

type AppLinkProps = Omit<ComponentProps<"a">, "href"> & { href: AppPath };
`;

  if (ctx.frontend === "next") {
    return `${client(ctx)}import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";

${header}
export function AppLink({ href, ...props }: AppLinkProps) {
  return <Link href={href} {...props} />;
}

export function useAppNavigate() {
  const router = useRouter();

  return (to: AppPath) => router.push(to);
}
`;
  }

  const pkg = ctx.frontend === "tanstack-start" ? "@tanstack/react-router" : "react-router";
  const go = ctx.frontend === "tanstack-start" ? "navigate({ to })" : "navigate(to)";
  return `import type { ComponentProps } from "react";
import { Link, useNavigate } from "${pkg}";

${header}
export function AppLink({ href, ...props }: AppLinkProps) {
  return <Link to={href} {...props} />;
}

export function useAppNavigate() {
  const navigate = useNavigate();

  return (to: AppPath) => {
    void ${go};
  };
}
`;
}

function brand() {
  return `import { LayersIcon } from "lucide-react";

import { site } from "@/lib/site";

export function BrandMark() {
  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
      <LayersIcon className="size-4" />
    </div>
  );
}

export function Brand() {
  return (
    <span className="flex items-center gap-2 font-medium">
      <BrandMark />
      {site.name}
    </span>
  );
}
`;
}

function modeToggle(ctx: UiContext) {
  return `${client(ctx)}import { Button } from "${ui(ctx, "button")}";
import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";

export function ModeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <SunIcon className="dark:hidden" />
      <MoonIcon className="hidden dark:block" />
    </Button>
  );
}
`;
}

function siteHeader(ctx: UiContext) {
  let imports = "";
  let actions = "";
  let body = "";

  if (ctx.auth === "better-auth") {
    imports = `import { UserMenu } from "./user-menu";\n`;
    actions = `<UserMenu />`;
  } else if (ctx.auth === "clerk") {
    imports = `import { SignInButton, UserButton, useUser } from "${CLERK_PACKAGES[ctx.frontend]}";
import { Button, buttonVariants } from "${ui(ctx, "button")}";
`;
    body = `  const { isSignedIn } = useUser();\n\n`;
    actions = `{isSignedIn ? (
            <>
              <AppLink href="/dashboard" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                Dashboard
              </AppLink>
              <UserButton />
            </>
          ) : (
            <SignInButton mode="modal">
              <Button size="sm">Sign in</Button>
            </SignInButton>
          )}`;
  } else {
    imports = `import { buttonVariants } from "${ui(ctx, "button")}";

import { site } from "@/lib/site";
`;
    actions = `<a
            href={site.apiReferenceUrl}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            API reference
          </a>`;
  }

  return `${client(ctx)}${imports}
import { AppLink } from "./app-link";
import { Brand } from "./brand";
import { ModeToggle } from "./mode-toggle";

export function SiteHeader() {
${body}  return (
    <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-6">
        <AppLink href="/">
          <Brand />
        </AppLink>
        <div className="ml-auto flex items-center gap-2">
          <ModeToggle />
          ${actions}
        </div>
      </div>
    </header>
  );
}
`;
}

function homePage(ctx: UiContext) {
  const stack = [FRONTEND_LABELS[ctx.frontend], "Hono and oRPC on Cloudflare Workers", "Drizzle on D1"];
  if (ctx.auth === "better-auth") stack.push("Better Auth");
  if (ctx.auth === "clerk") stack.push("Clerk");
  const description = `${stack.slice(0, -1).join(", ")} and ${stack.at(-1)}, themed with ${ctx.theme.source}.`;

  let imports = "";
  let body = "";
  let primary = "";
  if (ctx.auth === "better-auth") {
    imports = `import { authClient } from "@/lib/auth-client";\n`;
    body = `  const { data: session } = authClient.useSession();\n`;
    primary = `<AppLink href={session ? "/dashboard" : "/login"} className={buttonVariants({ size: "lg" })}>
              {session ? "Open dashboard" : "Get started"}
              <ArrowRightIcon data-icon="inline-end" />
            </AppLink>`;
  } else if (ctx.auth === "clerk") {
    primary = `<AppLink href="/dashboard" className={buttonVariants({ size: "lg" })}>
              Open dashboard
              <ArrowRightIcon data-icon="inline-end" />
            </AppLink>`;
  } else {
    primary = `<a href={site.theme.url} target="_blank" rel="noreferrer" className={buttonVariants({ size: "lg" })}>
              Customize the theme
              <ArrowRightIcon data-icon="inline-end" />
            </a>`;
  }

  return `${client(ctx)}import { Badge } from "${ui(ctx, "badge")}";
import { buttonVariants } from "${ui(ctx, "button")}";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "${ui(ctx, "card")}";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightIcon, ArrowUpRightIcon } from "lucide-react";

${imports}import { site } from "@/lib/site";
import { orpc } from "@/utils/orpc";

${ctx.auth === "none" ? "" : `import { AppLink } from "./app-link";\n`}import { SiteHeader } from "./site-header";

export function HomePage() {
  const healthCheck = useQuery(orpc.healthCheck.queryOptions());
${body}
  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />
      <main className="flex-1">
        <section className="mx-auto flex max-w-5xl flex-col items-start gap-6 px-6 py-16 md:py-24">
          <Badge variant="secondary">Cloudflare Workers + D1</Badge>
          <h1 className="text-4xl font-semibold tracking-tight text-balance md:text-5xl">{site.name}</h1>
          <p className="max-w-2xl text-lg text-balance text-muted-foreground">
            ${description} Start editing in{" "}
            <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-sm text-foreground">
              apps/web/src/components/home-page.tsx
            </code>
            .
          </p>
          <div className="flex flex-wrap gap-3">
            ${primary}
            <a
              href={site.apiReferenceUrl}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "outline", size: "lg" })}
            >
              API reference
            </a>
          </div>
        </section>
        <section className="mx-auto grid max-w-5xl gap-4 px-6 pb-16 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>API</CardTitle>
              <CardDescription>Hono and oRPC on a Worker</CardDescription>
              <CardAction>
                {healthCheck.isPending ? (
                  <Badge variant="outline">Checking</Badge>
                ) : healthCheck.data ? (
                  <Badge variant="secondary">Online</Badge>
                ) : (
                  <Badge variant="destructive">Offline</Badge>
                )}
              </CardAction>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                {healthCheck.data
                  ? "The web app reached the server's healthCheck procedure."
                  : "Start the server with the dev script to bring the API online."}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Database</CardTitle>
              <CardDescription>Drizzle on Cloudflare D1</CardDescription>
              <CardAction>
                <Badge variant="outline">SQLite</Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                Tables live in packages/db/src/schema. Run db:generate after a change, and dev applies the migration
                to your local database.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Theme</CardTitle>
              <CardDescription>{site.theme.label}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <div className="size-8 rounded-md border bg-primary" />
                <div className="size-8 rounded-md border bg-secondary" />
                <div className="size-8 rounded-md border bg-accent" />
                <div className="size-8 rounded-md border bg-muted" />
                <div className="size-8 rounded-md border bg-foreground" />
              </div>
            </CardContent>
            <CardFooter>
              <a href={site.theme.url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
                ${ctx.theme.linkLabel}
                <ArrowUpRightIcon data-icon="inline-end" />
              </a>
            </CardFooter>
          </Card>
        </section>
      </main>
      <footer className="border-t">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-6 text-sm text-muted-foreground">
          <span>{site.name}</span>
          <span>Built with Rat Stack Plus</span>
        </div>
      </footer>
    </div>
  );
}
`;
}

function pageSpinner(ctx: UiContext) {
  return `import { Spinner } from "${ui(ctx, "spinner")}";

export function PageSpinner() {
  return (
    <div className="flex min-h-svh items-center justify-center">
      <div className="text-muted-foreground">
        <Spinner />
      </div>
    </div>
  );
}
`;
}

function authLayout() {
  return `import type { ReactNode } from "react";

import { AppLink } from "./app-link";
import { Brand } from "./brand";

/** Centered card layout from the shadcn login-03 block. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <AppLink href="/" className="self-center">
          <Brand />
        </AppLink>
        {children}
      </div>
    </div>
  );
}
`;
}

function loginPage(ctx: UiContext) {
  return `${client(ctx)}import { useState } from "react";

import { AuthLayout } from "./auth-layout";
import { SignInForm } from "./sign-in-form";
import { SignUpForm } from "./sign-up-form";

export function LoginPage() {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");

  return (
    <AuthLayout>
      {mode === "sign-in" ? (
        <SignInForm onSwitch={() => setMode("sign-up")} />
      ) : (
        <SignUpForm onSwitch={() => setMode("sign-in")} />
      )}
      <p className="px-6 text-center text-sm text-balance text-muted-foreground">
        Accounts and sessions are stored in your D1 database by Better Auth.
      </p>
    </AuthLayout>
  );
}
`;
}

interface FormField {
  name: string;
  label: string;
  type: string;
  autoComplete: string;
  placeholder?: string;
}

function formFields(fields: FormField[]) {
  return fields
    .map(
      (field) => `          <form.Field name="${field.name}">
            {(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid;

              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor={field.name}>${field.label}</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="${field.type}"
                    autoComplete="${field.autoComplete}"${field.placeholder ? `\n                    placeholder="${field.placeholder}"` : ""}
                    value={field.state.value}
                    aria-invalid={invalid}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          </form.Field>`,
    )
    .join("\n");
}

function authForm(
  ctx: UiContext,
  options: {
    name: string;
    title: string;
    description: string;
    submit: string;
    pending: string;
    success: string;
    switchPrompt: string;
    switchLabel: string;
    fields: FormField[];
    call: string;
    schema: string;
  },
) {
  const defaults = options.fields.map((field) => `${field.name}: ""`).join(", ");
  return `${client(ctx)}import { Button } from "${ui(ctx, "button")}";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "${ui(ctx, "card")}";
import { Field, FieldError, FieldGroup, FieldLabel } from "${ui(ctx, "field")}";
import { Input } from "${ui(ctx, "input")}";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import z from "zod";

import { authClient } from "@/lib/auth-client";

import { useAppNavigate } from "./app-link";

export function ${options.name}({ onSwitch }: { onSwitch: () => void }) {
  const navigate = useAppNavigate();

  const form = useForm({
    defaultValues: { ${defaults} },
    onSubmit: async ({ value }) => {
      await ${options.call}(value, {
        onSuccess: () => {
          navigate("/dashboard");
          toast.success("${options.success}");
        },
        onError: (error) => {
          toast.error(error.error.message || error.error.statusText);
        },
      });
    },
    validators: {
      onSubmit: z.object({
${options.schema}
      }),
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>${options.title}</CardTitle>
        <CardDescription>${options.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <FieldGroup>
${formFields(options.fields)}
            <Field>
              <form.Subscribe selector={(state) => state.isSubmitting}>
                {(isSubmitting) => (
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "${options.pending}" : "${options.submit}"}
                  </Button>
                )}
              </form.Subscribe>
              <p className="text-center text-muted-foreground">
                ${options.switchPrompt}{" "}
                <button
                  type="button"
                  className="text-foreground underline underline-offset-4 hover:text-primary"
                  onClick={onSwitch}
                >
                  ${options.switchLabel}
                </button>
              </p>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
`;
}

const EMAIL: FormField = {
  name: "email",
  label: "Email",
  type: "email",
  autoComplete: "email",
  placeholder: "you@example.com",
};

function signInForm(ctx: UiContext) {
  return authForm(ctx, {
    name: "SignInForm",
    title: "Welcome back",
    description: "Sign in with your email and password",
    submit: "Sign in",
    pending: "Signing in...",
    success: "Signed in",
    switchPrompt: "Don't have an account?",
    switchLabel: "Sign up",
    fields: [EMAIL, { name: "password", label: "Password", type: "password", autoComplete: "current-password" }],
    call: "authClient.signIn.email",
    schema: `        email: z.email("Enter a valid email address"),
        password: z.string().min(8, "Passwords are at least 8 characters"),`,
  });
}

function signUpForm(ctx: UiContext) {
  return authForm(ctx, {
    name: "SignUpForm",
    title: "Create an account",
    description: "Enter your details to get started",
    submit: "Create account",
    pending: "Creating account...",
    success: "Account created",
    switchPrompt: "Already have an account?",
    switchLabel: "Sign in",
    fields: [
      { name: "name", label: "Name", type: "text", autoComplete: "name", placeholder: "Ada Lovelace" },
      EMAIL,
      { name: "password", label: "Password", type: "password", autoComplete: "new-password" },
    ],
    call: "authClient.signUp.email",
    schema: `        name: z.string().min(2, "Enter at least 2 characters"),
        email: z.email("Enter a valid email address"),
        password: z.string().min(8, "Use at least 8 characters"),`,
  });
}

function userMenu(ctx: UiContext) {
  return `${client(ctx)}import { Button, buttonVariants } from "${ui(ctx, "button")}";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "${ui(ctx, "dropdown-menu")}";
import { Spinner } from "${ui(ctx, "spinner")}";
import { LayoutDashboardIcon, LogOutIcon } from "lucide-react";

import { authClient } from "@/lib/auth-client";

import { AppLink, useAppNavigate } from "./app-link";
import { UserAvatar } from "./dashboard/user-avatar";

export function UserMenu() {
  const navigate = useAppNavigate();
  const { data: session, isPending } = authClient.useSession();

  if (isPending) return <Spinner />;

  if (!session) {
    return (
      <AppLink href="/login" className={buttonVariants({ size: "sm" })}>
        Sign in
      </AppLink>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Account menu" />}>
        <UserAvatar user={session.user} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <span className="grid text-sm leading-tight">
              <span className="truncate font-medium text-foreground">{session.user.name}</span>
              <span className="truncate text-xs">{session.user.email}</span>
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem render={<AppLink href="/dashboard" />}>
            <LayoutDashboardIcon />
            Dashboard
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              void authClient.signOut({ fetchOptions: { onSuccess: () => navigate("/") } });
            }}
          >
            <LogOutIcon />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
`;
}

function userAvatar(ctx: UiContext) {
  return `${client(ctx)}import { Avatar, AvatarFallback, AvatarImage } from "${ui(ctx, "avatar")}";

export interface DashboardUser {
  name: string;
  email: string;
  image?: string | null;
}

export function UserAvatar({ user }: { user: DashboardUser }) {
  const initials = user.name
    .split(/\\s+/)
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <Avatar>
      {user.image && <AvatarImage src={user.image} alt={user.name} />}
      <AvatarFallback>{initials || "?"}</AvatarFallback>
    </Avatar>
  );
}
`;
}

function navUser(ctx: UiContext) {
  const account =
    ctx.auth === "clerk"
      ? `
            <DropdownMenuItem onClick={onManageAccount}>
              <UserIcon />
              Manage account
            </DropdownMenuItem>`
      : "";
  return `${client(ctx)}import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "${ui(ctx, "dropdown-menu")}";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "${ui(ctx, "sidebar")}";
import { ChevronsUpDownIcon, HomeIcon, LogOutIcon${ctx.auth === "clerk" ? ", UserIcon" : ""} } from "lucide-react";

import { AppLink } from "../app-link";
import { type DashboardUser, UserAvatar } from "./user-avatar";

export interface AccountActions {
  onSignOut: () => void;${ctx.auth === "clerk" ? "\n  onManageAccount: () => void;" : ""}
}

function UserDetails({ user }: { user: DashboardUser }) {
  return (
    <div className="grid flex-1 text-left text-sm leading-tight">
      <span className="truncate font-medium">{user.name}</span>
      <span className="truncate text-xs text-muted-foreground">{user.email}</span>
    </div>
  );
}

export function NavUser({ user, onSignOut${ctx.auth === "clerk" ? ", onManageAccount" : ""} }: { user: DashboardUser } & AccountActions) {
  const { isMobile } = useSidebar();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
            <UserAvatar user={user} />
            <UserDetails user={user} />
            <ChevronsUpDownIcon className="ml-auto" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side={isMobile ? "bottom" : "right"} align="end" sideOffset={4}>
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                <div className="flex items-center gap-2 text-foreground">
                  <UserAvatar user={user} />
                  <UserDetails user={user} />
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>${account}
              <DropdownMenuItem render={<AppLink href="/" />}>
                <HomeIcon />
                Home
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onSignOut}>
                <LogOutIcon />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
`;
}

function appSidebar(ctx: UiContext) {
  return `${client(ctx)}import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "${ui(ctx, "sidebar")}";
import { BookOpenIcon, HomeIcon, LayoutDashboardIcon, PaletteIcon } from "lucide-react";

import { site } from "@/lib/site";

import { AppLink } from "../app-link";
import { BrandMark } from "../brand";
import { type AccountActions, NavUser } from "./nav-user";
import type { DashboardUser } from "./user-avatar";

export function AppSidebar({ user, ...actions }: { user: DashboardUser } & AccountActions) {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<AppLink href="/" />}>
              <BrandMark />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{site.name}</span>
                <span className="truncate text-xs text-muted-foreground">Workspace</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>App</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton isActive tooltip="Overview" render={<AppLink href="/dashboard" />}>
                <LayoutDashboardIcon />
                <span>Overview</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Home" render={<AppLink href="/" />}>
                <HomeIcon />
                <span>Home</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Resources</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="API reference"
                render={<a href={site.apiReferenceUrl} target="_blank" rel="noreferrer" />}
              >
                <BookOpenIcon />
                <span>API reference</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Theme" render={<a href={site.theme.url} target="_blank" rel="noreferrer" />}>
                <PaletteIcon />
                <span>Theme</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} {...actions} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
`;
}

function dashboardShell(ctx: UiContext) {
  return `${client(ctx)}import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "${ui(ctx, "breadcrumb")}";
import { Separator } from "${ui(ctx, "separator")}";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "${ui(ctx, "sidebar")}";
import { TooltipProvider } from "${ui(ctx, "tooltip")}";
import type { ReactNode } from "react";

import { AppLink } from "../app-link";
import { ModeToggle } from "../mode-toggle";
import { AppSidebar } from "./app-sidebar";
import type { AccountActions } from "./nav-user";
import type { DashboardUser } from "./user-avatar";

/** Sidebar layout from the shadcn sidebar-07 block. */
export function DashboardShell({
  user,
  children,
  ...actions
}: { user: DashboardUser; children: ReactNode } & AccountActions) {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar user={user} {...actions} />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger />
            <div className="flex h-4">
              <Separator orientation="vertical" />
            </div>
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink render={<AppLink href="/" />}>Home</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>Overview</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            <div className="ml-auto">
              <ModeToggle />
            </div>
          </header>
          <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
`;
}

function overview(ctx: UiContext) {
  const sessionNote =
    ctx.auth === "clerk"
      ? "Clerk manages users and sessions. The server verifies the Clerk token on every oRPC call."
      : "Better Auth stores users and sessions in D1. The server reads the session cookie on every oRPC call.";
  return `${client(ctx)}import { Badge } from "${ui(ctx, "badge")}";
import { buttonVariants } from "${ui(ctx, "button")}";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "${ui(ctx, "card")}";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "${ui(ctx, "empty")}";
import { useQuery } from "@tanstack/react-query";
import { LockIcon, SparklesIcon } from "lucide-react";

import { site } from "@/lib/site";
import { orpc } from "@/utils/orpc";

import { type DashboardUser, UserAvatar } from "./user-avatar";

export function Overview({ user }: { user: DashboardUser }) {
  const privateData = useQuery(orpc.privateData.queryOptions());
  const firstName = user.name.split(" ")[0] || user.name;

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back, {firstName}</h1>
        <p className="text-muted-foreground">Only signed-in users can see this page.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>Your signed-in profile</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <UserAvatar user={user} />
              <div className="grid min-w-0 leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <span className="truncate text-muted-foreground">{user.email}</span>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Private API</CardTitle>
            <CardDescription>orpc.privateData</CardDescription>
            <CardAction>
              <Badge variant="secondary">
                <LockIcon data-icon="inline-start" />
                Protected
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            {privateData.isPending ? (
              <span className="text-muted-foreground">Loading...</span>
            ) : privateData.data ? (
              <span className="font-mono">{privateData.data.message}</span>
            ) : (
              <span className="text-destructive">The request failed. Is the server running?</span>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Sessions</CardTitle>
            <CardDescription>How auth works here</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">${sessionNote}</p>
          </CardContent>
        </Card>
      </div>
      <div className="flex flex-1 rounded-lg border border-dashed">
        <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SparklesIcon />
          </EmptyMedia>
          <EmptyTitle>Build your first feature</EmptyTitle>
          <EmptyDescription>
            Add a table in packages/db, a procedure in packages/api, and show it here. This page lives in
            apps/web/src/components/dashboard/overview.tsx.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <a
            href={site.apiReferenceUrl}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Open the API reference
          </a>
        </EmptyContent>
        </Empty>
      </div>
    </>
  );
}
`;
}

function betterAuthDashboard(ctx: UiContext) {
  return `${client(ctx)}import { authClient } from "@/lib/auth-client";

import { useAppNavigate } from "../app-link";
import { DashboardShell } from "./dashboard-shell";
import { Overview } from "./overview";
import type { DashboardUser } from "./user-avatar";

export function Dashboard({ user }: { user: DashboardUser }) {
  const navigate = useAppNavigate();

  return (
    <DashboardShell
      user={user}
      onSignOut={() => {
        void authClient.signOut({ fetchOptions: { onSuccess: () => navigate("/") } });
      }}
    >
      <Overview user={user} />
    </DashboardShell>
  );
}
`;
}

function clerkDashboard(ctx: UiContext) {
  return `${client(ctx)}import { useClerk, useUser } from "${CLERK_PACKAGES[ctx.frontend]}";

import { PageSpinner } from "../page-spinner";
import { SignInGate } from "../sign-in-gate";
import { DashboardShell } from "./dashboard-shell";
import { Overview } from "./overview";

export function Dashboard() {
  const { isLoaded, user } = useUser();
  const clerk = useClerk();

  if (!isLoaded) return <PageSpinner />;

  if (!user) return <SignInGate />;

  const email = user.primaryEmailAddress?.emailAddress ?? "";

  const account = { name: user.fullName || user.username || email || "Account", email, image: user.imageUrl };

  return (
    <DashboardShell
      user={account}
      onSignOut={() => {
        void clerk.signOut({ redirectUrl: "/" });
      }}
      onManageAccount={() => clerk.openUserProfile()}
    >
      <Overview user={account} />
    </DashboardShell>
  );
}
`;
}

function signInGate(ctx: UiContext) {
  return `${client(ctx)}import { SignInButton } from "${CLERK_PACKAGES[ctx.frontend]}";
import { Button } from "${ui(ctx, "button")}";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "${ui(ctx, "card")}";

import { AuthLayout } from "./auth-layout";

export function SignInGate() {
  return (
    <AuthLayout>
      <Card>
        <CardHeader>
          <CardTitle>Sign in to continue</CardTitle>
          <CardDescription>The dashboard is only visible to signed-in users.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid">
            <SignInButton mode="modal">
              <Button>Sign in</Button>
            </SignInButton>
          </div>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
`;
}

function routeFiles(ctx: UiContext): Record<string, string> {
  if (ctx.frontend === "tanstack-start") return tanstackRoutes(ctx);
  if (ctx.frontend === "next") return nextRoutes(ctx);
  return reactRouterRoutes(ctx);
}

function tanstackRoutes(ctx: UiContext): Record<string, string> {
  const files: Record<string, string> = {
    "routes/index.tsx": `import { createFileRoute } from "@tanstack/react-router";

import { HomePage } from "@/components/home-page";

export const Route = createFileRoute("/")({
  component: HomePage,
});
`,
  };
  if (ctx.auth === "better-auth") {
    files["routes/login.tsx"] = `import { createFileRoute } from "@tanstack/react-router";

import { LoginPage } from "@/components/login-page";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});
`;
    files["routes/_auth/route.tsx"] = `import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { PageSpinner } from "@/components/page-spinner";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/_auth")({
  ssr: false,
  component: Outlet,
  pendingComponent: PageSpinner,
  beforeLoad: async () => {
    const session = await authClient.getSession();

    if (!session.data) {
      throw redirect({ to: "/login" });
    }

    return { user: session.data.user };
  },
});
`;
    files["routes/_auth/dashboard.tsx"] = `import { createFileRoute } from "@tanstack/react-router";

import { Dashboard } from "@/components/dashboard/dashboard";

export const Route = createFileRoute("/_auth/dashboard")({
  component: RouteComponent,
});

function RouteComponent() {
  const { user } = Route.useRouteContext();

  return <Dashboard user={user} />;
}
`;
  }
  if (ctx.auth === "clerk") {
    files["routes/_auth/route.tsx"] = `import { Outlet, createFileRoute } from "@tanstack/react-router";

// The dashboard checks the Clerk session itself and shows a sign-in card without one.
export const Route = createFileRoute("/_auth")({
  component: Outlet,
});
`;
    files["routes/_auth/dashboard.tsx"] = `import { createFileRoute } from "@tanstack/react-router";

import { Dashboard } from "@/components/dashboard/dashboard";

export const Route = createFileRoute("/_auth/dashboard")({
  component: Dashboard,
});
`;
  }
  return files;
}

function nextRoutes(ctx: UiContext): Record<string, string> {
  const files: Record<string, string> = {
    "app/page.tsx": `import { HomePage } from "@/components/home-page";

export default function Page() {
  return <HomePage />;
}
`,
  };
  if (ctx.auth === "better-auth") {
    files["app/login/page.tsx"] = `import { LoginPage } from "@/components/login-page";

export default function Page() {
  return <LoginPage />;
}
`;
    files["app/dashboard/page.tsx"] = `import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { Dashboard } from "@/components/dashboard/dashboard";
import { authClient } from "@/lib/auth-client";

export default async function Page() {
  const session = await authClient.getSession({
    fetchOptions: {
      headers: await headers(),
      throw: true,
    },
  });

  if (!session?.user) {
    redirect("/login");
  }

  const { name, email, image } = session.user;

  return <Dashboard user={{ name, email, image }} />;
}
`;
  }
  if (ctx.auth === "clerk") {
    files["app/dashboard/page.tsx"] = `import { Dashboard } from "@/components/dashboard/dashboard";

export default function Page() {
  return <Dashboard />;
}
`;
  }
  return files;
}

function reactRouterMeta(page: string) {
  return `export function meta() {
  return [{ title: ${page ? `\`${page} | \${site.name}\`` : "site.name"} }];
}`;
}

function reactRouterRoutes(ctx: UiContext): Record<string, string> {
  const files: Record<string, string> = {
    "routes/_index.tsx": `import { HomePage } from "@/components/home-page";
import { site } from "@/lib/site";

${reactRouterMeta("")}

export default function Home() {
  return <HomePage />;
}
`,
  };
  if (ctx.auth === "better-auth") {
    files["routes/login.tsx"] = `import { LoginPage } from "@/components/login-page";
import { site } from "@/lib/site";

${reactRouterMeta("Sign in")}

export default function Login() {
  return <LoginPage />;
}
`;
    files["routes/dashboard.tsx"] = `import { useEffect } from "react";
import { useNavigate } from "react-router";

import { Dashboard } from "@/components/dashboard/dashboard";
import { PageSpinner } from "@/components/page-spinner";
import { authClient } from "@/lib/auth-client";
import { site } from "@/lib/site";

${reactRouterMeta("Dashboard")}

export default function DashboardRoute() {
  const { data: session, isPending } = authClient.useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!session && !isPending) {
      void navigate("/login");
    }
  }, [session, isPending, navigate]);

  if (!session) return <PageSpinner />;

  return <Dashboard user={session.user} />;
}
`;
  }
  if (ctx.auth === "clerk") {
    files["routes/dashboard.tsx"] = `import { Dashboard } from "@/components/dashboard/dashboard";
import { site } from "@/lib/site";

${reactRouterMeta("Dashboard")}

export default function DashboardRoute() {
  return <Dashboard />;
}
`;
  }
  return files;
}
