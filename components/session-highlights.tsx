"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { BookmarkIcon, HighlighterIcon, MessageSquarePlusIcon, PencilIcon, Trash2Icon, XIcon } from "lucide-react";
import { messageAnchorId, type SessionHighlight } from "@/src/core";
import { sessionFindRanges } from "@/components/session-find-dom";
import { scrollSessionTarget, type SessionScrollContext } from "@/components/session-navigation";

export const SESSION_SAVED_HIGHLIGHT = "lh-session-saved-highlight";
export const SESSION_SAVED_ACTIVE_HIGHLIGHT = "lh-session-saved-active";

const HIGHLIGHT_STYLE_ID = "lh-session-saved-highlights-style";

export function injectSavedHighlightStyles(): void {
	if (typeof document === "undefined" || document.getElementById(HIGHLIGHT_STYLE_ID)) return;
	const style = document.createElement("style");
	style.id = HIGHLIGHT_STYLE_ID;
	style.textContent = `
::highlight(${SESSION_SAVED_HIGHLIGHT}) { background-color: color-mix(in oklab, var(--primary) 20%, transparent); }
::highlight(${SESSION_SAVED_ACTIVE_HIGHLIGHT}) { background-color: color-mix(in oklab, var(--primary) 48%, transparent); color: var(--foreground); }`;
	document.head.appendChild(style);
}

function clearSavedHighlights(): void {
	if (typeof CSS === "undefined") return;
	CSS.highlights?.delete(SESSION_SAVED_HIGHLIGHT);
	CSS.highlights?.delete(SESSION_SAVED_ACTIVE_HIGHLIGHT);
}

function findBestRangeForHighlight(scope: HTMLElement, h: SessionHighlight): Range | null {
	const ranges = sessionFindRanges(scope, h.quote);
	if (ranges.length === 0) return null;
	if (h.messageId) {
		const matched = ranges.find((r) => {
			const el = r.startContainer.nodeType === 1
				? (r.startContainer as Element)
				: r.startContainer.parentElement;
			return el?.closest("[data-source-message-id]")?.getAttribute("data-source-message-id") === h.messageId;
		});
		if (matched) return matched;
	}
	return ranges[0] ?? null;
}

function paintSavedHighlights(scope: HTMLElement, highlights: readonly SessionHighlight[], activeId: string | null): void {
	if (typeof CSS === "undefined" || !CSS.highlights || typeof Highlight === "undefined") return;
	if (highlights.length === 0) {
		clearSavedHighlights();
		return;
	}
	const savedSet = new Highlight();
	const activeSet = new Highlight();
	activeSet.priority = 2;
	for (const h of highlights) {
		const range = findBestRangeForHighlight(scope, h);
		if (!range) continue;
		savedSet.add(range);
		if (activeId === h.id) activeSet.add(range);
	}
	CSS.highlights.set(SESSION_SAVED_HIGHLIGHT, savedSet);
	if (activeId) {
		CSS.highlights.set(SESSION_SAVED_ACTIVE_HIGHLIGHT, activeSet);
	} else {
		CSS.highlights.delete(SESSION_SAVED_ACTIVE_HIGHLIGHT);
	}
}

interface PendingSelection {
	quote: string;
	messageId?: string;
	top: number;
	left: number;
}

export function SessionHighlights({
	scopeRef,
	scrollContextRef,
	highlights,
	onAddHighlight,
	onUpdateHighlight,
	onDeleteHighlight,
	open,
	onClose,
	onOpen,
}: {
	scopeRef: RefObject<HTMLDivElement | null>;
	scrollContextRef: RefObject<SessionScrollContext | null>;
	highlights: readonly SessionHighlight[];
	onAddHighlight: (quote: string, note?: string, messageId?: string) => void;
	onUpdateHighlight: (id: string, note: string | undefined) => void;
	onDeleteHighlight: (id: string) => void;
	open: boolean;
	onClose: () => void;
	onOpen: () => void;
}) {
	useEffect(injectSavedHighlightStyles, []);

	const [activeId, setActiveId] = useState<string | null>(null);
	const flashTimerRef = useRef<number | null>(null);
	const [selectionPopup, setSelectionPopup] = useState<PendingSelection | null>(null);
	const [addingNote, setAddingNote] = useState(false);
	const [noteDraft, setNoteDraft] = useState("");
	const noteInputRef = useRef<HTMLTextAreaElement | null>(null);
	const popupRef = useRef<HTMLDivElement | null>(null);

	const [editingId, setEditingId] = useState<string | null>(null);
	const [editDraft, setEditDraft] = useState("");

	// Repaint CSS custom highlights when highlights list or DOM changes
	useEffect(() => {
		const scope = scopeRef.current;
		if (!scope) return;
		let frame: number | null = null;
		const refresh = () => {
			paintSavedHighlights(scope, highlights, activeId);
		};
		refresh();
		const schedule = () => {
			if (frame !== null) return;
			frame = window.requestAnimationFrame(() => {
				frame = null;
				refresh();
			});
		};
		const observer = new MutationObserver(schedule);
		observer.observe(scope, {
			subtree: true,
			childList: true,
			characterData: true,
		});
		window.addEventListener("resize", schedule);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", schedule);
			if (frame !== null) window.cancelAnimationFrame(frame);
		};
	}, [highlights, activeId, scopeRef]);

	useEffect(() => clearSavedHighlights, []);

	// Detect text selection inside [data-session-find-root]
	useEffect(() => {
		const scope = scopeRef.current;
		if (!scope) return;

		const checkSelection = () => {
			// If user is typing a note in the popup, keep the popup open
			if (popupRef.current && popupRef.current.contains(document.activeElement)) return;

			const sel = window.getSelection();
			if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
				setSelectionPopup(null);
				setAddingNote(false);
				setNoteDraft("");
				return;
			}
			const rawText = sel.toString().replace(/\s+/g, " ").trim();
			if (rawText.length < 2) {
				setSelectionPopup(null);
				return;
			}
			const range = sel.getRangeAt(0);
			const startEl = range.startContainer.nodeType === 1
				? (range.startContainer as Element)
				: range.startContainer.parentElement;
			const endEl = range.endContainer.nodeType === 1
				? (range.endContainer as Element)
				: range.endContainer.parentElement;
			if (!startEl || !endEl) {
				setSelectionPopup(null);
				return;
			}
			const findRoot = startEl.closest("[data-session-find-root]");
			if (!findRoot || !scope.contains(findRoot) || !findRoot.contains(endEl)) {
				setSelectionPopup(null);
				return;
			}
			if (startEl.closest("textarea, input, button, [data-session-find-exclude]")) {
				setSelectionPopup(null);
				return;
			}

			const rect = range.getBoundingClientRect();
			const scopeRect = scope.getBoundingClientRect();
			if (rect.width === 0 && rect.height === 0) {
				setSelectionPopup(null);
				return;
			}

			const messageId = startEl.closest("[data-source-message-id]")?.getAttribute("data-source-message-id") ?? undefined;
			const top = Math.max(8, rect.top - scopeRect.top - 42);
			const left = Math.min(
				Math.max(12, rect.left - scopeRect.left + rect.width / 2),
				Math.max(12, scopeRect.width - 140),
			);

			setSelectionPopup({
				quote: rawText,
				messageId,
				top,
				left,
			});
		};

		const onMouseUp = () => {
			window.requestAnimationFrame(checkSelection);
		};
		const onKeyUp = (e: KeyboardEvent) => {
			if (e.key === "Escape" && selectionPopup) {
				setSelectionPopup(null);
				setAddingNote(false);
				setNoteDraft("");
				return;
			}
			if (e.shiftKey) window.requestAnimationFrame(checkSelection);
		};
		const onMouseDown = (e: MouseEvent) => {
			if (popupRef.current && popupRef.current.contains(e.target as Node)) return;
			setSelectionPopup(null);
			setAddingNote(false);
			setNoteDraft("");
		};

		scope.addEventListener("mouseup", onMouseUp);
		document.addEventListener("keyup", onKeyUp);
		document.addEventListener("mousedown", onMouseDown);
		return () => {
			scope.removeEventListener("mouseup", onMouseUp);
			document.removeEventListener("keyup", onKeyUp);
			document.removeEventListener("mousedown", onMouseDown);
		};
	}, [scopeRef, selectionPopup]);

	useEffect(() => {
		if (addingNote) {
			noteInputRef.current?.focus();
		}
	}, [addingNote]);

	const commitSelectionHighlight = useCallback(
		(withNote?: string) => {
			if (!selectionPopup) return;
			onAddHighlight(selectionPopup.quote, withNote?.trim() || undefined, selectionPopup.messageId);
			window.getSelection()?.removeAllRanges();
			setSelectionPopup(null);
			setAddingNote(false);
			setNoteDraft("");
			if (withNote !== undefined) onOpen();
		},
		[selectionPopup, onAddHighlight, onOpen],
	);

	const jumpToHighlight = useCallback(
		(h: SessionHighlight) => {
			const scope = scopeRef.current;
			if (!scope) return;
			const range = findBestRangeForHighlight(scope, h);
			if (range) {
				scrollSessionTarget(range, scope, scrollContextRef.current);
				setActiveId(h.id);
				if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
				flashTimerRef.current = window.setTimeout(() => {
					setActiveId(null);
					flashTimerRef.current = null;
				}, 1800);
				return;
			}
			if (h.messageId) {
				const target = document.getElementById(messageAnchorId(h.messageId));
				if (target && scope.contains(target)) {
					scrollSessionTarget(target, scope, scrollContextRef.current);
				}
			}
		},
		[scopeRef, scrollContextRef],
	);

	return (
		<>
			{selectionPopup && (
				<div
					ref={popupRef}
					data-session-find-exclude=""
					data-testid="selection-highlight-toolbar"
					style={{
						top: `${selectionPopup.top}px`,
						left: `${selectionPopup.left}px`,
						transform: "translateX(-50%)",
					}}
					onMouseDown={(e) => {
						// Keep text selection alive when clicking toolbar buttons
						if ((e.target as HTMLElement).tagName !== "TEXTAREA") {
							e.preventDefault();
						}
					}}
					className="lh-no-drag absolute z-30 flex flex-col gap-1.5 rounded-lg border border-border bg-card p-1.5 text-xs shadow-lg"
				>
					{!addingNote ? (
						<div className="flex items-center gap-1">
							<button
								type="button"
								data-testid="btn-save-highlight"
								onClick={() => commitSelectionHighlight()}
								className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 font-ui text-xs font-medium text-foreground transition-colors hover:bg-accent"
							>
								<HighlighterIcon className="size-3.5 text-primary" />
								Highlight
							</button>
							<div className="h-3.5 w-px bg-border" />
							<button
								type="button"
								data-testid="btn-add-highlight-note"
								onClick={() => setAddingNote(true)}
								className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 font-ui text-xs font-medium text-foreground transition-colors hover:bg-accent"
							>
								<MessageSquarePlusIcon className="size-3.5 text-primary" />
								+ Note
							</button>
						</div>
					) : (
						<div className="flex w-64 flex-col gap-1.5 p-1">
							<textarea
								ref={noteInputRef}
								rows={2}
								value={noteDraft}
								onChange={(e) => setNoteDraft(e.target.value)}
								placeholder="Add a note for this highlight…"
								onKeyDown={(e) => {
									if (e.key === "Enter" && !e.shiftKey) {
										e.preventDefault();
										commitSelectionHighlight(noteDraft);
									} else if (e.key === "Escape") {
										e.preventDefault();
										e.stopPropagation();
										setAddingNote(false);
										setNoteDraft("");
									}
								}}
								className="w-full resize-none rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-ring"
							/>
							<div className="flex items-center justify-end gap-1.5">
								<button
									type="button"
									onClick={() => {
										setAddingNote(false);
										setNoteDraft("");
									}}
									className="cursor-pointer rounded px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
								>
									Cancel
								</button>
								<button
									type="button"
									data-testid="btn-commit-highlight-note"
									onClick={() => commitSelectionHighlight(noteDraft)}
									className="cursor-pointer rounded bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground hover:opacity-90"
								>
									Save
								</button>
							</div>
						</div>
					)}
				</div>
			)}

			{open && (
				<aside
					data-session-find-exclude=""
					data-testid="session-highlights-drawer"
					className="flex h-full w-80 shrink-0 flex-col border-l border-border bg-card/60"
				>
					<div className="flex items-center justify-between border-b border-border px-3.5 py-2.5">
						<div className="flex items-center gap-1.5 font-ui text-xs font-medium uppercase tracking-wide text-foreground">
							<BookmarkIcon className="size-3.5 text-primary" />
							<span>Notes & Highlights</span>
							{highlights.length > 0 && (
								<span className="rounded-full bg-accent px-1.5 py-0.2 text-[11px] tabular-nums text-muted-foreground">
									{highlights.length}
								</span>
							)}
						</div>
						<button
							type="button"
							aria-label="Close notes and highlights"
							onClick={onClose}
							className="cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						>
							<XIcon className="size-3.5" />
						</button>
					</div>

					<div className="flex-1 overflow-y-auto p-3">
						{highlights.length === 0 ? (
							<div className="flex h-48 flex-col items-center justify-center gap-2 px-4 text-center text-xs text-muted-foreground">
								<HighlighterIcon className="size-5 opacity-40" />
								<p>Select any text in the session transcript to highlight it or attach a note.</p>
							</div>
						) : (
							<div className="flex flex-col gap-2.5">
								{highlights.map((h) => {
									const isEditing = editingId === h.id;
									return (
										<div
											key={h.id}
											data-testid="highlight-card"
											className="group flex flex-col gap-1.5 rounded-lg border border-border bg-background/80 p-2.5 text-xs transition-colors hover:border-muted-foreground/40"
										>
											<button
												type="button"
												onClick={() => jumpToHighlight(h)}
												title="Jump to passage in session"
												className="cursor-pointer border-l-2 border-primary pl-2 text-left leading-relaxed text-foreground/90 transition-colors hover:text-foreground"
											>
												<span className="line-clamp-4 italic">“{h.quote}”</span>
											</button>

											{isEditing ? (
												<div className="mt-1 flex flex-col gap-1.5">
													<textarea
														rows={2}
														value={editDraft}
														onChange={(e) => setEditDraft(e.target.value)}
														placeholder="Write a note…"
														onKeyDown={(e) => {
															if (e.key === "Enter" && !e.shiftKey) {
																e.preventDefault();
																onUpdateHighlight(h.id, editDraft.trim() || undefined);
																setEditingId(null);
															} else if (e.key === "Escape") {
																e.preventDefault();
																setEditingId(null);
															}
														}}
														className="w-full resize-none rounded border border-border bg-card px-2 py-1 text-xs text-foreground outline-none focus:border-ring"
													/>
													<div className="flex justify-end gap-1.5">
														<button
															type="button"
															onClick={() => setEditingId(null)}
															className="cursor-pointer rounded px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
														>
															Cancel
														</button>
														<button
															type="button"
															onClick={() => {
																onUpdateHighlight(h.id, editDraft.trim() || undefined);
																setEditingId(null);
															}}
															className="cursor-pointer rounded bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground"
														>
															Save
														</button>
													</div>
												</div>
											) : (
												<>
													{h.note && (
														<div
															onClick={() => jumpToHighlight(h)}
															className="mt-0.5 cursor-pointer whitespace-pre-wrap text-xs leading-snug text-muted-foreground"
														>
															{h.note}
														</div>
													)}
													<div className="mt-0.5 flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
														<button
															type="button"
															aria-label={h.note ? "Edit note" : "Add note"}
															onClick={() => {
																setEditingId(h.id);
																setEditDraft(h.note ?? "");
															}}
															className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
														>
															<PencilIcon className="size-3" />
															{h.note ? "Edit" : "+ Note"}
														</button>
														<button
															type="button"
															aria-label="Delete highlight"
															onClick={() => onDeleteHighlight(h.id)}
															className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
														>
															<Trash2Icon className="size-3" />
														</button>
													</div>
												</>
											)}
										</div>
									);
								})}
							</div>
						)}
					</div>
				</aside>
			)}
		</>
	);
}
