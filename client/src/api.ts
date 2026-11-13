// Thin fetch wrapper. Same origin, so the traces.sid cookie rides along and there is no CORS.
export class ApiError extends Error {
  status: number
  code: string
  details?: unknown
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

// These two 401s are expected and handled by the caller (login failure, "not logged in yet").
const QUIET_401 = ['/api/auth/login', '/api/me']

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  let payload: BodyInit | undefined
  if (body instanceof FormData) payload = body // browser sets the multipart boundary
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' })

  if (!res.ok) {
    const err = (await res.json().catch(() => null))?.error
    if (res.status === 401 && !QUIET_401.includes(path) && location.pathname !== '/login') location.assign('/login')
    throw new ApiError(res.status, err?.code ?? 'ERROR', err?.message ?? res.statusText, err?.details)
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}

export type Role = 'supply_admin' | 'superadmin'
export type User = { id: string; email: string; displayName: string; role: Role; mustChangePassword: boolean }
