import { getChat, stores } from "@/src/server";
import type { SessionHighlight } from "@/src/core";

function isSessionHighlight(item: unknown): item is SessionHighlight {
	if (typeof item !== "object" || item === null) return false;
	const h = item as Record<string, unknown>;
	if (typeof h.id !== "string" || h.id.trim() === "") return false;
	if (typeof h.quote !== "string" || h.quote.trim() === "") return false;
	if (typeof h.createdAt !== "string" || h.createdAt.trim() === "") return false;
	if (h.note !== undefined && typeof h.note !== "string") return false;
	if (h.messageId !== undefined && typeof h.messageId !== "string") return false;
	return true;
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!getChat(id)) return Response.json({ error: "Not found" }, { status: 404 });

	const body = (await req.json().catch(() => null)) as { highlights?: unknown } | null;
	if (!body || !Array.isArray(body.highlights) || !body.highlights.every(isSessionHighlight)) {
		return Response.json({ error: "highlights must be an array of valid SessionHighlight items" }, { status: 400 });
	}

	const sanitized: SessionHighlight[] = body.highlights.map((h) => ({
		id: h.id.trim(),
		quote: h.quote.trim(),
		...(h.note && h.note.trim() ? { note: h.note.trim() } : {}),
		...(h.messageId && h.messageId.trim() ? { messageId: h.messageId.trim() } : {}),
		createdAt: h.createdAt,
	}));

	stores.chatStore.saveHighlights(id, sanitized);
	return Response.json({ highlights: sanitized });
}
