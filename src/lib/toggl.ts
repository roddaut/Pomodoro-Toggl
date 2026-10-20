/** Browser calls this path; Vite (dev/preview) and vercel.json rewrite proxy to api.track.toggl.com */
export const TOGGL_API_PREFIX = '/api/toggl'

function authHeader(token: string): HeadersInit {
  const b64 = btoa(`${token}:api_token`)
  return {
    Authorization: `Basic ${b64}`,
    'Content-Type': 'application/json',
  }
}

export async function togglFetch<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${TOGGL_API_PREFIX}${path}`
  const res = await fetch(url, {
    ...init,
    headers: {
      ...authHeader(token),
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Toggl ${res.status}: ${text.slice(0, 280)}`)
  }
  if (res.status === 204) return undefined as T
  const ct = res.headers.get('content-type')
  if (!ct?.includes('application/json')) return undefined as T
  return res.json() as Promise<T>
}

export interface TogglMe {
  id: number
  default_workspace_id: number | null
  fullname: string
  email: string
  workspaces?: Array<{ id: number; name: string }>
  projects?: Array<{
    id: number
    name: string
    workspace_id: number
    active: boolean
  }>
}

export function fetchMe(token: string) {
  return togglFetch<TogglMe>(
    token,
    '/v9/me?with_related_data=true',
  )
}

export interface CreateTimeEntryBody {
  description?: string
  start: string
  stop: string
  duration: number
  created_with?: string
  project_id?: number
  workspace_id: number
}

export interface TogglTimeEntry {
  id: number
  duration: number
  start: string
  stop: string | null
  description: string | null
  workspace_id: number
  project_id?: number | null
}

export function createTimeEntry(
  token: string,
  workspaceId: number,
  body: CreateTimeEntryBody,
) {
  return togglFetch<TogglTimeEntry>(
    token,
    `/v9/workspaces/${workspaceId}/time_entries`,
    {
      method: 'POST',
      body: JSON.stringify({
        ...body,
        created_with: body.created_with ?? 'Pomodoro-Toggl',
      }),
    },
  )
}

export interface TogglWorkspace {
  id: number
  name: string
}

export interface TogglProject {
  id: number
  name: string
  workspace_id: number
  active: boolean
}

/** `/me?with_related_data=true` omits workspaces on some accounts; this is the authoritative list. */
export function fetchWorkspaces(token: string) {
  return togglFetch<TogglWorkspace[]>(token, '/v9/workspaces')
}

/** Projects are per workspace; `/me` only ever carries a partial set. */
export function fetchProjects(
  token: string,
  workspaceId: number,
  signal?: AbortSignal,
) {
  return togglFetch<TogglProject[] | null>(
    token,
    `/v9/workspaces/${workspaceId}/projects?active=true`,
    { signal },
  )
}
