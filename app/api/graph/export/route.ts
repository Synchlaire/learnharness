import { graphToObsidianMarkdown } from "@/src/core";
import { graphView } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
	const snapshot = graphView();
	const markdown = graphToObsidianMarkdown(snapshot);
	return new Response(markdown, {
		headers: {
			"content-type": "text/markdown; charset=utf-8",
			"content-disposition": 'attachment; filename="knowledge-graph.md"',
		},
	});
}
