import { File, UploadType } from 'expo-file-system';

import type { AppState, AssistantReply, FoodProfile, ItemState, OCRResult } from './types';

// Must point at this Mac's LAN IP + backend port (see apps/mobile/.env.example) --
// "localhost" from a physical phone means the phone itself, not this computer.
const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8010/api';

/**
 * fetch() never times out on its own. Over Wi-Fi a dropped request then hangs
 * forever, which surfaced as a Confirm button stuck on "Adding..." with no error
 * and no item created. Abort instead, so callers get a failure they can show.
 */
const REQUEST_TIMEOUT_MS = 12000;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}${path}`, { ...init, signal: controller.signal });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || `Request failed (${response.status})`);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(
        `No response from ${API_BASE} after ${REQUEST_TIMEOUT_MS / 1000}s. ` +
          'Check the API is running and that the phone is on the same Wi-Fi.',
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function requestJson<T>(path: string, body: unknown, method = 'POST'): Promise<T> {
  return request<T>(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function getItems(): Promise<ItemState[]> {
  return request('/items');
}

/**
 * Telemetry + items + alerts in a single round trip. Preferred over getItems()
 * for the dashboard; items arrive already sorted by days_left (service.snapshot).
 */
export function getState(): Promise<AppState> {
  return request('/state');
}

/** Manual add -- the escape hatch when OCR fails entirely. A null name makes
 *  the backend fall back to the food profile's own name. */
export function addItem(profileId: string, name: string | null): Promise<ItemState> {
  return requestJson('/items', { profile_id: profileId, name });
}

/** Remove an item -- the recovery path for a bad scan. Returns 204, no body. */
export async function deleteItem(itemId: string): Promise<void> {
  // 204 with no body, so this cannot go through request() (which parses JSON).
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}/items/${itemId}`, {
      method: 'DELETE',
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error((await response.text()) || `Delete failed (${response.status})`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

export function getItem(itemId: string): Promise<ItemState> {
  return request(`/items/${itemId}`);
}

/** Food categories, so the UI never hardcodes what lives in engine/foods.json. */
export function getProfiles(): Promise<FoodProfile[]> {
  return request('/profiles');
}

export function markOpened(itemId: string): Promise<ItemState> {
  return request(`/items/${itemId}/opened`, { method: 'POST' });
}

/** Track C: the manually-set colorimetric label score, in [0, 1]. */
export function setLabelScore(itemId: string, score: number): Promise<ItemState> {
  return requestJson(`/items/${itemId}/label-score`, { score });
}

export function renameItem(itemId: string, name: string): Promise<ItemState> {
  return requestJson(`/items/${itemId}/rename`, { name });
}

export function setCategory(itemId: string, profileId: string): Promise<ItemState> {
  return requestJson(`/items/${itemId}/category`, { profile_id: profileId });
}

export async function ocrScan(photoUri: string): Promise<OCRResult> {
  // expo-file-system's File.upload() drives a native multipart upload task instead of
  // routing the local file through fetch()'s FormData/{uri} shim, which is unreliable
  // for large local file:// URIs on-device (see apps/mobile/AGENTS.md: API surface here
  // has changed across SDKs -- this is the current SDK's documented upload path).
  const file = new File(photoUri);
  const result = await file.upload(`${API_BASE}/ocr/scan`, {
    uploadType: UploadType.MULTIPART,
    fieldName: 'image',
    mimeType: 'image/jpeg',
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(result.body || `Scan failed (${result.status})`);
  }
  return JSON.parse(result.body) as OCRResult;
}

/**
 * Mirrors OCRConfirmIn in apps/api/schemas.py. Takes the *edited* values rather
 * than the raw OCRResult -- the scan screen lets the user correct every field
 * before it becomes an item, because OCR routinely misreads real labels.
 */
export interface OCRConfirmPayload {
  profile_id: string;
  name: string | null;
  brand: string | null;
  printed_date: string | null;
  package_size: string | null;
  lot_code: string | null;
}

export function ocrConfirm(payload: OCRConfirmPayload): Promise<ItemState> {
  return requestJson('/ocr/confirm', payload);
}

export function sendAssistantMessage(message: string): Promise<AssistantReply> {
  return requestJson('/assistant/message', { message });
}
