import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/router-devtools";

export const Route = createRootRoute({
	component: RootLayout,
});

function RootLayout() {
	return (
		<div className="min-h-screen bg-neutral-950 text-white">
			{/* Nav */}
			<nav className="sticky top-0 z-10 border-b border-white/10 bg-neutral-950/80 backdrop-blur-sm">
				<div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
					<span className="text-sm font-black tracking-widest text-white/60 uppercase">
						TFL-Tierlist
					</span>
					<div className="flex gap-1">
						<Link
							to="/"
							className="rounded-lg px-3 py-1.5 text-sm font-medium text-white/50 transition-colors hover:bg-white/5 hover:text-white/80 [&.active]:bg-white/10 [&.active]:text-white"
						>
							Vote
						</Link>
						<Link
							to="/tierlist"
							className="rounded-lg px-3 py-1.5 text-sm font-medium text-white/50 transition-colors hover:bg-white/5 hover:text-white/80 [&.active]:bg-white/10 [&.active]:text-white"
						>
							Tierlist
						</Link>
					</div>
				</div>
			</nav>

			{/* Page content */}
			<main className="mx-auto max-w-5xl px-4 py-8">
				<Outlet />
			</main>

			{import.meta.env.DEV && <TanStackRouterDevtools />}
		</div>
	);
}
