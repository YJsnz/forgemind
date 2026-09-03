/**
 * Spring Boot API origin shared by browser and desktop micro-client builds.
 * Use the IPv4 loopback explicitly so Windows does not stall on an unavailable
 * IPv6 localhost listener while the packaged backend is starting.
 */
export const BACKEND_BASE =
  (import.meta.env.VITE_BACKEND_BASE_URL as string | undefined)?.replace(/\/$/, '') ||
  'http://127.0.0.1:8080'
