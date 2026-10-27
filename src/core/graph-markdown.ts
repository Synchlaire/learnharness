/**
 * Knowledge Graph → Obsidian / Markdown export (pure core).
 *
 * Formats a GraphSnapshot into a structured Markdown document with
 * [[Wikilinks]], YAML frontmatter, proposition statements, aliases,
 * provenance sources, and reasoning chains (premises → conclusions).
 */

import type { GraphNode, GraphSnapshot } from "./contracts.ts";

function sanitizeWikilink(name: string): string {
	return name.replace(/[\[\]|#^\\]/g, "").trim() || "Untitled";
}

export function graphToObsidianMarkdown(
	snapshot: Pick<
		GraphSnapshot,
		"propositions" | "chains" | "sessions" | "fileSources" | "nodeSessions" | "clusters"
	>,
	exportedAt = new Date().toISOString(),
): string {
	const propById = new Map<string, GraphNode>();
	for (const p of snapshot.propositions) {
		propById.set(p.id, p);
	}

	const linkForId = (id: string): string => {
		const node = propById.get(id);
		return node ? `[[${sanitizeWikilink(node.name)}]]` : `\`${id}\``;
	};

	const entailedByMap = new Map<string, string[][]>();
	const entailsMap = new Map<string, Set<string>>();

	for (const chain of snapshot.chains) {
		const list = entailedByMap.get(chain.conclusion) ?? [];
		list.push(chain.premises);
		entailedByMap.set(chain.conclusion, list);

		for (const prem of chain.premises) {
			let set = entailsMap.get(prem);
			if (!set) {
				set = new Set<string>();
				entailsMap.set(prem, set);
			}
			set.add(chain.conclusion);
		}
	}

	const lines: string[] = [
		"---",
		"type: knowledge-graph",
		`propositions: ${snapshot.propositions.length}`,
		`chains: ${snapshot.chains.length}`,
		`exportedAt: "${exportedAt}"`,
		"tags:",
		"  - learnharness",
		"  - knowledge-graph",
		"---",
		"",
		"# Knowledge Graph",
		"",
		`- **Propositions:** ${snapshot.propositions.length}`,
		`- **Reasoning chains:** ${snapshot.chains.length}`,
		`- **Sessions:** ${Object.keys(snapshot.sessions).length}`,
		`- **Imported notes:** ${Object.keys(snapshot.fileSources ?? {}).length}`,
	];

	if (snapshot.propositions.length === 0) {
		lines.push("", "_No propositions in the graph yet._");
		return lines.join("\n");
	}

	lines.push("", "## Propositions");

	for (const node of snapshot.propositions) {
		const wikiName = sanitizeWikilink(node.name);
		lines.push("", `### ${wikiName}`);
		lines.push("", `> ${node.statement}`);

		if (node.aliases.length > 0) {
			lines.push("", `- **Aliases:** ${node.aliases.map((a) => `“${a}”`).join(", ")}`);
		}

		const incoming = entailedByMap.get(node.id) ?? [];
		if (incoming.length > 0) {
			const formatted = incoming.map((prems) => prems.map(linkForId).join(" + ")).join("; ");
			lines.push(`- **Entailed by:** ${formatted}`);
		}

		const outgoing = entailsMap.get(node.id);
		if (outgoing && outgoing.size > 0) {
			const formatted = Array.from(outgoing).map(linkForId).join(", ");
			lines.push(`- **Entails:** ${formatted}`);
		}

		const sourceIds = snapshot.nodeSessions[node.id] ?? [];
		if (sourceIds.length > 0) {
			const sourceLabels = sourceIds.map(
				(sid) => snapshot.fileSources?.[sid] ?? snapshot.sessions[sid] ?? sid,
			);
			lines.push(`- **Sources:** ${sourceLabels.join(", ")}`);
		}
	}

	if (snapshot.chains.length > 0) {
		lines.push("", "## Reasoning Chains", "");
		for (const chain of snapshot.chains) {
			const prems = chain.premises.map(linkForId).join(" + ");
			const conc = linkForId(chain.conclusion);
			lines.push(`- ${prems} → ${conc}`);
		}
	}

	return lines.join("\n") + "\n";
}
