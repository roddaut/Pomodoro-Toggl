const TOKEN_KEY = 'pomodoro-toggl:api_token'

export function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function saveToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token.trim())
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}
