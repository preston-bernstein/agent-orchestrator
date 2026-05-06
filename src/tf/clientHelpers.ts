export function modelIdFromListEntry(entry: unknown): string | undefined {
  if (entry == null || typeof entry !== "object") return undefined;
  const id = (entry as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

function collectModelIdsFromArray(data: readonly unknown[]): string[] {
  const ids: string[] = [];
  for (const entry of data) {
    const id = modelIdFromListEntry(entry);
    if (id !== undefined) ids.push(id);
  }
  return ids;
}

export function extractModelIds(raw: unknown): string[] {
  if (raw === null || typeof raw !== "object") return [];
  const data = (raw as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return collectModelIdsFromArray(data);
}

export async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
