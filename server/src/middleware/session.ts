import connectPgSimple from 'connect-pg-simple'
import session from 'express-session'
import { pool } from '../db/client.js'

declare module 'express-session' {
  interface SessionData { userId: string; role: 'supply_admin' | 'superadmin' }
}

export function sessionMiddleware() {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET is not set')
  const PgStore = connectPgSimple(session)
  return session({
    store: new PgStore({ pool, tableName: 'session', createTableIfMissing: false }),
    name: 'traces.sid',
    secret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 8 * 60 * 60 * 1000,
    },
  })
}
