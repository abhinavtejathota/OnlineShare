export type Share = {
  id: string;
  content: string;
  language: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export function createShare() {
  return request<{ share: Share; ownerToken: string }>("/api/shares", {
    method: "POST",
  });
}

export function fetchShare(id: string) {
  return request<{ share: Share }>(`/api/shares/${encodeURIComponent(id)}`);
}

export function patchShare(
  id: string,
  body: Partial<Pick<Share, "content" | "language" | "title">>,
) {
  return request<{ share: Share }>(`/api/shares/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function verifyOwner(id: string, ownerToken: string) {
  return request<{ isOwner: boolean }>(
    `/api/shares/${encodeURIComponent(id)}/verify-owner`,
    {
      method: "POST",
      body: JSON.stringify({ ownerToken }),
    },
  );
}

export function deleteShare(id: string, ownerToken: string) {
  return request<void>(`/api/shares/${encodeURIComponent(id)}`, {
    method: "DELETE",
    body: JSON.stringify({ ownerToken }),
  });
}

const OWNER_KEY = "onlineshare.owner.";

export function saveOwnerToken(shareId: string, token: string) {
  try {
    localStorage.setItem(OWNER_KEY + shareId, token);
  } catch {
    /* ignore quota / private mode */
  }
}

export function loadOwnerToken(shareId: string): string | null {
  try {
    return localStorage.getItem(OWNER_KEY + shareId);
  } catch {
    return null;
  }
}

export function clearOwnerToken(shareId: string) {
  try {
    localStorage.removeItem(OWNER_KEY + shareId);
  } catch {
    /* ignore */
  }
}
